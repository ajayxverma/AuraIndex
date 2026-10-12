# Project Documentation

This documentation describes the current implementation of the RAG Knowledge Base application. Start with the overview, then use the category that matches your question.

## Categories

### Product
- [Overview and features](product/features.md): user-facing workflows, supported files, and current limitations.

### Architecture
- [High-Level Design (HLD)](architecture/HLD.md): components, responsibilities, and system-level request/data flows.
- [Low-Level Design (LLD)](architecture/LLD.md): modules, database schema, indexing lifecycle, retrieval and chat persistence.

### Development
- [Local setup and operations](development/setup.md): prerequisites, environment configuration, run/stop scripts, and troubleshooting.

### API
- [HTTP API reference](api/reference.md): routes, authentication, request examples, and response behavior.

### Security and operations
- [Security model and operational notes](security/operations.md): credentials, authorization, data deletion, and deployment considerations.

## Current implementation at a glance

- **Frontend:** Next.js 15 App Router, React, TypeScript.
- **Backend:** FastAPI on Python 3.12.
- **Relational data:** SQLite via SQLAlchemy.
- **Vector search:** ChromaDB, normally as a separate local server.
- **Embeddings:** local all-MiniLM-L6-v2 by default; OpenAI-compatible embedding provider is also supported.
- **Chat model:** Groq by default through its OpenAI-compatible API; an OpenAI-compatible chat provider is supported.
- **Authentication:** bcrypt passwords and JWT dashboard sessions; generated API keys are stored as hashes.

## Scope note

This is a local-first application prototype. Indexing jobs are held in backend memory and are not durable across backend restarts. See [HLD](architecture/HLD.md) and [Security and operations](security/operations.md) before exposing it to a network or production users.
