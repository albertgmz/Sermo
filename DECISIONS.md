# Decisions

Each entry: the decision, then why. Newest milestone last.

## Milestone 0–1: scaffold, schema, contracts

**Exact pinned versions:** Bun 1.4.2, TypeScript 7.0.2, drizzle-orm 0.45.3, drizzle-kit 0.31.11,
hono 4.13.13, zod 4.6.5, @modelcontextprotocol/sdk 1.32.0, @biomejs/biome 2.5.15, marked 18.0.14,
sanitize-html 2.18.0. Installed with `--exact` so builds are reproducible.
TypeScript 7 (the native compiler) typechecks the whole workspace without issues, so we take
the faster compiler.

**FTS5 is available.** Bun 1.4.2 bundles SQLite 3.53.2 compiled with `ENABLE_FTS5`, verified
with a virtual table, `MATCH`, `bm25()` and `snippet()`.

**Biome** for lint and format (one fast tool, no plugin tree). `noNonNullAssertion` is off,
because `noUncheckedIndexedAccess` is on and non-null assertions are the idiomatic answer for
fixed-shape query results. All other warnings fail the lint.

**Operation registry.** Every operation is a *contract* (name, read/write kind, Zod input and
output) in `packages/core/src/contracts`, plus an implementation in its module. REST routes,
the OpenAPI document, MCP tools and benchmarks are all derived from this one list, so the REST
and MCP surfaces cannot drift apart. `execute()` is the single entry point that validates input
(and, in tests, output).

**Services are synchronous where possible.** `bun:sqlite` is synchronous and so are
transactions; async is used only for password hashing. Adapters `await` whatever a service
returns.

**Timestamps:** integer milliseconds in the database; ISO 8601 UTC strings in every contract.
Milliseconds avoid unit confusion in JavaScript; ISO strings are the conventional, readable
wire format.

**Ids:** integer ids exposed as JSON numbers. All tables use `INTEGER PRIMARY KEY`, including
join tables (`conversation_participants`, `thread_reads`, `node_permissions`), which get a
separate unique index on their natural key.

**No foreign keys on denormalized pointer columns** (`last_post_id`, `first_post_id`, ...).
These form cycles (nodes → posts → threads → nodes); services keep them consistent in the same
transaction.

**Post bodies are Markdown** (CommonMark + GFM). It is what both people and MCP clients write
naturally, and a future editor can emit it. Rendered once at write time with `marked`, with raw
HTML escaped, then passed through a `sanitize-html` allowlist. Links get
`rel="nofollow ugc noopener"`. Profile "about" text is plain text (clients escape it).

**Post positions are stable.** A post's position is its 0-based place in the thread in creation
order and never changes; page n is `WHERE thread_id = ? AND position BETWEEN (n-1)*L AND n*L-1`.
Posts a viewer may not see (deleted, or unapproved and not theirs) leave gaps, so a member's page
can hold fewer than L posts. The first version renumbered later posts whenever a post was hidden
or restored, so that every page held exactly L visible posts. A thread's posts are scattered
across the table (posts are stored in time order across all threads), so renumbering a
10,500-reply thread rewrote about 2,000 pages and 8 MB of WAL per moderator action, and those
requests reached 350–600 ms. With stable positions hiding or restoring a post is a one-row
write. The owner chose this trade-off. Post bodies stay in `post_bodies` so listing and counter
queries touch narrow rows.

**Unread state uses post and message ids, not positions or timestamps.** Positions are jump targets and
timestamps can tie; ids only grow. Threads whose last post is
older than 30 days count as read, so a new account does not see the whole forum as unread and
old `thread_reads` rows can be purged.

**HTML sanitizing is sanitize-html only.** Every content type renders through one function,
`renderMarkdown`: raw HTML in the source is escaped by sanitize-html (all tags disallowed,
recursive escape) and the rendered Markdown passes through sanitize-html with an explicit
allowlist of tags, attributes and URL schemes. An earlier hand-written escaper was removed. The
only regex left in that path rejects quotes nested more than 10 levels deep before parsing, a
guard against the Markdown parser's stack overflow rather than a sanitizer. A test suite feeds
known XSS payloads through every content type and checks the stored HTML with a parser.

