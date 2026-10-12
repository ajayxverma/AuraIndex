"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me";

type AdminUser = {
  id: number;
  email: string;
  is_admin: boolean;
  created_at: string;
  documents: number;
  chunks: number;
  api_keys: number;
};

type Collection = { name: string; active: boolean; total_chunks: number };

const FLUSH_ALL = "FLUSH ALL";

export default function AdminPage() {
  return (
    <AppShell>
      <Admin />
    </AppShell>
  );
}

function Admin() {
  const me = useMe();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [u, v] = await Promise.all([
      api<AdminUser[]>("/api/admin/users"),
      api<{ collections: Collection[] }>("/api/vectordb"),
    ]);
    setUsers(u);
    setCollections(v.collections);
  }, []);

  useEffect(() => {
    if (me?.is_admin) refresh().catch((e) => setNotice({ ok: false, text: (e as Error).message }));
  }, [me, refresh]);

  if (!me?.is_admin) {
    return (
      <section className="card">
        <h2>Admins only</h2>
        <p className="muted">You don&apos;t have permission to view this page.</p>
      </section>
    );
  }

  async function run(action: () => Promise<string>) {
    setNotice(null);
    try {
      setNotice({ ok: true, text: await action() });
      await refresh();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }

  const toggleAdmin = (u: AdminUser) =>
    run(async () => {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ is_admin: !u.is_admin }) });
      return `${u.email} is ${u.is_admin ? "no longer an admin" : "now an admin"}.`;
    });

  const deleteUser = (u: AdminUser) => {
    if (!confirm(`Delete ${u.email}? This removes their files, vectors and API keys permanently.`)) return;
    run(async () => {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      return `Deleted ${u.email}.`;
    });
  };

  async function flushAll() {
    if (!confirm("This permanently deletes EVERY user's files and vectors. Continue?")) return;
    setBusy(true);
    await run(async () => {
      const r = await api<{ removed_documents: number; removed_chunks: number }>("/api/admin/flush-all", {
        method: "POST",
        body: JSON.stringify({ confirm: confirmText }),
      });
      setConfirmText("");
      return `Flushed ${r.removed_documents} files and ${r.removed_chunks} vector chunks across all users.`;
    });
    setBusy(false);
  }

  const totalDocs = users.reduce((n, u) => n + u.documents, 0);
  const totalChunks = collections.reduce((n, c) => n + c.total_chunks, 0);

  return (
    <>
      <section className="stats">
        <div className="card stat"><span className="muted">Users</span><strong>{users.length}</strong></div>
        <div className="card stat"><span className="muted">Admins</span><strong>{users.filter((u) => u.is_admin).length}</strong></div>
        <div className="card stat"><span className="muted">Files (all users)</span><strong>{totalDocs}</strong></div>
        <div className="card stat"><span className="muted">Vectors (all collections)</span><strong>{totalChunks}</strong></div>
      </section>

      {notice && <p className={notice.ok ? "ok" : "error"}>{notice.text}</p>}

      <section className="card">
        <h2>Users</h2>
        <table>
          <thead>
            <tr><th>Email</th><th>Role</th><th>Files</th><th>Chunks</th><th>API keys</th><th>Joined</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email} {u.id === me.id && <span className="muted">(you)</span>}</td>
                <td>{u.is_admin ? <span className="chip">admin</span> : <span className="muted">user</span>}</td>
                <td>{u.documents}</td>
                <td>{u.chunks}</td>
                <td>{u.api_keys}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="row">
                  <button className="btn ghost" onClick={() => toggleAdmin(u)}>
                    {u.is_admin ? "Remove admin" : "Make admin"}
                  </button>
                  {u.id !== me.id && (
                    <button className="btn danger" onClick={() => deleteUser(u)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card danger-zone">
        <h2>Danger zone: flush the entire vector database</h2>
        <p className="muted">
          Cancels every running upload and deletes <b>all users&apos;</b> files and every ChromaDB collection. User
          accounts and API keys are kept. This cannot be undone.
        </p>
        <div className="row">
          <input placeholder={`Type "${FLUSH_ALL}" to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <button className="btn danger-solid" disabled={confirmText !== FLUSH_ALL || busy} onClick={flushAll}>
            {busy ? "Flushing..." : "Flush everything"}
          </button>
        </div>
      </section>
    </>
  );
}
