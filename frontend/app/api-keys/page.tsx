"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api, API_URL, ApiKeyItem } from "@/lib/api";

export default function ApiKeysPage() {
  return (
    <AppShell>
      <ApiKeys />
    </AppShell>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [client, setClient] = useState<"vscode" | "cursor">("vscode");
  const [configCopied, setConfigCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => setKeys(await api<ApiKeyItem[]>("/api/keys")), []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<ApiKeyItem & { key: string }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewKey(res.key);
      setCopied(false);
      setConfigCopied(false);
      setName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: ApiKeyItem) {
    if (!confirm(`Revoke key "${k.name}"? Apps using it will stop working.`)) return;
    await api(`/api/keys/${k.id}`, { method: "DELETE" });
    await refresh();
  }

  const shownKey = newKey ?? "rag_YOUR_KEY";
  const mcpUrl = `${API_URL.replace(/\/$/, "")}/mcp/`;
  const config = JSON.stringify(client === "vscode" ? {
    inputs: [{ type: "promptString", id: "rag-mcp-key", description: "RAG MCP API key", password: true }],
    servers: {
      "rag-knowledge-base": {
        type: "http", url: mcpUrl,
        headers: { Authorization: "Bearer ${input:rag-mcp-key}" },
      },
    },
  } : {
    mcpServers: {
      "rag-knowledge-base": { url: mcpUrl, headers: { Authorization: `Bearer ${shownKey}` } },
    },
  }, null, 2);

  async function copy(text: string, target: "key" | "config") {
    try {
      await navigator.clipboard.writeText(text);
      if (target === "key") setCopied(true);
      else setConfigCopied(true);
    } catch {
      setError("Clipboard access failed. Select and copy the text directly.");
    }
  }

  return (
    <div className="key-settings">
      <section className="card">
        <h2>Generate API / MCP key</h2>
        <form className="row" onSubmit={create}>
          <input aria-label="Key name" placeholder="Key name, e.g. Copilot MCP" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={busy}>{busy ? "Generating..." : "Generate"}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {newKey && (
          <div className="new-key">
            <p><b>Copy this key now. It will not be shown again.</b></p>
            <div className="row">
              <code>{newKey}</code>
              <button className="btn" onClick={() => copy(newKey, "key")}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Your keys</h2>
        {keys.length === 0 ? (
          <p className="muted">No keys yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td><code>{k.prefix}...</code></td>
                  <td>{new Date(k.created_at).toLocaleString()}</td>
                  <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}</td>
                  <td><button className="btn danger" onClick={() => revoke(k)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>MCP connections</h2>
        <dl className="mcp-connection">
          <dt>Endpoint</dt><dd><code>{mcpUrl}</code></dd>
          <dt>Transport</dt><dd>Streamable HTTP</dd>
          <dt>Authentication</dt><dd>Bearer API key</dd>
        </dl>
        <div className="row between mcp-toolbar">
          <div className="mcp-clients" role="group" aria-label="MCP client">
            <button className="btn ghost" aria-pressed={client === "vscode"} onClick={() => { setClient("vscode"); setConfigCopied(false); }}>VS Code / Copilot</button>
            <button className="btn ghost" aria-pressed={client === "cursor"} onClick={() => { setClient("cursor"); setConfigCopied(false); }}>Cursor</button>
          </div>
          <button className="btn ghost" onClick={() => copy(config, "config")}>{configCopied ? "Copied" : "Copy configuration"}</button>
        </div>
        <p><code>{client === "vscode" ? ".vscode/mcp.json" : ".cursor/mcp.json"}</code></p>
        <pre>{config}</pre>
        {client === "cursor" && <p className="muted">The Cursor configuration contains your key. Keep it out of version control.</p>}
      </section>

      <section className="card">
        <h2>REST connections</h2>
        <p className="muted">OpenAI-compatible endpoint:</p>
        <pre>{`Base URL: ${API_URL}/v1
API key:  ${shownKey}
Model:    rag-knowledge-base`}</pre>
        <p className="muted">cURL (chat completions):</p>
        <pre>{`curl ${API_URL}/v1/chat/completions \\
  -H "Authorization: Bearer ${shownKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"rag-knowledge-base","messages":[{"role":"user","content":"Summarize my docs"}]}'`}</pre>
        <p className="muted">Simple query with sources:</p>
        <pre>{`curl ${API_URL}/api/query \\
  -H "X-API-Key: ${shownKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What does the contract say about renewal?"}'`}</pre>
      </section>
    </div>
  );
}