**Post bodies are limited to 10,000 characters** (XenForo's default). Markdown rendering cost
grows faster than linearly on adversarial input: the worst inputs measured took ~45 ms at
10,000 characters and ~120 ms at 20,000. Quotes nested more than 10 levels deep are rejected
because they overflow the parser's stack.

**Migrations run only when asked** (`migrate: true`; the API server does it at startup). A
second process sharing the database file, such as the future frontend, must not migrate:
Drizzle's migrator is not safe against two processes migrating at once.

**Caches are never filled inside a transaction**, so a value built from uncommitted (possibly
rolled-back) data can never be cached under a version number.

**Thread listings put sticky threads in a separate `sticky` array** on the first page, and
keyset-paginate the rest on `(last_post_at, id)`. One index, `(node_id, is_sticky,
last_post_at, id)`, serves both.

**Node counters are per node, not rolled up.** Rolled-up totals can be computed from the 60-row
node list in memory; storing them would multiply the writes for every post.

**Cache invalidation works across processes.** The node tree and resolved permissions are cached
in memory, keyed by a version row in `cache_versions`. Each read costs one indexed lookup to
compare versions; every write that changes nodes or permissions bumps the version in its
transaction. A future frontend process that imports `@sermo/core` directly therefore never
serves stale permissions.

**Reading never writes.** Marking a thread or conversation read is an explicit write operation
(`threads.markRead`, `conversations.markRead`), not a side effect of fetching it. Thread views
are counted in memory and flushed by a scheduled job.

**Authentication is Better Auth (1.7.7), replacing the first custom implementation.** The owner
asked for maintained libraries in security-sensitive code, with social login, 2FA and passkeys
available later without a rewrite. Better Auth owns identity and credentials in its own tables
(`auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_apikey`) on the same
SQLite database through its Drizzle adapter; Sermo's `users` table keeps forum data only
(display username, group, about, counters), keyed by the `auth_user` id, so auth upgrades never
touch forum data. Email and password plus the username plugin (sign-in by username) and the API
key plugin (for MCP and external clients) are enabled; social login, 2FA, passkeys, email
verification and password reset are not, but need only configuration and new tables.

**Better Auth uses serial integer ids** (`advanced.database.generateId: "serial"`), so every
existing integer foreign key to a user stays valid. Its API returns ids as strings; the auth
module converts them at the boundary. The API key owner column (`reference_id`) must stay TEXT
(the plugin compares it with string ids), so a trigger deletes a user's keys when the user is
deleted.

**Pre-Better-Auth databases are not migrated.** No deployment existed when the switch was made,
so migrations 0002–0004 assume an empty database (they recreate `users` and drop the old
credential tables). Running them on a database that already has users fails.

**Sessions: 30 days, no sliding refresh, 5-minute cookie cache.** Refreshing a session on read
would write during a read. The cookie cache serves an authenticated request without a session
query; its cost is that a revoked session keeps working until its cache cookie expires
(at most 5 minutes). The auth module returns the refreshed cache cookie to the HTTP adapter.

**API keys are verified read-only.** Better Auth's API key plugin writes two UPDATEs on every
request it verifies, and that cannot be turned off with database storage; that conflicts with
"a read never writes". The plugin still creates, lists and deletes keys; `resolveActor` verifies
them itself with the plugin's own exported hasher (SHA-256), checking `enabled` and expiry. We
give up the plugin's per-key usage counters and rate limits.

**The actor's group costs one primary-key lookup per authenticated request.** The cookie cache
removes the session query, but the group lives in Sermo's `users` table (forum data stays out of
Better Auth's tables) and must reflect group changes immediately, including from another
process.

**Passwords: argon2id at Bun's default cost** (64 MiB, 2 iterations), through Better Auth's
custom hash/verify options. The first implementation lowered this to 19 MiB to fit the 50 ms
write budget; that was wrong. Password hashing is exempt from the latency budgets: the benchmark
reports sign-in and sign-up (about 60–70 ms) without failing them. Tests use the cheapest
settings.

**Sign-up is not atomic.** Better Auth's adapter cannot run its async transactions on the
synchronous SQLite driver, so the user, credential account and Sermo `users` row are written in
separate statements. If the `users` row is missing, `resolveActor` creates it on first use.

**Rate limiting of auth endpoints is Better Auth's built-in limiter** (in memory, strict rules
for sign-in and sign-up), keyed by the client IP from one header that only the HTTP adapter sets.
If that header were missing, every request would share one bucket, so the adapter sets it on
every request (from the socket, or from the trusted proxy header when configured) and drops any
value the client sent.

**The admin bootstrap runs once at startup in the single server process.** `ensureAdmin`
creates or promotes the configured admin only if no admin exists, and reuses an existing
account only when both its email and password match. It is not designed for concurrent callers.

**Search: one contentless FTS5 table maintained by triggers.** Post bodies are indexed per post,
and each thread title is indexed on its first post's row, so one index covers "titles and
bodies" and title-only search is a column filter. Triggers keep the index exact without
application code.

