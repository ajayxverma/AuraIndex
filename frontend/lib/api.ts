export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "rag_token";

function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export const auth = {
  /** Returns the token only if present and not expired. */
  get: () => {
    if (typeof window === "undefined") return null;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const exp = tokenExpiry(token);
    if (exp !== null && exp <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return token;
  },
  expiresAt: () => {
    const token = typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
    return token ? tokenExpiry(token) : null;
  },
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Only same-origin relative paths are allowed as post-login targets (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")
    ? next
    : "/dashboard";
}

let redirecting = false;

export function redirectToLogin(reason: "expired" | "unauthorized" = "unauthorized") {
  if (typeof window === "undefined" || redirecting) return;
  redirecting = true;
  auth.clear();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}&reason=${reason}`);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = auth.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/register")) {
    redirectToLogin();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail.map((d: { msg: string }) => d.msg).join(", ") : body.detail;
    throw new ApiError(res.status, detail ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type DocumentItem = {
  id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  chunk_count: number;
  created_at: string;
};

export type Stats = {
  total_files: number;
  total_bytes: number;
  total_chunks: number;
  by_type: Record<string, number>;
};

export type ApiKeyItem = {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export type JobStatus = "queued" | "extracting" | "embedding" | "saving" | "done" | "failed" | "cancelled";

export type Job = {
  id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  status: JobStatus;
  progress: number;
  chunks_total: number;
  chunks_done: number;
  error: string | null;
};

export type UploadResponse = { jobs: Job[]; errors: { filename: string; error: string }[] };

// XHR instead of fetch because fetch has no upload-progress events.
export function uploadFile(file: File, onProgress: (pct: number) => void) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResponse>((resolve, reject) => {
    xhr.open("POST", `${API_URL}/api/files`);
    const token = auth.get();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: { detail?: string } & Partial<UploadResponse> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 401) redirectToLogin();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResponse);
      else reject(new Error(typeof body.detail === "string" ? body.detail : xhr.statusText || "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    const form = new FormData();
    form.append("files", file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
