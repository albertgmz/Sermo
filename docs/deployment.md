# Deploying Sermo

This guide runs a Sermo site with Docker Compose: the layout, configuration, first run, upgrades,
backups, storage and TLS. Running the forum once it is up (groups, permissions, moderation, email,
Web Push) is in [administration.md](administration.md).

## Contents

- [Layout](#layout)
- [What must never be exposed](#what-must-never-be-exposed)
- [First run](#first-run)
- [Configuration](#configuration)
- [Upload limit](#upload-limit)
- [Storage](#storage)
- [Upgrade](#upgrade)
- [Backup and restore](#backup-and-restore)
- [Logs and stopping](#logs-and-stopping)
- [TLS](#tls)
- [Continuous deployment](#continuous-deployment)

## Layout

One host runs three containers behind one public origin:

```
browser --> ingress (Caddy, the only published port, 8080)
              |-- /api/*, /mcp, /health, /robots.txt, /llms.txt, /sitemap.xml, /sitemaps/*,
              |   /feed.atom, /forums/*/feed.atom, /nodes/*/feed.atom, /<key>.txt  --> sermo (backend, port 3000)
              `-- everything else                               --> web (Next.js, port 3000)
                                                                     |
                                                       REST over the internal network --> sermo
```

| Service | What it is |
| --- | --- |
| `sermo` | The backend (Bun, SQLite, REST, Better Auth, MCP), built from `Dockerfile`. It owns the database and the uploaded files on the named volume `sermo_data`, runs migrations at start and runs the background jobs. |
| `web` | The Next.js app, built from `Dockerfile.web` with Next's standalone output on Node. It has no volume and reaches the backend only over REST (`SERMO_API_URL=http://sermo:3000`). |
| `ingress` | Caddy, configured by `Caddyfile`. It is the only service with a published port. |

Browsers send `/api/*` to the backend straight through the ingress. Uploads from the pages
(`/account/picture`, `/threads/<forum>/uploads`, `/attachments`, `/admin/uploads`) are Next route
handlers on `web`, which hand the file to the backend as the visitor.

The database is `/data/sermo.db` on the volume and local uploads are under `/data/files`.
`docker compose down` keeps the volume; `docker compose down -v` removes it and its data.

## What must never be exposed

Do not add `ports:` to `sermo` or `web`. The backend takes the visitor's address from the last
value of `x-forwarded-for` (`SERMO_TRUSTED_PROXY_HEADER`), for rate limits and session records. That
is only safe because nothing but the ingress and `web` can reach it. If the backend's port is
published, anyone can send any address and dodge the limits or forge the address of a session.
`web` forwards the header it receives, so the ingress must replace whatever the client sent; Caddy's
`reverse_proxy` does that as long as no `trusted_proxies` are configured. Never publish the
database volume, `.env` or the backup files either.

## First run

1. `cp .env.example .env`.
2. Put a random secret in `BETTER_AUTH_SECRET` (the command is in `.env.example`).
3. Set `SERMO_ADMIN_USERNAME`, `SERMO_ADMIN_EMAIL` and `SERMO_ADMIN_PASSWORD` (all three, or none).
   At start the backend creates that account as the administrator, but only while the site has no
   administrator; later starts leave it alone. Remove the password from `.env` afterwards.
4. `docker compose up --build -d`. The first build takes a few minutes. `docker compose ps` shows
   each service `healthy`; the ingress starts last.
5. Open `http://localhost:8080`, sign in at `/login` and open `/admin`. A guest or a member who
   cannot open the panel gets a 404 there.

There is no command-line tool for creating administrators, and the first member to register does
not become one. Without the three `SERMO_ADMIN_*` variables the site starts with no administrator
and nothing in the web app can create one (`bun run dev:fixture` is for development only and
refuses `NODE_ENV=production`). To add one later, set the three variables again while the site has
no administrator: the backend creates the account, or promotes an existing one whose email and
password match.

A new site is empty: create a category and a forum in the panel, or load the starter content, before
members can post. The starter content is configuration (pictures, colours, forums, awards, the
shop, site identity, credit rules and static pages), with no members or posts. With the site running
and the administrator created, load it inside the backend container, naming that administrator:

```sh
docker compose exec sermo bun run starter:load --admin <username>
```

It prints one line per item and a total, and exits non-zero if anything failed. Running it again
creates nothing that is already there (see [scripts/starter/README.md](../scripts/starter/README.md)).

Search uses SQLite's FTS5, which Bun's SQLite includes. To confirm it in a built image:

```sh
docker compose exec sermo bun -e "new (require('bun:sqlite').Database)(':memory:').run('create virtual table t using fts5(x)')"
```

## Configuration

Everything is in `.env`, grouped and commented in `.env.example`. Compose fixes the values that
follow from the layout: `PORT`, `SERMO_DB_PATH`, `SERMO_TRUSTED_PROXY_HEADER=x-forwarded-for`,
`SERMO_SESSION_COOKIE_CACHE=false` (the web app resolves the visitor while rendering, where it
cannot store a refreshed cookie), `SERMO_API_URL` and `SERMO_PUBLIC_URL`.

`BETTER_AUTH_URL` is the public origin as the browser sees it. The backend checks the `Origin` of
cookie-carrying requests against it, Better Auth builds links and cookie settings from it, and
`web` uses it as `SERMO_PUBLIC_URL`. If you change `INGRESS_PORT` or put a domain in front, change
`BETTER_AUTH_URL` with it.

### Variables

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Required signing secret: at least 32 random bytes. |
| `BETTER_AUTH_URL` | Required public origin and trusted origin; HTTPS for a public site. |
| `SERMO_SITE_URL` | Public origin for canonical links, sitemaps, feeds and email links; defaults to `BETTER_AUTH_URL`. Must be HTTPS with SMTP unless it is a loopback address. |
| `SERMO_TRUSTED_ORIGINS` | Extra comma-separated origins allowed for cookie requests. |
| `INGRESS_PORT` | Port the ingress publishes on the host (default 8080). |
| `INGRESS_MAX_BODY` | Largest request body the ingress accepts (default `32MiB`); see [Upload limit](#upload-limit). |
| `SERMO_ADMIN_USERNAME`, `SERMO_ADMIN_EMAIL`, `SERMO_ADMIN_PASSWORD` | Optional administrator bootstrap; set all three together. |
| `SERMO_TRUSTED_PROXY_HEADER` | Client IP header; the adapter uses its last comma-separated value. Set it only with exactly one trusted proxy in front that appends to it; empty for direct connections. Compose sets `x-forwarded-for`. |
| `SERMO_SESSION_COOKIE_CACHE` | `true` (default) keeps a signed copy of the session in a cookie for five minutes; `false` checks the session table on every request. Compose sets `false`. |
| `PORT` | Listening port of the backend (default 3000; Compose fixes it). |
| `SERMO_DB_PATH` | SQLite file (default `./data/sermo.db`; Compose sets `/data/sermo.db`). |
| `SERMO_FILES_DIR` | Local upload directory (default `files` beside the database). Keep it under `/data` with Compose. |
| `SERMO_STORAGE_DRIVER` | `local` (default) or `s3`; see [Storage](#storage). |
| `SERMO_S3_BUCKET`, `SERMO_S3_ENDPOINT`, `SERMO_S3_REGION`, `SERMO_S3_ACCESS_KEY_ID`, `SERMO_S3_SECRET_ACCESS_KEY` | Bucket settings. Use the R2 endpoint for Cloudflare R2; the endpoint is optional for Amazon S3. |
| `SERMO_PUBLIC_FILES_URL` | Optional proxy or CDN origin for public profile and node images; it must forward `/api/v1/files/*` to the backend. |
| `SERMO_MAIL_DRIVER` | `none` (default), `capture` (kept in memory, for development) or `smtp`. |
| `SERMO_MAIL_FROM`, `SERMO_MAIL_REPLY_TO` | Sender address (required for SMTP) and optional reply-to. |
| `SERMO_SMTP_HOST`, `SERMO_SMTP_PORT`, `SERMO_SMTP_SECURE` | SMTP host, port (default 587) and TLS on connect (default `false`). |
| `SERMO_SMTP_REQUIRE_TLS` | By default STARTTLS is required unless `SERMO_SMTP_SECURE=true` or the host is loopback. `false` only for a plain-text relay on a private network; `true` forces it. |
| `SERMO_SMTP_USER`, `SERMO_SMTP_PASSWORD` | Optional SMTP credentials. |
| `SERMO_VAPID_PUBLIC_KEY`, `SERMO_VAPID_PRIVATE_KEY`, `SERMO_VAPID_SUBJECT` | Web Push; all three or none ([administration.md, "Web Push"](administration.md#web-push)). |
| `SERMO_RATE_LIMIT_READ`, `SERMO_RATE_LIMIT_WRITE`, `SERMO_RATE_LIMIT_SEARCH`, `SERMO_RATE_LIMIT_MCP` | Requests per minute per visitor (defaults 300, 60, 30, 60). |
| `SERMO_IP_LOG_RETENTION_DAYS` | Days the address log is kept (default 180). |
| `SERMO_GEOIP_DATABASE` | Optional path of a MaxMind `.mmdb` file. |
| `SERMO_TRUST_LOCATION_HEADERS` | `true` only behind Cloudflare; see below. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional sign-in with Google and Google One Tap; see [Sign-in providers](#sign-in-providers). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional sign-in with GitHub. |
| `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | Optional sign-in with X (Twitter). |

Email is described in [administration.md, "Email"](administration.md#email).

### Sign-in location and log retention

The backend keeps a log of the address, device and approximate place behind sign-ins, registrations
and posts (staff see it with the View IPs permission; a member sees only their own sign-ins on
`/account/security`). A daily job deletes rows older than `SERMO_IP_LOG_RETENTION_DAYS` (default
180), a few hundred at a time. The privacy and cookie pages state the age you set.

The place comes from one of two sources, in this order:

1. Cloudflare, when it is in front: turn on **Add visitor location headers** (Rules > Managed
   Transforms) and set `SERMO_TRUST_LOCATION_HEADERS=true`. The backend then reads `CF-IPCountry`,
   `CF-Region` and `CF-IPCity`. It does so only together with `SERMO_TRUSTED_PROXY_HEADER`, and
   the ingress must be reachable only from Cloudflare: otherwise anyone can send those headers, as
   anyone could send a forged `X-Forwarded-For` (see [TLS](#tls), case b, for the ingress setup).
   The shipped `Caddyfile` deletes the three headers from every request, so with Cloudflare in
   front also remove the three `header_up -CF-…` lines under each upstream there. Cloudflare
   overwrites the visitor-sent copies only while the transform is on, so never set the variable
   without it. Leave the setting `false` everywhere else; the headers are then ignored.
2. A MaxMind database: put a GeoLite2 City (or Country) `.mmdb` file on the data volume and set
   `SERMO_GEOIP_DATABASE` to its path (for example `/data/GeoLite2-City.mmdb`). It is read once at
   start, so restart after replacing it. With no file configured nothing is looked up.

Without either source the log has no place and the alert for a new country never fires.
The cookie banner's "outside Europe" setting (Settings > Cookies and privacy) needs the country of
every request, which only the first source gives; the MaxMind database is read at sign-in and is
not used for it. Without Cloudflare's headers every visitor is asked.

### Sign-in providers

Members can sign in with Google, GitHub and X (Twitter). Each provider is off until you set its
client id and its client secret in `.env`. A provider with only one of the two values stays off.
With no provider set, the login and register pages show only the password form. Restart the
backend after you change these values.

Make an OAuth client at each provider. Give it the redirect URI below. `<origin>` is the value of
`BETTER_AUTH_URL`, for example `https://fcuba.net`.

| Provider | Where to make the client | Redirect URI |
| --- | --- | --- |
| Google | Google Cloud console, APIs and Services > Credentials, "OAuth client ID", type "Web application" | `<origin>/api/auth/callback/google` |
| GitHub | GitHub, Settings > Developer settings > OAuth Apps | `<origin>/api/auth/callback/github` |
| X | X developer portal, the app's "User authentication settings", OAuth 2.0, type "Web App" | `<origin>/api/auth/callback/twitter` |

- Google: add `<origin>` to the "Authorized JavaScript origins" too. Google One Tap needs it. One
  Tap uses the same client id and is on when Google is on.
- X: turn on "Request email from users". If an X account does not share an email address, the
  sign-in is refused (error code `email_not_found`). GitHub without a public or primary address
  is refused the same way.

A provider address that is the same as the address of an account links the provider to that
account. The account keeps its password. The link occurs only when the provider verified the
address and the account's own address is confirmed. Otherwise the sign-in is refused (error code
`account_not_linked`), and the member signs in with the password. An address that the provider
did not verify makes no new account (error code `email_not_verified`). A new account from a
provider gets a temporary username and stays in the Unconfirmed group until the member chooses a
username. While registration is closed, a provider makes no new account.

## Upload limit

A member's upload limit is a site setting (default 25 MiB, at most 1 GiB). A request has to pass:

1. the setting in the administration panel (`maxUploadBytes`): the limit members meet, enforced by
   the backend with a normal error message;
2. `INGRESS_MAX_BODY` in `.env` (default `32MiB`), enforced by the ingress with a bare 413. Set it to
   the new limit plus about 1 MiB;
3. the backend's own transport ceiling of 1 GiB plus 1 MiB, which is fixed in the code.

Raise 1 and 2 together, then `docker compose up -d`. The ingress streams request bodies and does
not write them to disk. The `web` upload routes for attachments hold the file in memory while they
forward it, so size `web`'s memory for the limit you choose.

## Storage

Uploads live on the data volume by default. To keep them in Amazon S3 or Cloudflare R2 on a new
installation, set `SERMO_STORAGE_DRIVER=s3` and the `SERMO_S3_*` values in `.env`; no image change
is needed.

### Moving stored files

An existing site moves its files with `storage:migrate`. The command streams and hashes each live
file, verifies the destination bytes, then switches that file's database record. It keeps the
source bytes for rollback. If interrupted, rerun the same command: records already switched are
skipped and a completed destination copy is reused. Back up the database and local files first.

Stop the API before the move. For a Compose installation moving from local files to a bucket, set
the `SERMO_S3_*` values in `.env`, then run:

```sh
docker compose stop sermo
docker compose run --rm sermo bun run storage:migrate --from local --to s3
```

When it reports completion, set `SERMO_STORAGE_DRIVER=s3` in `.env` and run `docker compose up -d`.
Keep the API stopped until the command completes. Use `--from s3 --to local` to reverse the move.
Outside Docker, run `bun run storage:migrate --from local --to s3` with the same environment
variables. The command refuses unfinished file deletions; let the job worker finish those before
stopping the API.

## Upgrade

```sh
git pull
docker compose up --build -d
```

Migrations run when the backend starts, before it listens, so the health check stays red until they
are done. Take a backup first. Compose recreates only the services whose image changed.

**Custom staff groups.** The migration that added the "listed as staff" flag set it only on the
built-in Moderator and Administrator groups. If you created other groups for your staff before
upgrading, open each in the administration panel and tick "listed as staff" once; until then they do
not appear in the staff list.

**Smaller copies of older pictures.** Attachment pictures get WebP copies 640 and 1280 pixels wide
when uploaded, which pages offer to narrower screens. Pictures uploaded before Sermo made them have
none until this runs once, with the server running:

```sh
docker compose exec sermo bun run images:widths
```

It takes about 2.5 minutes per 1,000 pictures; run it at a quiet hour. With the server running its
checkpointer keeps the database log small; with the server stopped the log grows for the whole run.
A picture whose stored bytes are missing or cannot be decoded is reported, passed over and makes the
command exit non-zero; any other failure (storage, disk, memory), or a run in which most pictures
cannot be read, stops it. If interrupted, run it again; pictures already done are skipped.

**Going back.** After an upgrade the database may not be usable by the previous release; see
"Rolling back" in [DECISIONS.md](../DECISIONS.md). Keep the backup you took before upgrading.

## Backup and restore

SQLite runs in WAL mode and the image has no `sqlite3` executable. A consistent live copy of the
database, made with Bun's SQLite binding and `VACUUM INTO`, copied off the volume, then removed
there:

```sh
docker compose exec sermo bun -e "new (require('bun:sqlite').Database)('/data/sermo.db').run(\"VACUUM INTO '/data/sermo-backup.db'\")"
docker compose cp sermo:/data/sermo-backup.db ./sermo-backup.db
docker compose exec sermo bun -e "require('node:fs').unlinkSync('/data/sermo-backup.db')"
```

For an offline copy, stop the service and copy the main database file from the stopped container.
A graceful stop folds the WAL into the main file; after a crash, also copy `sermo.db-wal` before
starting again.

```sh
docker compose stop
docker compose cp sermo:/data/sermo.db ./sermo.db
docker compose start
```

Local uploads live in the same volume: `docker compose cp sermo:/data/files ./files-backup`. With
`SERMO_STORAGE_DRIVER=s3` the files are in the bucket and only the database needs this.

To restore, stop the stack, put the copy back and start it again; remove the old `-wal` and `-shm`
files so SQLite does not apply them to the restored database:

```sh
docker compose down
docker compose run --rm --no-deps -v "$PWD:/backup" sermo sh -c "rm -f /data/sermo.db-wal /data/sermo.db-shm && cp /backup/sermo-backup.db /data/sermo.db"
docker compose up -d
```

Add `cp -r /backup/files-backup/. /data/files/` to the command to restore local uploads. Keep
backups outside the volume and protect them like the live database.

## Logs and stopping

`docker compose logs -f [sermo|web|ingress]`. The backend waits up to 30 seconds for a running job
at shutdown, so its stop period is 40 seconds; `docker compose stop` is graceful. All three services
restart on failure (`unless-stopped`).

## TLS

TLS is not set up by default. Pick the case that matches your setup.

**(a) TLS ends at this ingress (the simple case).** Replace `:8080` in the `Caddyfile` by the domain
name, remove `auto_https off`, publish ports 80 and 443, give Caddy a volume for `/data`, and set
`BETTER_AUTH_URL=https://your.domain`. Visitors connect to the ingress directly, so their address is
the address of the connection and nothing else needs configuring. Whatever header a visitor sends
is ignored.

**(b) Another proxy or load balancer is in front of the ingress** (a cloud load balancer, a CDN, a
tunnel, a proxy on the same machine that holds the certificate). Add the front proxy's addresses to
the `Caddyfile` so the ingress believes the address it reports:

```
{
	servers {
		trusted_proxies static 203.0.113.10 198.51.100.0/24
		# Only if the proxy appends to X-Forwarded-For (most load balancers do):
		# trusted_proxies_strict
	}
}
```

Put it in the existing block at the top, next to `auto_https off` (`private_ranges` stands for the
private address ranges), and make sure the front proxy sets `X-Forwarded-For`, or name the header
it sets with `client_ip_headers`. The ingress hands both the backend and the web app exactly one
address, `{client_ip}`.

If you do not set `trusted_proxies`, the ingress sees only the front proxy's address and gives it
to the backend for every visitor. Every visitor then shares one address: the request limits, the
sign-in limits and the address stored with each session apply to the whole site at once, so a few
busy visitors, or one abusive one, can lock everybody out, and the session list shows the same
address for all. Nothing fails visibly, so check it once: sign in from two networks and compare the
addresses in the administration panel's session list.

## Continuous deployment

The repository deploys its own production site, [fcuba.net](https://fcuba.net), with
`.github/workflows/deploy.yml` on every push to `main`:

1. `bun run check:fast` on GitHub's runners; a failure deploys nothing.
2. Both images built and pushed to `ghcr.io`, tagged with the commit.
3. `deploy/deploy.sh` started on the server over SSH. It runs `compose.yaml` with
   `deploy/compose.vps.yaml` on top: images from the registry, no published port, and a Cloudflare
   tunnel as a fourth service that is the only way in. The Caddyfile is the shipped one with a
   `servers` block that trusts only the tunnel's fixed address and reads `Cf-Connecting-IP`
   (case b above).
4. The script backs up the database with `VACUUM INTO` just before the new images start (the newest
   three are kept), checks `/`, `/robots.txt`, `/sitemap.xml` and `/health` through the ingress, and
   on failure puts back the previous release and that backup.

`deploy/compose.sh` runs `docker compose` for the current release (`./compose.sh ps`,
`./compose.sh logs -f web`). `.env` and the tunnel's credentials are put on the server by hand and
never pass through the workflow; the workflow needs the secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and
`DEPLOY_KNOWN_HOSTS`. The image names and the server paths (`/opt/sermo`) are written into the
workflow and the scripts. The reasons are in "Test server" in [DECISIONS.md](../DECISIONS.md).