**Search matches whole words, newest first.** Ranking by relevance (`bm25`) or matching
prefixes forces FTS5 to process every match before returning anything. On the seeded data a
prefix query for a common word took ~55 ms; an exact-word query ordered by rowid streams and
took 0.05–0.2 ms. Results are filtered for visibility after matching, and the number of
candidates examined per request is capped, so a page may be short while `nextCursor` is
non-null.

**API keys cannot create or revoke keys.** Better Auth's key management endpoints require a
session, so a leaked key cannot mint more credentials.

**Guests can never post or react**, regardless of permission overrides, since content needs an
author.

**One group per user.** Guest, Member, Moderator and Administrator are fixed groups whose
permissions admins can edit. Secondary groups and custom groups can be added later without
changing how permissions are resolved.

**No reacting to your own content.** It inflates reaction scores and is the common forum rule.

**Each reaction stores the score it was given with.** Changing a reaction type's score then
affects only new reactions, and removing an old reaction subtracts exactly what it added, so
scores never drift. Hiding content keeps the reaction score it earned.

**`restore` doubles as approve.** v1 has no automatic approval queue; the `moderated` state
exists in the data model, and moderators make such content visible with the `restore`
operations.

**AGENTS.md is not committed.** It holds working instructions for the build process, not
product documentation.

## Benchmarks

**The seed dataset lives outside the repository** (`SERMO_BENCH_DIR`, default
`~/.cache/sermo-bench`). It is 2.6 GB and would otherwise sync to cloud storage with the
working tree. Its file name includes a hash of the migrations, so any schema change regenerates
it. Generation is deterministic and takes about 40 s.

**Seed shape:** 6 categories with 9 forums each (3 of them subforums); thread sizes and reaction
counts follow heavy-tailed distributions (the largest threads have ~10,500 replies); content is
inserted in time order so ids grow with time, like a live forum. In addition to the required
counts it creates 200,000 thread-read rows, so unread markers are measured realistically.

**What the benchmark measures:** each scenario's wall time around one HTTP request, server-side,
through the full app with every middleware enabled: secure headers, client IP, actor resolution
(Better Auth API key, or the session cookie with its cache in the session scenarios), rate
limiting (enforced, with limits set out of reach so the benchmark measures cost rather than
429s), CSRF, routing, input coercion and validation, the operation, and JSON serialization.
Requests go through `app.request`, so the network itself is not included.
Each scenario warms up before measuring. Before any scenario runs, the runner reads the freshly
copied database file once, so it sits in the OS page cache like the data of a server that has
been running for a while. Without that step the first requests measured disk reads of a file
copied seconds earlier (p99 up to 230 ms on the same queries that take 0.2 ms warm). Cold-start
latency after a restart is real, but it is not what the per-request budgets describe. Raw-SQL probes of the hot queries run alongside the
operation scenarios, to separate database time from service overhead.

**WAL checkpoints run on a worker thread, not inside requests.** With SQLite's default
auto-checkpoint, the commit that grows the WAL past 1,000 pages also copies them into the
database file and fsyncs it: on the 2.6 GB benchmark database that single write took
0.6–1.7 s (p99 of the same writes: 3 ms). The server turns auto-checkpointing off and runs a
PASSIVE checkpoint every second on a separate thread and connection (`startCheckpointer`),
which never blocks readers or writers. Processes that do not start it keep SQLite's default.
The benchmark runs with the checkpointer, as production does.

## Milestone 7: jobs, scheduler, search

**Scheduling uses croner (10.0.1); the job queue stays custom.** Periodic tasks (view flush every
5 s; hourly credential and stale read-marker purges; daily counter rebuild and `PRAGMA optimize`)
are croner jobs with overlap protection and error capture. Durable work goes through the `jobs`
table, which supports several processes on one database: jobs are claimed with a lease inside an
immediate transaction, handlers run outside it, failures back off (30 s, 2 min, 10 min, 1 h)
and fail after 5 attempts, including jobs whose lease keeps expiring.

**The counter rebuild is a chain of short jobs.** Each stage (threads, nodes, users, profile
posts, conversations, and the reaction counts of every content type) walks its table by id in
chunks sized so a chunk holds the write lock for a few milliseconds, writes only rows that differ,
and enqueues the next chunk. Two covering indexes exist for it (`posts_user`,
`reactions_recipient`). The worst chunk on the benchmark data is one conversation with 13,000
messages: about 28 ms with a cold cache. It runs once a day in the background and a request
waiting behind it still meets its budget, so it was accepted; recomputing outside the write
transaction would risk overwriting concurrent updates.

