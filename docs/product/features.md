# Product: Features and Workflows

## Overview

The RAG Knowledge Base application lets each user upload documents, index extracted text in ChromaDB, ask questions grounded in those documents, manage chat history, and create API keys for programmatic access.

## Authentication and roles

- Register with email and password; passwords are stored as bcrypt hashes.
- Log in to receive a JWT used by dashboard routes.
- The first registered account becomes an administrator. On an existing database with no administrator, startup promotes the oldest account.
- Administrators can list users, change admin roles, delete other users, and flush vectors across all users.
- Users cannot see another user's documents, API keys, or conversations.

## Document management

- Upload one or multiple files using drag-and-drop or the file picker.
- Supported extensions: PDF, DOCX, TXT, MD, CSV, XLSX, HTML, HTM.
- Per-file upload transport progress and background indexing progress are shown separately.
- Indexing progress includes completed/total chunks. Upload jobs can be cancelled. Already-inserted chunks for that job are removed during cancellation/failure cleanup.
- Same-content files are rejected for a user if already indexed or currently being indexed.
- Dashboard statistics show file count, total size, chunk count, and counts by extension.
- Deleting a document removes its vectors and SQLite metadata.
- Maximum upload size defaults to 25 MB per file (`MAX_UPLOAD_MB`).

## Chat and retrieval

- Create multiple conversations, reopen them, rename them, delete an individual conversation, or delete all of your conversations.
- The first user message generates a title from its first 60 characters.
- Chat messages and retrieval sources are saved in SQLite. Streaming responses render incrementally; pressing Stop retains a partial assistant response.
- Follow-up requests use up to the most recent 10 exchanges as language-model history.
- Retrieval filters Chroma results to the authenticated user's vectors and returns source filenames, chunk text, and similarity score.
- The assistant is instructed to answer from retrieved context and say when context lacks the answer.

## API keys and integrations

- Generate named keys for API access. The full key is displayed only when created; the database stores its SHA-256 hash and a short display prefix.
- Keys can be listed and revoked. Last-used time is recorded.
- Supported entry points include `POST /api/query`, `GET /v1/models`, and `POST /v1/chat/completions` (including streaming).
- OpenAI-compatible integrations use model ID `rag-knowledge-base` and base URL `http://localhost:8000/v1` for local use.

## Vector DB and administration

- The Vector DB page displays embedding configuration, collection names, and vector counts.
- A user can flush their own vectors and file records across collections after typing `FLUSH`.
- An administrator can flush all users' vectors and file records after typing `FLUSH ALL`; user accounts and API keys remain.
- Chroma collections are separated by embedding provider/model. Changing embeddings therefore does not silently mix incompatible vector dimensions.

## Current limitations

- The upload job queue is an in-process, two-worker `ThreadPoolExecutor`; jobs and progress are lost if the backend restarts. For production, replace this with a durable worker queue.
- Uploaded original binary files are not retained; extracted text chunks and metadata are stored in ChromaDB/SQLite.
- PDF extraction is text-based; scanned image-only PDFs require OCR, which is not currently implemented.
- Conversation history is persistent, but there is no export/search/share feature yet.
- The first-account administrator bootstrap is suitable only for a trusted local setup. See [Security and operations](../security/operations.md).
