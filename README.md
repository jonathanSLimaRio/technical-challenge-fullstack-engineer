# Smart To-Do List AI-Powered

Full-stack technical challenge built with NestJS, Next.js, SQLite, Swagger and Docker Compose.

The app lets users manage tasks manually and ask a Hugging Face-hosted LLM to break a high-level goal into actionable tasks. The provider API key is configured only on the server through `.env`, so users do not need to paste secrets in the UI.

## Stack

- Backend: NestJS, TypeScript, TypeORM, SQLite, Swagger, Socket.IO
- Frontend: Next.js App Router, TypeScript, SWR, Playwright
- Infra: Docker Compose, Node.js 22
- Tests: Jest unit tests for backend business logic and AI parsing/error paths

## For Reviewers

The fastest path is Docker Compose. From a fresh clone:

```bash
git clone <repository-url>
cd technical-challenge-fullstack-engineer
cp .env.example .env
```

Open `.env` and choose one AI mode:

```bash
# Real Hugging Face integration
LLM_PROVIDER=huggingface
LLM_API_KEY=hf_your_real_token_here
```

The token must have access to Hugging Face Inference Providers. If you only
want to review the product flow without an external provider, use mock mode:

```bash
LLM_PROVIDER=mock
LLM_API_KEY=
```

Then start the full stack:

```bash
docker compose up --build
```

When both containers are healthy, open:

- Web app: http://localhost:3000
- API healthcheck: http://localhost:3001/health
- Swagger: http://localhost:3001/docs

Manual task management works as soon as Docker is running. AI generation works
with either a valid Hugging Face key or `LLM_PROVIDER=mock`.

Useful review checks:

```bash
docker compose ps
curl http://localhost:3001/health
```

Open the app in two browser tabs to see task changes sync through WebSocket
events. Useful quality commands outside Docker:

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

Prerequisites: Docker Desktop or Docker Engine with Compose, and ports `3000`
and `3001` available.

```bash
cp .env.example .env
docker compose up --build
```

The compose file reads `.env` automatically and starts:

- Web app: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/docs

For real AI generation, fill `LLM_API_KEY` in `.env` and keep
`LLM_PROVIDER=huggingface`. For a no-key demo, set `LLM_PROVIDER=mock`.

To confirm the stack is ready:

```bash
docker compose ps
curl http://localhost:3001/health
```

To stop the containers:

```bash
docker compose down
```

To also remove the local SQLite Docker volume and start with an empty database:

```bash
docker compose down -v
```

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

## Decisões e Trade-Offs

- TypeORM com SQLite foi escolhido para uma implementação NestJS rápida e idiomática, com persistência portável. A sincronização de schema é opcional via `TYPEORM_SYNCHRONIZE=true`; em produção, devem ser usadas migrations explícitas.
- A integração com LLM usa Hugging Face Inference Providers por meio do roteador de chat completions compatível com OpenAI, então provedores compatíveis ainda podem ser trocados alterando `LLM_BASE_URL` e `LLM_MODEL`.
- A resposta da IA é tratada como não confiável: o backend solicita JSON estrito, remove code fences comuns, valida o formato, deduplica títulos, limita tarefas geradas, tenta novamente uma vez em falhas transitórias do provedor e se recusa a persistir qualquer dado quando o parsing falha.
- A UI principal exibe uma prévia da saída da IA antes da persistência para que usuários possam editar a história e as subtarefas, enquanto `POST /tasks/ai-generate` continua disponível para avaliadores e clientes de API que queiram o fluxo de persistência automática do desafio.
- `LLM_PROVIDER=mock` é um modo deliberado de demonstração e revisão. Ele comprova o fluxo de IA sem exigir secrets, acesso à rede ou créditos de provedor.
- Os logs usam mensagens em formato JSON para eventos importantes, como mudanças no ciclo de vida de tarefas, geração por IA, falhas de provedor, timeouts e respostas inválidas da IA. Eles evitam chaves de API, prompts brutos e respostas brutas do provedor.
- A chave de API do provedor é lida apenas do ambiente do servidor e não é enviada pelo navegador, armazenada no SQLite nem commitada no repositório.
- O Docker Compose inclui healthchecks para os dois serviços, e o serviço web aguarda uma API saudável antes de iniciar.
- O workspace usa `legacy-peer-deps=true` para que o npm não instale peers opcionais vulneráveis e não usados, como o driver `sqlite3`; a aplicação usa `better-sqlite3` explicitamente.
- `npm audit --omit=dev` ainda reporta advisories transitivos moderados em dependências fixadas pelos frameworks (`next -> postcss` e `typeorm -> uuid`). Forçar essas correções atualmente faz downgrade de pacotes major, então elas são documentadas em vez de sobrescritas de forma insegura.