**Search tokenizes like FTS5's `unicode61`.** Words are runs of letters and digits; combining
marks are dropped by both the query parser and the index tokenizer, so in scripts that use them
(for example Devanagari) a query can match part of a longer word. Excerpts are plain text cut on
code points.

## Milestones 8–9: HTTP surface and deployment

**One Hono app serves everything:** Better Auth at `/api/auth/*`, the REST API at `/api/v1`,
MCP at `/mcp`, `/health`, and the OpenAPI document at `/api/v1/openapi.json`. The REST route
table is data; the router, the OpenAPI generator and the benchmark all read it, and a test fails
if any operation lacks a route.

**The OpenAPI document is generated** from the route table and the Zod contracts (OpenAPI 3.1,
shared schemas as components) and merged with Better Auth's own document, so it covers every
endpoint including sign-up, sign-in and API keys. It is built once per process.

**Security middleware uses maintained libraries.** Hono's `secureHeaders` on every response (CSP
`default-src 'none'; frame-ancestors 'none'`, and `Referrer-Policy:
strict-origin-when-cross-origin` because `no-referrer` can make browsers send `Origin: null`,
which Better Auth's origin check rejects). Hono's `csrf` on cookie-authenticated state-changing
REST requests. Hono's CSRF middleware only inspects form-like content types, so cookie-
authenticated writes must also be `application/json` (415 otherwise): a cross-site JSON request
then needs a CORS preflight, which `/api/v1` never grants. API-key requests carry no cookie and
are exempt. Better Auth protects its own routes with its origin check.

**Rate limiting uses hono-rate-limiter (0.5.4), in memory.** Per 60-second window: 300 reads
(GET and HEAD), 60 writes, 30 searches, 60 MCP requests, keyed by API key, signed-in user, or
client IP for guests; a 429 carries the error envelope and `Retry-After`. Limits are per process,
which suits the single-container deployment. The client IP comes from the socket, or from the
last value of a configured trusted proxy header (correct with exactly one proxy that appends to
it), and is passed on in one header that clients cannot set.

**MCP uses the SDK's low-level `Server`, not `McpServer.registerTool`.** `McpServer` validates
arguments itself and answers with its own error text before our code runs; with the low-level
server every call goes through `execute`, so MCP and REST return the same error envelope. The
tool list (one tool per operation, names with `_` instead of `.`) and its JSON Schemas are built
once. The transport is stateless: a new server and transport per HTTP request (about 0.1 ms).

**Shutdown drains requests first:** stop accepting connections and wait for in-flight requests,
then flush buffered views, stop the scheduler, job worker and checkpointer, and close the
database. `docker stop` completes in about half a second.

**Docker: one container, database on a named volume.** Multi-stage build on
`oven/bun:1.4.2-slim` (FTS5 verified in it), production dependencies only, non-root user, health
check through Bun (the slim image has no curl). Bun links each workspace package's dependencies
in that package's own `node_modules`, so the runtime stage copies those too. Backups use
`VACUUM INTO` through Bun's SQLite binding (no `sqlite3` binary in the image) or a copy after a
graceful stop.

## Milestone 10: second-pass foundation

**File identity is a database id, with driver and key stored separately.** Content can refer to
the id through a stable Sermo URL. A variant is another file row linked to its source by
`parent_file_id` and a unique variant name. This keeps generated sizes immutable and makes a
driver migration a metadata update after the bytes are copied.

**Existing content gets additive defaults.** Attachment counts start at zero; thread excerpts
start empty and can be filled when content is edited or by a later backfill. The migration adds
columns and tables without rebuilding or dropping any existing table.

**Domain events are a durable ordered stream.** A content write appends an event in its own
transaction. Each named subscriber keeps a cursor and retries an event when its handler fails.
Handlers must be idempotent because a process may die after an effect but before the cursor is
saved. This is a small local outbox that can serve IndexNow and file cleanup now and a future
subscriber later.

**Benchmark file records use a fake driver.** The extended seed has metadata and attachment
links without creating 300,000 physical files; transfer and image processing have separate
exempt measurements when those services exist.

**Second-pass libraries are pinned.** `file-type` 22.1.1 detects binary signatures,
`@sindresorhus/slugify` 3.0.1 generates cosmetic slugs, and `schema-dts` 2.1.0 types JSON-LD.
The pinned Bun 1.4.2 exposes `Bun.Image`; the image milestone will validate its behavior before
choosing it for decoding and re-encoding.

**Admin settings use one validated JSON row.** The `settings.get` and `settings.update`
operations expose storage limits, moderation rules, SEO title templates, and the optional
IndexNow key. Defaults apply when the row does not exist, so old databases upgrade without a
settings backfill. Group upload limits mean total bytes retained per user, with zero denying
uploads. The single row is simple to change while the settings set is small; services read it
through the indexed key on each operation so changes from another process take effect at once.

