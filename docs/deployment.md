# Deploying Sermo

One host runs three containers behind one public origin:

```
browser --> ingress (Caddy, the only published port, 8080)
              |-- /api/*, /mcp, /health, /robots.txt, /llms.txt, /sitemap.xml, /sitemaps/*,
              |   /feed.atom, /forums/*/feed.atom, /nodes/*/feed.atom, /<key>.txt  --> sermo (backend, port 3000)
              `-- everything else                               --> web (Next.js, port 3000)
                                                                     |
                                                       REST over the internal network --> sermo
```

- `sermo`: the backend (Bun, SQLite, REST, Better Auth, MCP). It owns the database and the uploaded
  files on the named volume `sermo_data`, runs migrations at start and runs the background jobs.
- `web`: the Next.js app, built from `Dockerfile.web` with Next's standalone output on Node. It has
  no volume and reaches the backend only over REST (`SERMO_API_URL=http://sermo:3000`).
- `ingress`: Caddy, configured by `Caddyfile`. It is the only service with a published port.

Browsers send `/api/*` to the backend straight through the ingress. Uploads from the pages
(`/account/picture`, `/threads/<forum>/uploads`, `/attachments`, `/admin/uploads`) are Next route
handlers on `web`,
which hand the file to the backend as the visitor.

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
and nothing in the web app can create one (`bun run dev:fixture` is for development only and refuses
`NODE_ENV=production`). To add one later, set the three variables again while the site has no administrator: the backend
creates the account, or promotes an existing one whose email and password match.

A new site is empty: create a category and a forum in the panel, or load the starter content, before
members can post. The starter content is the configuration the first frontend shipped (pictures,
colours, forums, awards, the shop, site identity, credit rules and static pages), with no members or
posts. With the site running and the administrator created, load it inside the backend container,
naming that administrator:

```sh
docker compose exec sermo bun run starter:load --admin <username>
```

It prints one line per item and a total, and exits non-zero if anything failed. Running it again
creates nothing that is already there (see `scripts/starter/README.md`).

## Configuration

Everything is in `.env`, grouped and commented in `.env.example`. Compose fixes the values that
follow from the layout: `PORT`, `SERMO_DB_PATH`, `SERMO_TRUSTED_PROXY_HEADER=x-forwarded-for`,
`SERMO_SESSION_COOKIE_CACHE=false` (the web app resolves the visitor while rendering, where it
cannot store a refreshed cookie), `SERMO_API_URL` and `SERMO_PUBLIC_URL`.

`BETTER_AUTH_URL` is the public origin as the browser sees it. The backend checks the `Origin` of
cookie-carrying requests against it, Better Auth builds links and cookie settings from it, and
`web` uses it as `SERMO_PUBLIC_URL`. If you change `INGRESS_PORT` or put a domain in front, change
`BETTER_AUTH_URL` with it.

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

**Going back.** After the upgrade the database cannot be used by the previous release; see "Rolling
back" in `DECISIONS.md`. Keep the backup you took before upgrading.

## Backup and restore

SQLite runs in WAL mode and the image has no `sqlite3`. A consistent live copy of the database:

```sh
docker compose exec sermo bun -e "new (require('bun:sqlite').Database)('/data/sermo.db').run(\"VACUUM INTO '/data/sermo-backup.db'\")"
docker compose cp sermo:/data/sermo-backup.db ./sermo-backup.db
docker compose exec sermo bun -e "require('node:fs').unlinkSync('/data/sermo-backup.db')"
```

Local uploads live in the same volume: `docker compose cp sermo:/data/files ./files-backup`. With
`SERMO_STORAGE_DRIVER=s3` the files are in the bucket and only the database needs this. To restore,
stop the stack, put the copy back and start it again; remove the old `-wal` and `-shm` files so
SQLite does not apply them to the restored database:

```sh
docker compose down
docker compose run --rm --no-deps -v "$PWD:/backup" sermo sh -c "rm -f /data/sermo.db-wal /data/sermo.db-shm && cp /backup/sermo-backup.db /data/sermo.db"
docker compose up -d
```

(Add `cp -r /backup/files-backup/. /data/files/` to the command to restore local uploads.) The backup
commands are the ones from the README; the restore command has not been run against a live stack.
Keep backups outside the volume and protect them like the live database.

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
proxy on the same machine that holds the certificate). Add the front proxy's addresses to the
`Caddyfile` so the ingress believes the address it reports:

```
{
	servers {
		trusted_proxies static 203.0.113.10 198.51.100.0/24
		# Only if the proxy appends to X-Forwarded-For (most load balancers do):
		# trusted_proxies_strict
	}
}
```

(put it in the existing block at the top, next to `auto_https off`; `private_ranges` stands for the
private address ranges), and make sure the front proxy sets `X-Forwarded-For`. The ingress hands
both the backend and the web app exactly one address, `{client_ip}`.

If you do not set `trusted_proxies`, the ingress sees only the front proxy's address and gives it
to the backend for every visitor. Every visitor then shares one address: the request limits, the
sign-in limits and the address stored with each session apply to the whole site at once, so a few
busy visitors, or one abusive one, can lock everybody out, and the session list shows the same
address for all. Nothing fails visibly, so check it once: sign in from two networks and compare the
addresses in the administration panel's session list.
