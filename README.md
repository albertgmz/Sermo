# Sermo

Sermo is a forum backend with a REST API and an MCP tool endpoint. It runs on Bun, TypeScript, SQLite, Hono, and Better Auth. There is no frontend yet.

`packages/core` owns business rules and every permission check. `packages/api` serves REST; `packages/mcp` serves MCP. REST routes, the OpenAPI document and MCP tools are all derived from one operation registry in core. The OpenAPI document also covers every `/api/auth/*` endpoint. The single server process also runs migrations, the job worker, scheduler, and WAL checkpointer.

## Quick start with Docker

1. Copy the configuration: `cp .env.example .env`.
2. Generate a secret with `docker run --rm oven/bun:1.4.2-slim bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'))"` and put its output in `BETTER_AUTH_SECRET` in `.env`. Set all three `SERMO_ADMIN_*` values if you want an administrator created at startup.
3. Run `docker compose up -d --build`.
4. Check `http://localhost:3000/health` for `{"status":"ok"}`. The API description is at `http://localhost:3000/api/v1/openapi.json`.

Compose mounts a named volume at `/data`; the database is `/data/sermo.db` and local uploads are under `/data/files`. Startup applies migrations to a new volume. `docker compose down` keeps the volume; `docker compose down -v` removes it and its data. Set `SERMO_STORAGE_DRIVER=s3` and the `SERMO_S3_*` values in `.env` to use Amazon S3 or Cloudflare R2 on a new installation; no image change is needed.

To verify SQLite FTS5 in the image, run:

```sh
docker compose exec sermo bun -e "new (require('bun:sqlite').Database)(':memory:').run('create virtual table t using fts5(x)')"
```

## Local development

Install Bun 1.4.2, copy `.env.example` to `.env`, and set `BETTER_AUTH_SECRET` as above (or generate it with local Bun). Bun reads `.env` when the server starts. Then run:

```sh
bun install
bun run start
```

The local database defaults to `./data/sermo.db`. `bun run check:fast` runs typecheck, lint, and tests. `bun run check` adds the full benchmark.

The benchmark seeds a deterministic database with about 1 million posts and 2 million reactions in `SERMO_BENCH_DIR` (default `~/.cache/sermo-bench`), outside the repository. The seed is about 2.6 GB; each checkout keeps a working copy beside it, so the first run needs about 5.4 GB. Seeding takes about 45 seconds and repeats when migrations or the seed version change. Every scenario goes through the HTTP app and its middleware. Reads must have p95 at or below 20 ms, writes p95 at or below 50 ms, and no request may exceed 200 ms; password hashing is exempt. To run a subset:

```sh
bun run bench --only "threads.get"
```

Add `--reuse` on later runs to retain the scratch database between runs.

## Authentication and clients

Better Auth handles registration, sign-in, sessions, and API keys under `/api/auth`. Register with `POST /api/auth/sign-up/email` and a JSON body containing `email`, `password`, `name`, and `username`. The username is required, 3–32 characters long, and may contain letters, numbers, spaces, `.`, `-`, and `_`; use a letter or number at either end. An optional `displayUsername` must match the username apart from letter case; `name` is free text. Passwords must be 8–256 characters. Sign in with `POST /api/auth/sign-in/email` (email and password) or `POST /api/auth/sign-in/username` (username and password).

Browser clients use the session cookie. REST and MCP clients can send an API key as `Authorization: Bearer <key>` or `x-api-key: <key>`. Keys have the same permissions as their owner. Requests without credentials run as a guest. Cookie-carrying POST requests to `/api/auth/*`, including API key creation, need an `Origin` header equal to `BETTER_AUTH_URL`; Better Auth rejects a missing origin. Cookie-authenticated REST writes also need `Content-Type: application/json`.

To create a key for an MCP client, sign in with an account (the bootstrapped admin is one option), then call the key creation endpoint with that session. For example, after setting `SERMO_USERNAME` and `SERMO_PASSWORD` in a POSIX shell with the default `BETTER_AUTH_URL`:

```sh
cookie_file=$(mktemp)
curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d "{\"username\":\"$SERMO_USERNAME\",\"password\":\"$SERMO_PASSWORD\"}" http://localhost:3000/api/auth/sign-in/username
curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -d '{"name":"mcp-client"}' http://localhost:3000/api/auth/api-key/create
rm -f "$cookie_file"
```

The shell-built JSON in the sign-in example needs proper JSON escaping if a username or password contains `"` or `\`. Copy the returned `key` immediately. API keys cannot create or revoke other keys; manage them with a session. MCP uses stateless Streamable HTTP at `/mcp`. Tool names replace dots in operation names with underscores, for example `posts_create`. A raw tool-list request is:

```sh
curl -sS http://localhost:3000/mcp -H 'Authorization: Bearer sermo_your_key_here' -H 'Accept: application/json, text/event-stream' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A client configuration that supports Streamable HTTP can use the following shape; the `type` value varies by client:

```json
{
  "mcpServers": {
    "sermo": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer sermo_your_key_here" }
    }
  }
}
```

REST routes and their request and response schemas are documented at `/api/v1/openapi.json`.

## Security and configuration

