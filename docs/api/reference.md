# API: HTTP Reference

Base URL for local development: `http://localhost:8000`. Interactive OpenAPI documentation is available at `/docs` while the backend is running.

## Authentication conventions

- **Dashboard endpoints:** `Authorization: Bearer <JWT>`.
- **External RAG endpoints:** `Authorization: Bearer rag_<key>` or `X-API-Key: rag_<key>`.
- API keys belong to a user; vector retrieval is filtered to that user's `user_id`.
- JSON endpoints use `Content-Type: application/json`; upload is multipart form data with repeated `files` fields.

## Health and authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | None | Returns service status and Chroma status. |
| `POST` | `/api/auth/register` | None | Register; first account becomes admin. Body: `{"email":"user@example.com","password":"at-least-8-chars"}`. Returns JWT. |
| `POST` | `/api/auth/login` | None | Login with the same body shape; returns JWT. |
| `GET` | `/api/auth/me` | JWT | Returns `id`, `email`, and `is_admin`. |

## Files and indexing

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/files` | JWT | List the current user's indexed documents. |
| `GET` | `/api/files/stats` | JWT | File/size/chunk totals and counts grouped by extension. |
| `POST` | `/api/files` | JWT | Multipart upload; returns HTTP 202 with `jobs` and per-file `errors`. |
| `GET` | `/api/files/jobs` | JWT | Current user's in-memory job states and progress. |
| `POST` | `/api/files/jobs/{job_id}/cancel` | JWT | Request cancellation for that user's job. |
| `DELETE` | `/api/files/{document_id}` | JWT | Delete document metadata and its vectors. Returns 204. |

Example upload:

```bash
curl -X POST http://localhost:8000/api/files \\
  -H "Authorization: Bearer $JWT" \\
  -F "files=@./handbook.pdf" \\
  -F "files=@./notes.md"
```

An accepted file produces a job object with `id`, `filename`, `status`, `progress`, `chunks_done`, and `chunks_total`. Poll `/api/files/jobs` until status is `done`, `failed`, or `cancelled`.

## Conversations and chat

All routes below require dashboard JWT authentication.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/chat/conversations` | List user's conversations, newest activity first. |
| `POST` | `/api/chat/conversations` | Create conversation. Optional body: `{"title":"Research"}`. |
| `GET` | `/api/chat/conversations/{conversation_id}` | Get conversation metadata and all messages. |
| `PATCH` | `/api/chat/conversations/{conversation_id}` | Rename. Body: `{"title":"New title"}`. |
| `DELETE` | `/api/chat/conversations/{conversation_id}` | Delete conversation and messages; returns 204. |
| `DELETE` | `/api/chat/conversations` | Delete all conversations owned by the caller; returns 204. |
| `POST` | `/api/chat/conversations/{conversation_id}/messages` | Add a user question and stream the grounded answer as NDJSON. Body: `{"content":"What is the renewal date?"}`. |

The NDJSON stream begins with a `sources` event, emits `token` events, then `done`; generation failures emit an `error` event. The assistant response, sources and any error are persisted when streaming completes or is closed.

## API keys

All key-management endpoints require dashboard JWT authentication.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/keys` | List key metadata (never returns full key). |
| `POST` | `/api/keys` | Create key. Body: `{"name":"my integration"}`. Full key is returned once. |
| `DELETE` | `/api/keys/{key_id}` | Revoke a key; returns 204. |

## OpenAI-compatible and simple query API

These endpoints require a generated API key, not a dashboard JWT.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/models` | Returns the available model ID `rag-knowledge-base`. |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion; `stream` is supported. |
| `POST` | `/api/query` | Simple RAG query; body includes `question` and optional `top_k` (1-20), returns `answer` and `sources`. |

Example:

```bash
curl http://localhost:8000/v1/chat/completions \\
  -H "Authorization: Bearer $RAG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"rag-knowledge-base","messages":[{"role":"user","content":"Summarize my documents"}]}'
```

Simple query:

```bash
curl http://localhost:8000/api/query \\
  -H "X-API-Key: $RAG_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What does the policy say about renewal?"}'
```

## Vector database and admin

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/vectordb` | JWT | Collection and current-user vector status. |
| `POST` | `/api/vectordb/flush` | JWT | Flush caller's vectors and indexed document records. Body: `{"confirm":"FLUSH"}`. |
| `GET` | `/api/admin/users` | Admin JWT | List users and usage counts. |
| `PATCH` | `/api/admin/users/{user_id}` | Admin JWT | Change role. Body: `{"is_admin":true}`. Cannot demote the last admin. |
| `DELETE` | `/api/admin/users/{user_id}` | Admin JWT | Delete another user and their documents, vectors, keys, chats; self-delete is blocked. |
| `POST` | `/api/admin/flush-all` | Admin JWT | Flush all users' vectors and document records. Body: `{"confirm":"FLUSH ALL"}`. Accounts and keys remain. |

## Common status codes

- `200`: successful read/action.
- `201`: created account, API key, or conversation.
- `202`: upload accepted for background indexing.
- `204`: successful deletion with no response body.
- `400`: invalid input or confirmation phrase.
- `401`: missing/invalid JWT or API key.
- `403`: authenticated user lacks admin permissions.
- `404`: object does not exist or is not owned by the caller.
- `409`: email already registered.
