"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me";

type Collection = { name: string; active: boolean; total_chunks: number; your_chunks: number };
type Info = {
  engine: string;
  embedding_provider: string;
  embedding_model: string;
  active_collection: string;
  your_documents: number;
  your_chunks_expected: number;
  your_chunks_indexed: number;
  collections: Collection[];
};

export default function VectorDbPage() {
  return (
    <AppShell>
      <VectorDb />
    </AppShell>
  );
}

function VectorDb() {
  const me = useMe();
  const [info, setInfo] = useState<Info | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => setInfo(await api<Info>("/api/vectordb")), []);

  useEffect(() => {
    refresh().catch((e) => setResult({ ok: false, text: (e as Error).message }));
  }, [refresh]);

  async function flush() {
    if (!confirm("This permanently deletes ALL your files and vectors. Continue?")) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ removed_documents: number; removed_chunks: number }>("/api/vectordb/flush", {
        method: "POST",
        body: JSON.stringify({ confirm: confirmText }),
      });
      setResult({ ok: true, text: `Flushed ${r.removed_documents} files and ${r.removed_chunks} vector chunks.` });
      setConfirmText("");
      await refresh();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const mismatch = info && info.your_chunks_expected !== info.your_chunks_indexed;

  return (
    <>
      <section className="stats">
        <div className="card stat">
          <span className="muted">Engine</span>
          <strong className="small-strong">{info?.engine ?? "-"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Embedding model</span>
          <strong className="small-strong">{info ? `${info.embedding_provider} / ${info.embedding_model}` : "-"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Your files</span>
          <strong>{info?.your_documents ?? "-"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Your vectors (active)</span>
          <strong>{info?.your_chunks_indexed ?? "-"}</strong>
          {mismatch && (
            <span className="error small">Expected {info.your_chunks_expected}. Some data is out of sync; a flush will clean it.</span>
          )}
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>Collections</h2>
          <button className="btn ghost" onClick={() => refresh()}>Refresh</button>
        </div>
        {!info?.collections.length ? (
          <p className="muted">No collections yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Status</th><th>Your chunks</th><th>Total chunks</th></tr>
            </thead>
            <tbody>
              {info.collections.map((c) => (
                <tr key={c.name}>
                  <td><code>{c.name}</code></td>
                  <td>{c.active ? <span className="chip">active</span> : <span className="muted">inactive (old model)</span>}</td>
                  <td>{c.your_chunks}</td>
                  <td>{c.total_chunks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card danger-zone">
        <h2>Danger zone: flush the vector database</h2>
        <p className="muted">
          Cancels any running uploads, then deletes all of your files and vectors from every collection (including
          collections from older embedding models). This cannot be undone.
        </p>
        {me?.is_admin && (
          <p className="muted">
            To wipe data for <b>all users</b>, use the <Link href="/admin">Admin</Link> tab.
          </p>
        )}
        <div className="row">
          <input
            placeholder='Type "FLUSH" to confirm'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button className="btn danger-solid" disabled={confirmText !== "FLUSH" || busy} onClick={flush}>
            {busy ? "Flushing..." : "Flush database"}
          </button>
        </div>
        {result && <p className={result.ok ? "ok" : "error"}>{result.text}</p>}
      </section>
    </>
  );
}
