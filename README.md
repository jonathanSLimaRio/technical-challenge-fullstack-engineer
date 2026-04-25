# Smart To-Do List AI-Powered

Full-stack technical challenge built with NestJS, Next.js, SQLite, Swagger and Docker Compose.

The app lets users manage tasks manually and ask an OpenAI-compatible LLM provider to break a high-level goal into actionable tasks. API keys are entered in the UI for each AI request and are never stored by the app.

## Stack

- Backend: NestJS, TypeScript, TypeORM, SQLite, Swagger, Socket.IO
- Frontend: Next.js App Router, TypeScript, SWR, Playwright
- Infra: Docker Compose, Node.js 22
- Tests: Jest unit tests for backend business logic and AI parsing/error paths

## For Reviewers

Run the complete stack in one command:

```bash
docker compose up --build
```

Then open `http://localhost:3000`. The API healthcheck is available at
`http://localhost:3001/health` and Swagger is available at
`http://localhost:3001/docs` in non-production mode.

To review the AI flow without a real API key, set `LLM_PROVIDER=mock` and enter
`demo-key` in the UI. The mock provider returns deterministic tasks, which makes
the app easy to demo and keeps E2E tests independent of external LLM services.

To review real LLM integration, keep `LLM_PROVIDER=openai-compatible`, use
OpenRouter defaults, and paste a provider key in the UI. For OpenAI directly:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

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
docker compose up --build
```

Then open:

- Web app: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/docs

The compose file includes local defaults. Copy `.env.example` to `.env` only if
you want to customize ports, CORS, SQLite path or LLM provider settings.

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

Copy `.env.example` to `.env` for Docker, or export variables locally as needed.

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
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
LLM_TIMEOUT_MS=20000
NEXT_PUBLIC_API_URL=http://localhost:3001
```

To use OpenAI directly, set:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

The LLM API key is intentionally not configured in `.env`; it is provided in the web form and sent only with the AI generation request.

For a no-key demo, set:

```bash
LLM_PROVIDER=mock
```

Then enter `demo-key` in the UI. The backend will not call any external
provider in mock mode.

## API

- `GET /tasks`: list tasks
- `POST /tasks`: create a manual task
- `PATCH /tasks/:id`: update title or completion status
- `DELETE /tasks/:id`: delete a task
- `POST /tasks/ai-generate`: generate and persist AI-created tasks
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
- The LLM integration targets the OpenAI chat-completions shape so OpenRouter and OpenAI can be swapped by changing `LLM_BASE_URL` and `LLM_MODEL`.
- The AI response is treated as untrusted: the backend requests strict JSON, strips common code fences, validates the shape, deduplicates titles, limits generated tasks, retries transient provider failures once and refuses to persist anything when parsing fails.
- `LLM_PROVIDER=mock` is a deliberate demo and review mode. It proves the AI workflow without requiring secrets, network access or provider credits.
- Logs use JSON-formatted messages for important events such as task lifecycle changes, AI generation, provider failures, timeouts and invalid AI responses. They avoid API keys, raw prompts and raw provider responses.
- API keys are not stored in SQLite, localStorage or server config. This keeps the challenge safe to run and review without leaking secrets.
- Docker Compose includes healthchecks for both services, and the web service waits for a healthy API before starting.
- The workspace uses `legacy-peer-deps=true` so npm does not install unused vulnerable optional peers such as the `sqlite3` driver; the app uses `better-sqlite3` explicitly.
- `npm audit --omit=dev` still reports moderate transitive advisories in framework-pinned dependencies (`next -> postcss` and `typeorm -> uuid`). Forcing those fixes currently downgrades major packages, so they are documented rather than overridden unsafely.
