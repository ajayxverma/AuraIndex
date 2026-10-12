"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import UploadPanel from "@/components/UploadPanel";
import { api, DocumentItem, formatBytes, Stats } from "@/lib/api";

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [files, setFiles] = useState<DocumentItem[]>([]);

  const refresh = useCallback(async () => {
    const [s, f] = await Promise.all([api<Stats>("/api/files/stats"), api<DocumentItem[]>("/api/files")]);
    setStats(s);
    setFiles(f);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  async function remove(doc: DocumentItem) {
    if (!confirm(`Delete "${doc.filename}" from the knowledge base?`)) return;
    await api(`/api/files/${doc.id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <>
      <section className="stats">
        <div className="card stat">
          <span className="muted">Total files</span>
          <strong>{stats?.total_files ?? "-"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Total size</span>
          <strong>{stats ? formatBytes(stats.total_bytes) : "-"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">Vector chunks</span>
          <strong>{stats?.total_chunks ?? "-"}</strong>
        </div>
        <div className="card stat">
          <span className="muted">File types</span>
          <div className="chips">
            {stats && Object.keys(stats.by_type).length === 0 && <span className="muted">none</span>}
            {stats &&
              Object.entries(stats.by_type).map(([t, n]) => (
                <span key={t} className="chip">
                  {t.toUpperCase()} <b>{n}</b>
                </span>
              ))}
          </div>
        </div>
      </section>

      <UploadPanel onIndexed={refresh} />

      <section className="card">
        <h2>Uploaded files</h2>
        {files.length === 0 ? (
          <p className="muted">No files uploaded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th>Size</th><th>Chunks</th><th>Uploaded</th><th />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>{f.filename}</td>
                  <td><span className="chip">{f.file_type.toUpperCase()}</span></td>
                  <td>{formatBytes(f.size_bytes)}</td>
                  <td>{f.chunk_count}</td>
                  <td>{new Date(f.created_at).toLocaleString()}</td>
                  <td><button className="btn danger" onClick={() => remove(f)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
