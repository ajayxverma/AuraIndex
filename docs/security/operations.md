# Security and Operations

## Authentication and authorization

- Passwords are stored using bcrypt hashes.
- Dashboard JWTs are signed with `JWT_SECRET`; use a unique random secret of at least 32 characters and keep it out of source control.
- Dashboard routes resolve the user from the JWT. Admin routes additionally check the user's current `is_admin` database flag.
- The first registered user automatically receives administrator privileges. For an existing database with no admin, initialization promotes the oldest user. This is convenient for a trusted local prototype but is not appropriate for an open public registration service.
- Generated API keys use a random `rag_` prefix and high-entropy secret. Only SHA-256 hash and display prefix are persisted; the full value is shown once. Revoke and replace leaked keys.
- API-key operations are scoped to the key owner, including vector search.

## Data isolation and destructive actions

- SQL queries for files and conversations are scoped to the authenticated user.
- Chroma vector metadata includes `user_id`; similarity search filters on it.
- A user flush deletes that user's vectors in every collection and their document rows. It does not delete conversations or API keys.
- Admin all-user flush cancels running jobs, removes all vector collections and document records, but retains users, API keys, and chat history.
- Admin user deletion removes the user's vectors, documents, keys, conversations, and messages. Admins cannot delete their own account or demote the last administrator.
- Destructive flushes require exact confirmation phrases and UI confirmation.

## Secrets and network

- `backend/.env` contains runtime secrets and should remain untracked and owner-readable only. Never commit or paste provider credentials into source files, docs, screenshots, or chat.
- A provider key previously exposed in a conversation should be revoked and replaced in the provider console.
- Local Chroma server mode defaults to `127.0.0.1:8001` and has no authentication configured here. Keep it bound to loopback; do not expose it publicly.
- The default app uses HTTP on localhost. A network deployment needs TLS/reverse proxy configuration, secure cookie/token handling strategy, restrictive CORS, rate limiting, request-size limits, and a threat model.
- Uploaded documents and chat prompts may contain sensitive data. Hosted embedding/LLM providers receive text required for embedding/generation; check provider retention and privacy terms before sending confidential content.

## Known operational risks

- Indexing jobs and progress live only in the backend process. Restarting the backend loses job status; an interruption may leave vectors without a SQLite document record. A durable task queue and reconciliation process are required before relying on unattended production indexing.
- SQLite is configured for local single-host use. High concurrency or multi-instance deployments should use a managed relational database and migrations.
- There is no configured automated backup/restore job. Back up SQLite and the Chroma data directory together while services are stopped.
- The code does not configure API rate limits, audit trails, account recovery, email verification, password reset, or login throttling.
- Chroma's HTTP server and SQLite files rely on filesystem and host access controls.

## Recommended production hardening

1. Disable public self-registration or require an administrator invitation; provision the first administrator out-of-band.
2. Replace in-memory jobs with a durable queue (for example, Redis-backed workers) and add startup reconciliation for partial vector writes.
3. Use managed PostgreSQL and formal schema migrations.
4. Put the API behind HTTPS, restrict network access to Chroma, and apply per-user/API-key rate limits.
5. Add monitoring, audit logging, backup automation, recovery testing, and key rotation procedures.
6. Add document retention/deletion policies and review provider data handling before indexing sensitive documents.