Markdown is rendered and sanitized before storage. Cookie-authenticated REST writes enforce origin based CSRF checks and JSON content type. The HTTP adapter sets secure headers and applies 60-second, in-memory limits: 300 reads (GET/HEAD), 60 writes, 30 searches, and 60 MCP requests. Buckets are per API key, per signed-in user, or per IP for guests. Better Auth limits its own sign-in and sign-up endpoints separately. The adapter discards client-supplied `x-sermo-client-ip` and sets that header from the socket or configured proxy header.

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Required signing secret; generate at least 32 random bytes as shown above. |
| `BETTER_AUTH_URL` | Required public server URL and trusted origin; use HTTPS for a public deployment. |
| `SERMO_SITE_URL` | Public site origin for canonical links, sitemaps and feeds; defaults to `BETTER_AUTH_URL`. |
| `SERMO_TRUSTED_ORIGINS` | Additional comma-separated origins allowed for cookie requests. |
| `SERMO_TRUSTED_PROXY_HEADER` | Client IP header, such as `x-forwarded-for`; the adapter uses its last comma-separated value. Set it only with exactly one trusted proxy in front of Sermo that appends to this header; leave empty for direct connections. |
| `SERMO_ADMIN_USERNAME`, `SERMO_ADMIN_EMAIL`, `SERMO_ADMIN_PASSWORD` | Optional administrator bootstrap; set all three together. |
| `PORT` | Listening port; keep `3000` with the supplied Compose mapping and health check. |
| `SERMO_DB_PATH` | SQLite file path; Compose sets `/data/sermo.db`, local default is `./data/sermo.db`. |
| `SERMO_FILES_DIR` | Local upload directory. Keep it under `/data` with Compose so the named volume persists files. |
| `SERMO_STORAGE_DRIVER` | `local` (default) or `s3`. |
| `SERMO_S3_BUCKET`, `SERMO_S3_ENDPOINT`, `SERMO_S3_REGION`, `SERMO_S3_ACCESS_KEY_ID`, `SERMO_S3_SECRET_ACCESS_KEY` | Bucket configuration. Use the R2 endpoint for Cloudflare R2; the endpoint is optional for Amazon S3. |
| `SERMO_PUBLIC_FILES_URL` | Optional proxy or CDN origin for public profile and node images; it must forward Sermo file paths to this API. |
| `SERMO_BENCH_DIR` | Optional benchmark seed directory; default is `~/.cache/sermo-bench`. |

## Moving stored files

Stop the API before a driver migration. The command streams and hashes each live file, verifies the destination bytes, then switches that file's database record. It keeps the source bytes for rollback. If interrupted, rerun the same command; records already switched are skipped and a completed destination copy is reused.

For a Compose installation moving from local files to a bucket, set the `SERMO_S3_*` values in `.env`, then run:

```sh
docker compose stop sermo
docker compose run --rm sermo bun run storage:migrate --from local --to s3
```

When it reports completion, set `SERMO_STORAGE_DRIVER=s3` in `.env` and run `docker compose up -d`. Keep the API stopped until the command completes. Use `--from s3 --to local` to reverse the move. Local installations can run `bun run storage:migrate --from local --to s3` with the same environment variables. The command refuses unfinished file deletions; let the jobs worker finish those before stopping the API. Back up the database and local files before a move.

## Backups

SQLite uses WAL mode. The image has no `sqlite3` executable. For a live backup, use Bun's SQLite binding to write a consistent copy with `VACUUM INTO`, copy it off the volume, then remove the temporary copy there:

```sh
docker compose exec sermo bun -e "new (require('bun:sqlite').Database)('/data/sermo.db').run(\"VACUUM INTO '/data/sermo-backup.db'\")"
docker compose cp sermo:/data/sermo-backup.db ./sermo-backup.db
docker compose exec sermo bun -e "require('node:fs').unlinkSync('/data/sermo-backup.db')"
```

For an offline backup, stop the service and copy the main database file from the stopped container:

```sh
docker compose stop
docker compose cp sermo:/data/sermo.db ./sermo.db
docker compose start
```

A graceful stop folds the WAL into the main file. After a crash, also copy `sermo.db-wal` before starting the service. Keep backups outside the Compose volume and protect them like the live database.

## Web Push

Web Push is disabled until all three VAPID settings are set. Generate a permanent key pair with
`bunx web-push generate-vapid-keys --json`, then set `SERMO_VAPID_PUBLIC_KEY` and
`SERMO_VAPID_PRIVATE_KEY` from the output. Set `SERMO_VAPID_SUBJECT` to a contact URI such as
`mailto:admin@example.com` (or an HTTPS URL). Keep the private key secret and retain the same
pair across restarts so existing browser subscriptions stay valid. Clients can read the public key
from `GET /api/v1/push/public-key`, register devices with `PUT /api/v1/push/subscriptions`,
list their devices with `GET /api/v1/push/subscriptions`, and remove one with
`DELETE /api/v1/push/subscriptions`. Subscriptions are limited to ten per member; the oldest is
replaced when an eleventh device is registered. Endpoints must belong to the supported Google,
Mozilla, Microsoft, or Apple push services.
