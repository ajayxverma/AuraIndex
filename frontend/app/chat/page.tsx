"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import AppShell from "@/components/AppShell";
import { api, API_URL, auth, redirectToLogin } from "@/lib/api";

type Source = { filename: string; text: string; score: number };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] | null; error?: string | null };
type Conversation = { id: string; title: string; updated_at: string };

export default function ChatPage() {
  return (
    <AppShell>
      <Chat />
    </AppShell>
  );
}

function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const list = await api<Conversation[]>("/api/chat/conversations");
    setConversations(list);
    return list;
  }, []);

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    const conv = await api<{ messages: Msg[] }>(`/api/chat/conversations/${id}`);
    setMessages(conv.messages);
  }, []);

  useEffect(() => {
    loadConversations()
      .then((list) => list[0] && openConversation(list[0].id))
      .catch(() => {});
  }, [loadConversations, openConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function newChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setInput("");
  }

  async function removeConversation(c: Conversation) {
    if (!confirm(`Delete chat "${c.title}"?`)) return;
    await api(`/api/chat/conversations/${c.id}`, { method: "DELETE" });
    if (c.id === activeId) newChat();
    await loadConversations();
  }

  async function removeAll() {
    if (!confirm("Delete ALL your chats? This cannot be undone.")) return;
    await api("/api/chat/conversations", { method: "DELETE" });
    newChat();
    setConversations([]);
  }

  async function saveRename(id: string) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    await api(`/api/chat/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    await loadConversations();
  }

  const updateLast = (fn: (m: Msg) => Msg) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setBusy(true);
    setInput("");

    let convId = activeId;
    try {
      if (!convId) {
        convId = (await api<Conversation>("/api/chat/conversations", { method: "POST", body: "{}" })).id;
        setActiveId(convId);
      }
      setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
      abortRef.current = new AbortController();

      const res = await fetch(`${API_URL}/api/chat/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.get()}` },
        body: JSON.stringify({ content: question }),
        signal: abortRef.current.signal,
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
      loadConversations().catch(() => {}); // pick up auto-generated title

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "sources") updateLast((m) => ({ ...m, sources: ev.sources }));
          else if (ev.type === "token") updateLast((m) => ({ ...m, content: m.content + ev.content }));
          else if (ev.type === "error") updateLast((m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") updateLast((m) => ({ ...m, error: (err as Error).message }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      loadConversations().catch(() => {});
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-layout">
      <aside className="card chat-sidebar">
        <button className="btn" onClick={newChat} disabled={busy}>+ New chat</button>
        <ul className="conv-list">
          {conversations.length === 0 && <li className="muted small">No chats yet.</li>}
          {conversations.map((c) => (
            <li key={c.id} className={c.id === activeId ? "active" : ""}>
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  maxLength={200}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => saveRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <>
                  <button className="conv-title" disabled={busy} onClick={() => openConversation(c.id)} title={c.title}>
                    {c.title}
                  </button>
                  <span className="conv-actions">
                    <button title="Rename" onClick={() => { setEditingId(c.id); setEditTitle(c.title); }}>✎</button>
                    <button title="Delete" onClick={() => removeConversation(c)} disabled={busy && c.id === activeId}>✕</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {conversations.length > 0 && (
          <button className="btn danger" onClick={removeAll} disabled={busy}>Delete all chats</button>
        )}
      </aside>

      <section className="card chat">
        <div className="chat-header">
          <h2>{conversations.find((c) => c.id === activeId)?.title ?? "New chat"}</h2>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <p className="muted chat-empty">Ask a question and answers will be grounded in your uploaded files.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.role === "assistant" ? (
                m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : !m.error && <span className="muted">Thinking...</span>
              ) : (
                <p>{m.content}</p>
              )}
              {m.error && <p className="error">{m.error}</p>}
              {m.sources && m.sources.length > 0 && (
                <details className="sources">
                  <summary>Sources ({[...new Set(m.sources.map((s) => s.filename))].join(", ")})</summary>
                  {m.sources.map((s, j) => (
                    <div key={j} className="source">
                      <b>{s.filename}</b> <span className="muted">score {s.score}</span>
                      <p>{s.text.length > 400 ? s.text.slice(0, 400) + "..." : s.text}</p>
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form className="chat-input" onSubmit={send}>
          <textarea
            rows={2}
            placeholder="Ask about your documents... (Enter to send, Shift+Enter for new line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
          ) : (
            <button className="btn" disabled={!input.trim()}>Send</button>
          )}
        </form>
      </section>
    </div>
  );
}
