# Local Development Runbook

## Prerequisites

- Node.js 20 or newer
- npm
- Docker Desktop

## 1. Start PostgreSQL

From the project root:

```bash
docker compose -f infrastructure/docker/compose.yaml up -d postgres
```

Verify database health:

```bash
docker compose -f infrastructure/docker/compose.yaml ps
```

Load or safely re-run the fictional sandbox data:

```bash
docker exec -i zerofayyz-fintech-postgres psql -U zerofayyz_fintech -d zerofayyz_fintech -f /dev/stdin < database/postgres/seeds/001_demo_data.sql
```

## 2. Start the Backend API

From `apps/api`:

```bash
npm install
npm run dev
```

The API listens at `http://127.0.0.1:4000`.

Health endpoint:

```text
GET http://127.0.0.1:4000/api/v1/health
```

## 3. Start the Web Dashboard

From `apps/web`:

```bash
npm install
npm run dev
```

The dashboard listens at `http://127.0.0.1:3000` and reads API health through the server-side `API_URL` setting.

## Verification

The dashboard should report:

- API service: Operational
- PostgreSQL: Operational
- Stripe sandbox: Not connected
- Webhook queue: Not connected

The recent-transactions table should report `Live sandbox records from PostgreSQL` and display four `.test` customers after loading the seed file.

## Stop Local Services

Stop the Node.js development servers with `Control-C` in their terminal windows.

From the project root, stop PostgreSQL without deleting its data:

```bash
docker compose -f infrastructure/docker/compose.yaml stop postgres
```
