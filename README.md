# Smart To-Do List AI-Powered

Full-stack technical challenge built with NestJS, Next.js, SQLite, Swagger and Docker Compose.

The app lets users manage tasks manually and ask a Hugging Face-hosted LLM to break a high-level goal into actionable tasks. The provider API key is configured only on the server through `.env`, so users do not need to paste secrets in the UI.

## Stack

- Backend: NestJS, TypeScript, TypeORM, SQLite, Swagger, Socket.IO
- Frontend: Next.js App Router, TypeScript, SWR, Playwright
- Infra: Docker Compose, Node.js 22
- Tests: Jest unit tests for backend business logic and AI parsing/error paths

## For Reviewers

Run the complete stack in one command:

```bash
cp .env.example .env
docker compose up --build
```

Then open `http://localhost:3000`. The API healthcheck is available at
`http://localhost:3001/health` and Swagger is available at
`http://localhost:3001/docs` in non-production mode.

To review the AI flow without a real API key, set `LLM_PROVIDER=mock` in `.env`.
The mock provider returns deterministic tasks, which makes
the app easy to demo and keeps E2E tests independent of external LLM services.

To review real LLM integration, keep `LLM_PROVIDER=huggingface`, set
`LLM_API_KEY` in `.env`, and use the Hugging Face defaults included in
`.env.example`.

Open the app in two browser tabs to see task changes sync through WebSocket
events. Useful quality commands:

```bash
npm --prefix apps/api test
npm --prefix apps/api run build
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm run test:e2e
```

Security decisions included for review: Helmet on Nest, explicit security
headers on Next, global API throttling, stricter AI-generation throttling,
Swagger gated outside production unless `ENABLE_SWAGGER=true`, and TypeORM
schema synchronization disabled unless `TYPEORM_SYNCHRONIZE=true`.

## Running With Docker

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Web app: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/docs

The compose file reads `.env` automatically. For real AI generation, fill
`LLM_API_KEY` in `.env`; for a no-key demo, set `LLM_PROVIDER=mock`.

## Running Locally

```bash
npm --prefix apps/api install
npm --prefix apps/web install
npm run dev:api
npm run dev:web
```

The API runs on `http://localhost:3001` and the web app on `http://localhost:3000`.
Open the app in two browser tabs to see task changes sync in real time through
WebSocket events.

## Environment

Create a local `.env` from the example file, then keep secrets only in `.env`:

```bash
cp .env.example .env
```

Use the same variables when running services locally outside Docker.

```bash
PORT=3001
CORS_ORIGIN=http://localhost:3000
SQLITE_PATH=./data/smart-todos.sqlite
ENABLE_SWAGGER=true
TYPEORM_SYNCHRONIZE=true
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=100
AI_THROTTLE_TTL_MS=60000
AI_THROTTLE_LIMIT=5
LLM_PROVIDER=huggingface
LLM_API_KEY=hf_your_token_here
LLM_BASE_URL=https://router.huggingface.co/v1
LLM_MODEL=openai/gpt-oss-20b:cheapest
LLM_TIMEOUT_MS=20000
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Replace `LLM_API_KEY` in your local `.env` with a Hugging Face token that has
Inference Providers permission. Keep real tokens only in `.env`, which is
ignored by git.

For a no-key demo, set:

```bash
LLM_PROVIDER=mock
```

The backend will not call any external provider in mock mode.

## API

- `GET /tasks`: list tasks
- `POST /tasks`: create a manual task with title, description and label
- `PATCH /tasks/:id`: update title, description, label or completion status
- `PATCH /tasks/:id/move`: move a task between kanban lanes and persist order
- `PATCH /tasks/reorder`: persist the execution queue order
- `DELETE /tasks/:id`: delete a task
- `POST /tasks/ai-generate`: generate and persist AI-created tasks
- `POST /tasks/ai-preview`: generate an editable AI draft without persisting
- `POST /tasks/ai-confirm`: persist an edited AI draft as generated tasks
- `GET /health`: API and database healthcheck

Swagger documentation is available at `/docs` when `NODE_ENV !== 'production'`
or `ENABLE_SWAGGER=true`.

## Quality Checks

```bash
npm --prefix apps/api test
npm --prefix apps/api run build
npm --prefix apps/web run lint
npm --prefix apps/web run build
npm run test:e2e
```

## Decisions And Trade-Offs

- TypeORM with SQLite was chosen for a fast, idiomatic NestJS implementation with portable persistence. Schema synchronization is opt-in through `TYPEORM_SYNCHRONIZE=true`; production should use explicit migrations.
- The LLM integration targets Hugging Face Inference Providers through its OpenAI-compatible chat completions router, so compatible providers can still be swapped by changing `LLM_BASE_URL` and `LLM_MODEL`.
- The AI response is treated as untrusted: the backend requests strict JSON, strips common code fences, validates the shape, deduplicates titles, limits generated tasks, retries transient provider failures once and refuses to persist anything when parsing fails.
- The main UI previews AI output before persistence so users can edit the story and subtasks, while `POST /tasks/ai-generate` remains available for reviewers and API clients that want the challenge's automatic persist flow.
- `LLM_PROVIDER=mock` is a deliberate demo and review mode. It proves the AI workflow without requiring secrets, network access or provider credits.
- Logs use JSON-formatted messages for important events such as task lifecycle changes, AI generation, provider failures, timeouts and invalid AI responses. They avoid API keys, raw prompts and raw provider responses.
- The provider API key is read from server environment only and is not sent by the browser, stored in SQLite or committed to the repository.
- Docker Compose includes healthchecks for both services, and the web service waits for a healthy API before starting.
- The workspace uses `legacy-peer-deps=true` so npm does not install unused vulnerable optional peers such as the `sqlite3` driver; the app uses `better-sqlite3` explicitly.
- `npm audit --omit=dev` still reports moderate transitive advisories in framework-pinned dependencies (`next -> postcss` and `typeorm -> uuid`). Forcing those fixes currently downgrades major packages, so they are documented rather than overridden unsafely.
