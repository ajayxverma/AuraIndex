"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api, auth, safeNext } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const nextPath = () => safeNext(new URLSearchParams(window.location.search).get("next"));

  useEffect(() => {
    if (auth.get()) {
      router.replace(nextPath());
      return;
    }
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "expired") setNotice("Your session expired. Please sign in again.");
    else if (reason === "unauthorized") setNotice("Please sign in to continue.");
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { access_token } = await api<{ access_token: string }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      auth.set(access_token);
      router.replace(nextPath());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
        {notice && <p className="muted">{notice}</p>}
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn" disabled={busy}>
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Register"}
        </button>
        <p className="muted">
          {mode === "login" ? "No account?" : "Already registered?"}{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "login" ? "register" : "login"); }}>
            {mode === "login" ? "Register" : "Sign in"}
          </a>
        </p>
      </form>
    </div>
  );
}
