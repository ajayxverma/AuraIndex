"use client";

import { useEffect, useRef, useState } from "react";
import { api, formatBytes, Job, JobStatus, uploadFile } from "@/lib/api";

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.xlsx,.html,.htm";
type Status = JobStatus | "uploading";
const TERMINAL = new Set<Status>(["done", "failed", "cancelled"]);
const LABELS: Record<Status, string> = {
  uploading: "Uploading",
  queued: "Queued",
  extracting: "Extracting text",
  embedding: "Indexing",
  saving: "Saving",
  done: "Indexed",
  failed: "Failed",
  cancelled: "Cancelled",
};

type Item = {
  key: string;
  filename: string;
  size: number;
  status: Status;
  progress: number;
  jobId?: string;
  chunksDone?: number;
  chunksTotal?: number;
  error?: string;
  abort?: () => void;
};

const fromJob = (j: Job): Partial<Item> => ({
  status: j.status,
  progress: j.progress,
  chunksDone: j.chunks_done,
  chunksTotal: j.chunks_total,
  error: j.error ?? undefined,
});

export default function UploadPanel({ onIndexed }: { onIndexed: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (key: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  // Resume tracking of jobs still running on the server (e.g. after a page reload).
  useEffect(() => {
    api<Job[]>("/api/files/jobs")
      .then((jobs) =>
        setItems(
          jobs
            .filter((j) => !TERMINAL.has(j.status))
            .map((j) => ({ key: j.id, jobId: j.id, filename: j.filename, size: j.size_bytes, ...fromJob(j) }) as Item),
        ),
      )
      .catch(() => {});
  }, []);

  const pollKey = items.filter((i) => i.jobId && !TERMINAL.has(i.status)).map((i) => i.jobId).join(",");

  useEffect(() => {
    if (!pollKey) return;
    const timer = setInterval(async () => {
      const jobs = await api<Job[]>("/api/files/jobs").catch(() => null);
      if (!jobs) return;
      const byId = new Map(jobs.map((j) => [j.id, j]));
      const finishedNow = itemsRef.current.some((it) => {
        const j = it.jobId && byId.get(it.jobId);
        return j && !TERMINAL.has(it.status) && j.status === "done";
      });
      setItems((prev) =>
        prev.map((it) => {
          if (!it.jobId || TERMINAL.has(it.status)) return it;
          const j = byId.get(it.jobId);
          if (!j) return { ...it, status: "failed", error: "Job was lost (server restarted?)" };
          return { ...it, ...fromJob(j) };
        }),
      );
      if (finishedNow) onIndexed();
    }, 1000);
    return () => clearInterval(timer);
  }, [pollKey, onIndexed]);

  function start(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    const newItems: Item[] = files.map((f, i) => ({
      key: `${Date.now()}-${i}-${f.name}`,
      filename: f.name,
      size: f.size,
      status: "uploading",
      progress: 0,
    }));
    setItems((prev) => [...newItems, ...prev]);
    if (inputRef.current) inputRef.current.value = "";

    files.forEach(async (file, i) => {
      const { key } = newItems[i];
      const { promise, abort } = uploadFile(file, (pct) => patch(key, { progress: pct }));
      patch(key, { abort });
      try {
        const res = await promise;
        const job = res.jobs[0];
        if (job) patch(key, { jobId: job.id, abort: undefined, ...fromJob(job) });
        else patch(key, { status: "failed", abort: undefined, error: res.errors[0]?.error ?? "Rejected" });
      } catch (err) {
        const cancelled = (err as Error).name === "AbortError";
        patch(key, { status: cancelled ? "cancelled" : "failed", abort: undefined, error: cancelled ? undefined : (err as Error).message });
      }
    });
  }

  async function cancel(it: Item) {
    if (it.status === "uploading") return it.abort?.();
    if (!it.jobId) return;
    try {
      const job = await api<Job>(`/api/files/jobs/${it.jobId}/cancel`, { method: "POST" });
      patch(it.key, fromJob(job));
    } catch (err) {
      patch(it.key, { error: (err as Error).message });
    }
  }

  const active = items.filter((i) => !TERMINAL.has(i.status)).length;

  return (
    <>
      <section
        className={`card dropzone ${dragOver ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); start(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => start(e.target.files)} />
        <p>Drag & drop files here, or click to browse</p>
        <p className="muted">PDF, DOCX, TXT, MD, CSV, XLSX, HTML</p>
      </section>

      {items.length > 0 && (
        <section className="card">
          <div className="row between">
            <h2>Uploads {active > 0 && <span className="muted">({active} in progress)</span>}</h2>
            <button
              className="btn ghost"
              disabled={items.length === active}
              onClick={() => setItems((prev) => prev.filter((i) => !TERMINAL.has(i.status)))}
            >
              Clear finished
            </button>
          </div>
          <ul className="uploads">
            {items.map((it) => (
              <li key={it.key}>
                <div className="row between">
                  <span className="upload-name">
                    {it.filename} <span className="muted">{formatBytes(it.size)}</span>
                  </span>
                  <span className={`upload-status ${it.status}`}>
                    {LABELS[it.status]}
                    {!TERMINAL.has(it.status) && ` ${Math.round(it.progress)}%`}
                    {it.status === "embedding" && it.chunksTotal ? ` (${it.chunksDone}/${it.chunksTotal} chunks)` : ""}
                  </span>
                  {!TERMINAL.has(it.status) && it.status !== "saving" && (
                    <button className="btn danger" onClick={() => cancel(it)}>Cancel</button>
                  )}
                </div>
                <div className="progress">
                  <div
                    className={`bar ${it.status}`}
                    style={{ width: `${TERMINAL.has(it.status) ? 100 : it.progress}%` }}
                  />
                </div>
                {it.error && <p className="error small">{it.error}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
