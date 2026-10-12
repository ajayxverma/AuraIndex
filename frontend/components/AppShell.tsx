"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, auth, redirectToLogin } from "@/lib/api";
import { Me, MeContext } from "@/lib/me";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const exp = auth.expiresAt();
    if (!auth.get()) {
      redirectToLogin(exp && exp <= Date.now() ? "expired" : "unauthorized");
      return;
    }
    // A 401 here is redirected by api(); anything else (e.g. backend down) is shown.
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setLoadError((e as Error).message || "Could not reach the server");
      });

    if (!exp) return;
    const timer = setTimeout(() => redirectToLogin("expired"), Math.max(0, exp - Date.now()));
    return () => clearTimeout(timer);
  }, []);

  if (loadError) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h2>Can&apos;t load the app</h2>
          <p className="error">{loadError}</p>
          <button className="btn" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!me) return null;

  const link = (href: string, label: string) => (
    <Link href={href} className={pathname === href ? "active" : ""}>
      {label}
    </Link>
  );

  return (
    <MeContext.Provider value={me}>
      <header className="nav">
        <strong>RAG Knowledge Base</strong>
        <nav>
          {link("/dashboard", "Dashboard")}
          {link("/chat", "Chat")}
          {link("/vector-db", "Vector DB")}
          {link("/api-keys", "API Keys")}
          {me.is_admin && link("/admin", "Admin")}
        </nav>
        <span className="muted small">
          {me.email} {me.is_admin && <span className="chip">admin</span>}
        </span>
        <button
          className="btn ghost"
          onClick={() => {
            auth.clear();
            router.replace("/login");
          }}
        >
          Logout
        </button>
      </header>
      <main className="container">{children}</main>
    </MeContext.Provider>
  );
}
