# RAG Knowledge Base

A local-first application for uploading documents, indexing their contents in ChromaDB, and asking questions grounded in those documents. It includes user authentication, admin controls, persistent chat history, upload progress/cancellation, and API-key access for external clients.

## Quick Start

```bash
./run.sh
```

Open http://localhost:3000. The first registered account becomes the administrator. FastAPI's interactive docs are at http://localhost:8000/docs.

Stop all services:

```bash
./stop.sh
```

Configure providers and secrets in `backend/.env`. On first startup, `run.sh` creates the file with a random JWT secret; set `LLM_API_KEY` to enable hosted chat generation. See [Local Setup and Operations](docs/development/setup.md).

## Documentation

Documentation is categorized in [`docs/`](docs/README.md):

- **Product:** [Features and user workflows](docs/product/features.md)
- **Architecture:** [High-Level Design (HLD)](docs/architecture/HLD.md) and [Low-Level Design (LLD)](docs/architecture/LLD.md)
- **Development:** [Local setup, configuration, data and troubleshooting](docs/development/setup.md)
- **API:** [HTTP API reference](docs/api/reference.md)
- **Security and operations:** [Authentication, data boundaries, risks and hardening](docs/security/operations.md)

## Technology Overview

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React, TypeScript |
| Backend | FastAPI, Python 3.12 |
| Relational data | SQLite, SQLAlchemy |
| Vector search | ChromaDB |
| Embeddings | Local all-MiniLM-L6-v2 by default; OpenAI-compatible option |
| Chat generation | Groq by default; OpenAI-compatible option |

See the [documentation index](docs/README.md) for scope and current implementation limitations.
