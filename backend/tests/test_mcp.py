import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app import vectorstore
from app.config import get_settings
from app.db import Document, SessionLocal
from app.main import app


class TestEmbeddings:
    def embed(self, texts):
        return [[1.0, 0.5, 0.25] for text in texts]


def payload(result):
    return result.structuredContent or json.loads(result.content[0].text)


class MCPIntegrationTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        settings = get_settings()
        if settings.chroma_mode != "embedded" or not settings.data_dir.name.startswith("rag-mcp-test."):
            raise RuntimeError("Use CHROMA_MODE=embedded and DATA_DIR=$(mktemp -d /tmp/rag-mcp-test.XXXXXX)")

    async def test_tools_and_key_isolation(self):
        with patch("app.vectorstore.get_embedding_provider", return_value=TestEmbeddings()):
            async with app.router.lifespan_context(app):
                transport = httpx.ASGITransport(app=app)
                async with httpx.AsyncClient(transport=transport, base_url="http://localhost:8000") as client:
                    accounts = []
                    for index in (1, 2):
                        response = await client.post("/api/auth/register", json={
                            "email": f"mcp{index}@example.com", "password": "test-password-123"
                        })
                        self.assertEqual(response.status_code, 201)
                        token = response.json()["access_token"]
                        headers = {"Authorization": f"Bearer {token}"}
                        user_id = (await client.get("/api/auth/me", headers=headers)).json()["id"]
                        key = (await client.post("/api/keys", headers=headers, json={"name": "MCP"})).json()
                        document_id = f"document-{index}"
                        with SessionLocal() as database:
                            database.add(Document(
                                id=document_id, user_id=user_id, filename=f"{index}.txt",
                                file_type="txt", size_bytes=20, chunk_count=1
                            ))
                            database.commit()
                        vectorstore.add_chunks(user_id, document_id, f"{index}.txt", [f"Private text {index}"])
                        accounts.append((index, key, headers))

                    self.assertEqual((await client.post("/mcp/")).status_code, 401)
                    self.assertEqual((await client.post("/mcp/", headers=accounts[0][2])).status_code, 401)

                    async def check_account(index, key, headers):
                        async with httpx.AsyncClient(transport=transport, headers={
                            "Authorization": f"Bearer {key['key']}"
                        }) as mcp_client:
                            async with streamable_http_client(
                                "http://localhost:8000/mcp/", http_client=mcp_client
                            ) as (read, write, _):
                                async with ClientSession(read, write) as session:
                                    await session.initialize()
                                    tools = await session.list_tools()
                                    self.assertEqual({tool.name for tool in tools.tools}, {
                                        "list_documents", "search_documents", "read_document"
                                    })
                                    listed = await session.call_tool("list_documents", {})
                                    self.assertFalse(listed.isError)
                                    self.assertEqual(payload(listed)["total"], 1)
                                    self.assertEqual(payload(listed)["documents"][0]["filename"], f"{index}.txt")
                                    found = await session.call_tool("search_documents", {"query": "private"})
                                    self.assertFalse(found.isError)
                                    self.assertEqual(payload(found)["sources"][0]["filename"], f"{index}.txt")
                                    read_result = await session.call_tool("read_document", {"document_id": f"document-{index}"})
                                    self.assertFalse(read_result.isError)
                                    self.assertEqual(payload(read_result)["passages"][0]["text"], f"Private text {index}")
                                    denied = await session.call_tool("read_document", {"document_id": f"document-{3-index}"})
                                    self.assertTrue(denied.isError)
                                    invalid = await session.call_tool("search_documents", {"query": "private", "top_k": 21})
                                    self.assertTrue(invalid.isError)
                                    await client.delete(f"/api/keys/{key['id']}", headers=headers)
                                    response = await mcp_client.post("http://localhost:8000/mcp/")
                                    self.assertEqual(response.status_code, 401)

                    await asyncio.gather(*(check_account(*account) for account in accounts))