# Run the flash sale locally

This tutorial takes you from a fresh clone to the home page showing `Backend: ok`. Postgres and Redis run in Docker.
The two apps run on your machine.

You need [Volta](https://volta.sh/), Docker, and Git. Volta pins the Node and npm versions for this repository.

## 1. Install the dependencies

From the repository root:

```bash
npm install
```

`npm install` also installs the Git hooks.

## 2. Create the local env file

```bash
[ -f .env ] || cp .env.example .env
```

The values in `.env` are for local development only. Do not use them anywhere else.

## 3. Start Postgres and Redis

```bash
npm run docker:dev:up
```

The output ends with the two containers, `flash-dev-postgres-1` and `flash-dev-redis-1`, marked as healthy.

## 4. Apply the migrations

```bash
npx nx db:migrate flash-be
```

Nx reports `1 task: 1 succeeded`. The migration command prints nothing when the schema is already current.

## 5. Start the API

Run this in its own terminal and leave it running:

```bash
npx nx dev flash-be
```

In another terminal, check the two API endpoints:

```bash
curl localhost:8080/health
```

The response is `{"status":"ok"}`.

```bash
curl localhost:8080/ready
```

The response is `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

## 6. Start the web app

Run this in a third terminal and leave it running:

```bash
npx nx dev flash-web
```

Open <http://localhost:3000>. The page shows **Flash Sale** and **Backend: ok**. You can check the same text from the
shell:

```bash
curl -s localhost:3000/ | grep -o 'Backend: <strong>[a-z]*</strong>'
```

The output is `Backend: <strong>ok</strong>`.

## 7. Stop everything

Press Ctrl+C in the two `nx dev` terminals. Then stop the containers:

```bash
npm run docker:dev:down
```

## Next steps

- To add a behaviour, read [how-to: add a behaviour](../how-to/add-a-behaviour.md).
- To see every endpoint, read [reference: HTTP endpoints](../reference/http-endpoints.md).
