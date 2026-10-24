# Sermo

[![Bun 1.4.2](https://img.shields.io/badge/Bun-1.4.2-000000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Sermo is forum software in the tradition of XenForo and Invision: forums and threads, profile
walls, direct messages, reactions, an economy of credits, awards and a shop, and a full staff
panel for moderation and administration. The backend is one Bun process over a single SQLite file
that serves a REST API and an MCP endpoint from the same operation registry; the web app is a
Next.js site that keeps no data and talks to the backend only over REST. It is built to stay fast
on a large forum: every read and write is held to a latency budget on a seeded database of a
million posts.

**Live:** [fcuba.net](https://fcuba.net), a community of about 67,000 members, runs on Sermo.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Local development](#local-development)
- [Repository layout](#repository-layout)
- [Testing and benchmark](#testing-and-benchmark)
- [Documentation](#documentation)
- [License](#license)

## Features

**Forum and threads**
- Categories, forums and sub-forums under section tabs; thread prefixes, sticky and locked threads,
  thread covers, polls and quizzes, hashtags.
- Stable post positions and keyset pagination, so a link to page 40 stays right while posts are
  hidden or restored. Unread tracking per thread, bookmarks, watched threads and forums.
- Full-text search (SQLite FTS5), Atom feeds, sitemaps, `llms.txt`, a Markdown copy of public
  threads, IndexNow and structured data.
- What's new (`/novedades`): Latest, Hot, Following and Media tabs beside the forum list on `/`.

**Editor**
- A rich editor (Lexical) that reads and writes BB code, XenForo's tag set: quotes with their
  author, spoilers, code, tables, lists, headings, colours and fonts.
- Mentions, attachments with WebP copies for narrow screens, and embeds from YouTube, Vimeo,
  Spotify, SoundCloud, TikTok, Instagram, X, Facebook, Reddit and Twitch.
- Drafts kept while writing; BB code is rendered and sanitized once, at write time.

**Members and community**
- Profiles with walls and comments, follow and ignore, a member card on hover, who is online,
  monthly standings, birthdays and referrals.
- Direct messages with several participants, reactions on every kind of content.
- An economy: credits with a ledger, credit rules, awards with XP and levels, and a shop of name
  colours, frames, covers, perks and ranks.
- English and Spanish interface, chosen per visitor; light and dark themes; a data saver that
  stops pictures from loading.

**Notifications and the app**
- Alerts for replies, quotes, mentions, reactions, follows and messages, with per-type
  preferences for the site, email and push.
- Email through SMTP with one-click unsubscribe and a weekly digest for members who stay away.
- Installable as an app (web manifest and a small service worker) with Web Push notifications.

**Moderation and administration**
- Groups, a permission engine with node and member-specific entries, and automatic promotions
  driven by one shared criteria engine.
- Reports, an approval queue, word filters, Cloudflare Turnstile, new-member limits, warnings,
  bans, restrictions, thread bans, spam cleanup, thread merge and split, and a moderator log.
- A staff panel for forums, groups, permissions, appearance, widgets, notices, broadcasts, static
  pages, sign-up approval, batch member updates, account erasure and the cookie banner.

**API and MCP**
- A REST API under `/api/v1` with an OpenAPI document and a public reference page at `/developer`.
- An MCP endpoint (`/mcp`, Streamable HTTP) with one tool per operation, authorized by the
  member's API key and their own permissions.
- Authentication by Better Auth: sessions, email verification, password reset and API keys;
  XenForo bcrypt hashes from an import are accepted and upgraded on first sign-in.

**Performance and security**
- Budgets enforced by the benchmark: reads p95 at or below 20 ms, writes p95 at or below 50 ms,
  nothing above 200 ms, on 1 million posts and 2 million reactions.
- Denormalized counters, covering indexes checked by tests, no `OFFSET`, no N+1 queries, and a
  background WAL checkpointer so requests never pay for it.
- Every permission decision goes through one engine, with a static test that every operation
  checks one. CSRF checks, JSON-only cookie writes, secure headers and per-bucket rate limits.
- Uploads on the local disk or in Amazon S3 or Cloudflare R2.

## Quick start

Sermo runs in Docker as three containers: the backend, the web app and a Caddy ingress, which is
the only published port.

```sh
cp .env.example .env
# Set BETTER_AUTH_SECRET (the command to make one is in .env.example) and the three
# SERMO_ADMIN_* values for the first administrator.
docker compose up --build -d
```

Open `http://localhost:8080` and sign in as that administrator; the panel is at `/admin`. If port
8080 is taken, set `INGRESS_PORT` and change `BETTER_AUTH_URL` with it.

A new site is empty. To load the starter forums, pictures, shop, awards and pages:

```sh
docker compose exec sermo bun run starter:load --admin <username>
```

Everything it loads can be changed in the panel afterwards
([scripts/starter/README.md](scripts/starter/README.md)). Configuration, upgrades, backups, TLS
and the upload limit are in [docs/deployment.md](docs/deployment.md).

## Local development

Install [Bun](https://bun.sh) 1.4.2, the version the images and CI use.

```sh
bun install
cp .env.example .env            # set BETTER_AUTH_SECRET
```

To work on the web app, run the API on port 8787 behind it. Add these to `.env`:

```sh
PORT=8787
BETTER_AUTH_URL=http://localhost:3000
SERMO_TRUSTED_PROXY_HEADER=x-forwarded-for
SERMO_SESSION_COOKIE_CACHE=false
```

`BETTER_AUTH_URL` is the web app's public origin. The web app resolves the visitor while
rendering, where it cannot write cookies, so the session cookie cache stays off. Then:

```sh
bun run dev:fixture             # a small site in ./data/sermo.db
bun run start                   # the API
cd apps/web && bun run dev      # the web app on http://localhost:3000
```

The fixture creates `nova` (administrator), `kestrel` (moderator), `ember` and `wren`, with two
categories, four forums, six threads, a few reactions and one conversation. All four share the
password in `SERMO_DEV_PASSWORD` (default `sermo-dev-password`). It refuses to run with
`NODE_ENV=production` and does nothing when `nova` already exists.
`bun run starter:load --admin nova` adds the starter content on top.

The web app's own setup is in [apps/web/README.md](apps/web/README.md). Every interface string
lives in both `apps/web/messages/en` and `apps/web/messages/es`; a test keeps them in step.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | Business rules, every permission check, the schema and its migrations, the Zod contracts of every operation. |
| `packages/api` | The HTTP server (Hono): REST under `/api/v1`, Better Auth under `/api/auth`, `/mcp`, `/health`, feeds and sitemaps. |
| `packages/mcp` | The MCP adapter: one tool per operation. |
| `apps/web` | The web app: the forum, the account pages and the staff panel. |
| `scripts` | The development fixture, the starter content loader, storage and maintenance commands, the staging site. |
| `bench` | The benchmark: seed generator, harness and scenarios. |
| `load` | k6 load tests against the staging site ([load/README.md](load/README.md)). |
| `deploy`, `.github/workflows` | The production deployment: every push to `main` is checked, built and deployed. |
| `docs` | Guides for deployment, administration and API clients. |
| `DECISIONS.md` | Every design decision and its reason. |

REST routes, the OpenAPI document and the MCP tools all come from one operation registry in core.
The single server process also runs migrations, the job worker, the scheduler and the WAL
checkpointer; there is no separate worker to deploy.

## Testing and benchmark

| Command | What it runs |
| --- | --- |
| `bun run check:fast` | Typecheck, lint (Biome), the backend tests, then the web app's typecheck, tests, production build and JavaScript budgets. CI runs this on every push to `main`. |
| `bun run check` | All of the above plus the full benchmark. |
| `bun test <path>` | The tests of one file or folder. |
| `bun run bench --only "threads.get"` | The benchmark scenarios whose name starts with the prefix. Add `--reuse` to keep the scratch database between runs. |
| `bun run e2e` (in `apps/web`) | The Playwright suite. |

Tests use `bun:test` and sit next to the code. Backend tests run against a real in-memory SQLite
database with every migration applied.

The benchmark seeds a deterministic database (10,000 members, 1 million posts, 2 million reactions)
in `SERMO_BENCH_DIR` (default `~/.cache/sermo-bench`), outside the repository. The seed is about
3.4 GB and each checkout keeps a working copy beside it, so check free disk space before the first
run; the seed is made again when the migrations or the seed version change. Every scenario goes
through the HTTP app and its middleware. Reads must have p95 at or below 20 ms, writes p95 at or
below 50 ms, and no request may exceed 200 ms; password hashing is exempt. Run it on an idle
machine: other work on the same machine shows up as single slow requests.

## Documentation

| Document | For |
| --- | --- |
| [docs/deployment.md](docs/deployment.md) | Running a site: containers, configuration, first run, upgrades, backups, storage, TLS. |
| [docs/administration.md](docs/administration.md) | Forum operators: groups, permissions, promotions, the economy, moderation, notifications, email, Web Push. |
| [docs/api.md](docs/api.md) | API and MCP clients: registration, sign-in, API keys, MCP configuration. |
| [apps/web/README.md](apps/web/README.md) | Working on the web app. |
| [scripts/starter/README.md](scripts/starter/README.md) | The starter content loader. |
| [load/README.md](load/README.md) | Load testing with k6. |
| [DECISIONS.md](DECISIONS.md) | Why things are the way they are. |

The version of the whole repository is in [VERSION](VERSION).

## License

[MIT](LICENSE).
