# Smart To-Do List AI-Powered

Full-stack technical challenge built with NestJS, Next.js, SQLite, Swagger and Docker Compose.

The app lets users manage tasks manually and ask an OpenAI-compatible LLM provider to break a high-level goal into actionable tasks. API keys are entered in the UI for each AI request and are never stored by the app.

## Stack

- Backend: NestJS, TypeScript, TypeORM, SQLite, Swagger
- Frontend: Next.js App Router, TypeScript, SWR
- Infra: Docker Compose, Node.js 22
- Tests: Jest unit tests for backend business logic and AI parsing/error paths

## Running With Docker

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Web app: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/docs

## Running Locally

```bash
npm install
npm run dev:api
npm run dev:web
```

The API runs on `http://localhost:3001` and the web app on `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env` for Docker, or export variables locally as needed.

```bash
PORT=3001
CORS_ORIGIN=http://localhost:3000
SQLITE_PATH=./data/smart-todos.sqlite
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

## API

- `GET /tasks`: list tasks
- `POST /tasks`: create a manual task
- `PATCH /tasks/:id`: update title or completion status
- `DELETE /tasks/:id`: delete a task
- `POST /tasks/ai-generate`: generate and persist AI-created tasks

Swagger documentation is available at `/docs`.

## Quality Checks

```bash
npm --prefix apps/api test
npm --prefix apps/api run build
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

## Decisions And Trade-Offs

- TypeORM with SQLite was chosen for a fast, idiomatic NestJS implementation with portable persistence. The app uses `synchronize` for challenge ergonomics; production should use explicit migrations.
- The LLM integration targets the OpenAI chat-completions shape so OpenRouter and OpenAI can be swapped by changing `LLM_BASE_URL` and `LLM_MODEL`.
- The AI response is treated as untrusted: the backend requests strict JSON, strips common code fences, validates the shape, deduplicates titles, limits generated tasks and refuses to persist anything when parsing fails.
- API keys are not stored in SQLite, localStorage or server config. This keeps the challenge safe to run and review without leaking secrets.
- The workspace uses `legacy-peer-deps=true` so npm does not install unused vulnerable optional peers such as the `sqlite3` driver; the app uses `better-sqlite3` explicitly.
- `npm audit --omit=dev` still reports moderate transitive advisories in framework-pinned dependencies (`next -> postcss` and `typeorm -> uuid`). Forcing those fixes currently downgrades major packages, so they are documented rather than overridden unsafely.