**Huge-thread author counters keep the measured first-pass exception.** The first-pass
`forumSql.authorAdjustment` groups visible posts by author with `count(*)` through the
thread-position index when a whole thread is hidden or restored. The general hot-path rule says
no counts, but this exact synchronous operation was already measured at about 11 ms p95 on a
10,500-reply thread and preserves user counters in the same transaction. Moderation reuses that
query rather than allowing eventually consistent counters.

**Storage uploads use streaming multipart parsing.** `busboy` 1.6.0 parses one file part from
the request stream; core meters bytes into a temporary file before copying them to the selected
local or Bun S3 driver. The temporary file bounds memory while content signatures and UTF-8
text are checked. Upload quotas count live bytes owned by the user and are checked in the file
record's insert transaction. All public responses use the Sermo file path, and attached files
repeat the content permission check on every read so soft deletion takes effect immediately.

**File deletion claims a row before removing bytes.** `deleted_at = -1` means a queued deletion
has claimed the file and prevents a concurrent attachment. A retry can finish an interrupted
storage deletion; successful deletion replaces the marker with the actual time. This sentinel
is confined to storage code and should be reviewed if more deletion states are introduced.

**Image processing uses sharp 0.35.5 behind one core function.** Bun 1.4.2 has `Bun.Image`,
and it can orient and re-encode images, but its documented resize modes do not crop to square.
Avatars and node icons need square crops without stretching faces, so `processImage` uses sharp's
`cover` resize. Every accepted image is decoded and re-encoded before storage. Decoding is
limited to 16 million pixels, and the function rejects animated GIF and WebP rather than
silently flattening them. Static GIF is accepted and converted to PNG. This animation policy is
easy to relax later and needs owner review.

**Public image URLs may use a configured proxy origin.** `SERMO_PUBLIC_FILES_URL` changes URLs
returned for profile and node media at read time; it must proxy the same Sermo file path.
Attachments always retain the stable Sermo path and `private, no-store` response caching,
because a soft delete or permission change must hide them immediately. Neither database rows
nor rendered post bodies contain a driver URL.

**Attachment edits use an optional complete file list.** Omitting `attachmentIds` keeps the
current attachments. Supplying the list replaces their order and membership in the same content
write transaction. Newly added files must be unattached uploads owned by the actor; removing a
file revokes its access immediately and queues permanent storage deletion. This keeps the API
small and can be changed with a later dedicated attachment operation. The owner should review
whether edit removal should instead retain files for an undo window.

**Global bans and private message moderation require an administrator.** Per-node moderators
can act on forum content; global bans and private conversations have no node scope. Restricting
those actions to administrators avoids granting a node moderator access to unrelated private
content. This privilege boundary needs owner review.

**Optional spam checks hold new content for approval.** Registration is rejected when an enabled
checker returns spam; new forum, profile, and conversation content enters the existing moderated
state. The checker receives only the trusted client IP supplied by the HTTP adapter. A checker
error fails the submission, allowing retries without silently bypassing the configured check.
The checker is disabled by default and every adapter test uses a mock response.

**The new-member approval window defaults to seven days.** The setting can change it without a
migration. Link moderation applies only within that window, while the first-post rule counts
forum posts against the configured threshold.

**SEO paths use cosmetic slugs after numeric ids.** A supplied path is compared with the
canonical URL and the metadata includes a redirect flag. The existing server configuration
already allowed `SERMO_SITE_URL` to fall back to `BETTER_AUTH_URL`; that behavior was kept even
though the second-pass request described the site URL as required. The public origin is passed
to core so REST, MCP, feeds, and sitemaps agree.

**A profile is indexable when its public about text or visible wall posts exist.** Forum post
counters can include posts in nodes hidden from guests, so they do not establish public profile
content. This conservative rule can be broadened later with a separate public-content counter.

**IndexNow uses a durable pending table behind the event subscriber.** Each public content
event yields a canonical URL record with the event id as its idempotency key. The jobs queue
sends up to 10,000 distinct URLs at once and retries failed submissions. While no key is set,
events advance without submission. A later key enables future events only. File cleanup also
subscribes to content events, while immediate attachment removal keeps its existing deletion job
for prompt cleanup.

**Storage migration is an offline per-file copy.** The command verifies source and destination
hashes before changing each live file's driver record. It checks the destination for a completed
copy on retry and leaves source bytes in place after success, making rollback possible without
an immediate destructive cleanup. The server must stay stopped until all records are switched;
the owner should decide when to remove the retained source copies.
