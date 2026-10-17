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

## Milestone 17: third-pass schema, seed and benchmarks

**One additive migration holds the schema for the whole pass** (`0010_third_pass_schema`): groups
gain rank, user title, badge and a built-in key; users gain the permission combination id,
activity, follow and notification counters, language, auto-watch preferences, profile privacy,
restriction expiries and the email cap window; new tables cover permission definitions, entries,
combinations and layer versions, secondary groups, promotions, mentions, quotes, watches, follows,
ignores, notifications and their preferences, announcements, email failures, undeliverable
addresses, push subscriptions, thread bans and restrictions. No existing table is rebuilt.

**A built-in Unconfirmed group (id 5) exists from this migration on.** The migration test that
listed the four default groups now lists five; that assertion was extended, not relaxed.

**Permission entries use 0 instead of NULL for "no node / no group / no member".** SQLite treats
NULLs as distinct in unique indexes, so a sentinel keeps one entry per (group or member, node,
permission). Flags store 1 allow, 0 no, -1 never; a missing row is unset/inherit. Integers store
the value with -1 for unlimited.

**A merged thread keeps its row as a tombstone** (`merged_into_id`, state `deleted`). Deleting the
row would let SQLite reuse its id (no AUTOINCREMENT), which would break the redirect.

**Restrictions are denormalized onto the member row** (`restricted_*_until`, with a year-9999
sentinel for no expiry) so actor resolution reads them in the same lookup as the ban state;
`user_restrictions` keeps the history.

**The seed grows to 60,000 members.** A node with 50,000 watchers needs at least that many. The
50,000 extra members are low-activity accounts generated after all earlier content, so the
original content is unchanged by the random sequence. The extended seed adds 35 custom groups,
3,019 distinct member group combinations, 50 promotions, 2,000,000 notifications (85% read, at
most one unread row per group key), 440,000 thread watches (20,006 on one thread), 60,000 node
watches (50,033 on one forum), 100,000 follows and 50,000 ignores, with every denormalized counter
computed as the services maintain it. Seeding takes about 72 s and 3.2 GB.

## Milestone 18: permission core

**Permissions are data, resolved like XenForo's.** `src/permissions/registry.ts` declares every
permission once: scope (global or node), type (yes/no or integer), defaults for the built-in
groups, and its conditions (needs an account, restriction kind, own content, time window, rank
hierarchy, thread ban). Entries (`permission_entries`) target one group or one member, globally
or on a node. Per group, the nearest node entry wins (node, then ancestors, then global); across
groups any `never` denies, otherwise any `allow` grants; `no` only clears an inherited allow for
that group. Integers take the highest value, -1 meaning unlimited. Nothing in a node is
permitted without view there, and a node needs its ancestors' view. Bans and restrictions are
checked first and override every grant. Rank never affects resolution.

**One check API.** `can`, `requirePermission`, `permissionValue`, `permissionsOf` (resolve once
for a page of checks), `resolvedPermissions` and `explainPermission`. A check whose context lacks
a field its permission declares (node, owner, creation time, target, thread ban) throws, so a
condition cannot be skipped silently.

**Combinations, as in XenForo.** A combination is a sorted set of group ids plus, for members with
member-specific entries, their user id (a private combination). `users.permission_combination_id`
is maintained by SQLite triggers on users, secondary groups, promotion grants and member entries,
so every writer (services, another process, raw SQL) keeps it correct.

**Checks run no query.** Actor resolution reads the principal (combination, ban and restriction
state, account age, post count, cache versions) with the member row; checks are in-memory bit
lookups. Resolution keeps the existing `SELECT group_id FROM users` lookup and replaces the ban
lookup with the principal lookup, so a signed-in request still costs two primary-key lookups.
Guests and internal actors without a principal read the two cache versions in one lookup per
resolve, fewer than the two version lookups per call before.

**Rebuilds touch only what changed and never block a request on all combinations.** Entries load
per layer (one group's or one member's entries) and each layer resolves node inheritance once.
Every entry change bumps its layer's version (triggers); when the `permissions` cache version
moves, a process reloads only the layers whose version changed and drops the combinations built
from them. Combinations resolve lazily on first use (microseconds) and in background batches of
100 that yield to the event loop. A full rebuild of every layer and all 3,050 seeded
combinations takes about 15 ms; reads while every layer is invalidated every 10 ms stay at p95
0.6 ms. The state is never stored from inside a transaction.

**The data migration is generated from the registry.** `0011_permission_data.sql` stores the
definitions as of this pass, translates the legacy group flags (`is_admin` became every yes/no
permission; `is_moderator`, `can_post` and the others map to the permissions listed with that
flag in the registry), node overrides (`can_view`/`can_post`/`can_moderate` become node entries,
true as allow and false as `no`), and the upload quota setting (a missing group key meant no
quota, now -1). Overrides on administrator groups had no effect and are not translated. Later
registry additions are stored at startup by `syncPermissionRegistry`, which applies their
built-in defaults once and never touches existing entries. A test checks that the migrated
built-in groups hold exactly the registry defaults.

**Legacy columns are write-through shims.** The old `groups` flag columns and `node_permissions`
rows stay, and triggers mirror writes to them into entries. Existing tests write them directly,
and they must keep passing unchanged; nothing reads the old columns. Removing them (and those
test setups) is a later cleanup for the owner to schedule.

**Hierarchy applies to actions aimed at a member** (warn, ban, spam cleanup, thread ban, changing
groups, and restrictions in phase 2): the actor's highest rank must be strictly above the
target's. Routine content moderation inside a node a moderator moderates is not rank-checked;
reading "moderate anyone" as covering every post would stop moderators handling each other's
posts. **Accepted by the owner.**

**Permission ids are flat strings grouped by area** (`forum.reply`, `profilePost.editAny`,
`admin.permissions`). Phrase keys for labels and descriptions are `permission.<id>` and
`permission.<id>.description`.

## Milestone 19: services converted to the permission check

**Every service decides through `src/permissions`, enforced statically.**
`permission-coverage.test.ts` transpiles each module with Bun's transpiler, parses it with acorn
(8.19.0, with acorn-walk 8.3.5, dev dependencies) and follows calls across files: every
operation and every exported function taking an `actor` must reach `can`,
`requirePermission`, `permissionValue`, `permissionsOf`, `viewableNodeIds` or
`resolvedPermissions`, or be marked public (`implement(..., { public: "why" })`,
`markPublic("why", fn)`); every registered permission must be passed as a literal to a check;
modules may not import the legacy helpers or read the legacy flag columns. TypeScript 7 ships no
JavaScript compiler API, hence acorn on transpiled output.

**Default permissions reproduce the old behavior, with these deliberate exceptions:**
- Hierarchy: nobody warns, bans, spam-cleans, thread-bans or changes the groups of a member whose
  highest rank is equal to or above their own. An administrator can no longer warn or ban another
  administrator, and a moderator can no longer warn themselves.
- `search.use` is new; guests and members have it by default. A denied search is Forbidden.
- The Unconfirmed group (new in this pass) has an upload quota of 0.
- Integer permissions with no entry in any of a member's groups resolve to 0. For
  `conversation.maxRecipients` that means no recipients; for `attachment.storageQuota`, no
  uploads; built-in groups always have entries.

**The report and approval queues stay open to every signed-in member and filter per item**, as
before, so a group that moderates only some nodes can list its own queue.

**The upload quota setting is a view over permission entries.** `settings.groupUploadLimitBytes`
(groups 1-4) keeps its public shape; it is read from and written to the
`attachment.storageQuota` entries of those groups in the settings operations only. A missing
entry reads as 0, -1 (no quota) is omitted.

**Replaced API (the one public API change the pass allows):** removed `users.setGroup`
(`PUT /users/{userId}/group`) and `permissions.setNode` (`PUT /nodes/{nodeId}/permissions/{groupId}`);
changed `groups.list`, `groups.update` (`PATCH /groups/{groupId}`) and `permissions.listNode`
(`GET /nodes/{nodeId}/permissions`) to the new shapes; added `groups.get`, `groups.create`,
`groups.delete`, `users.getGroups`, `users.setGroups`, `permissions.definitions`,
`permissions.list`, `permissions.set` and `permissions.explain`. `auth.me`, `nodes.get` and
`threads.get` gained `resolvedPermissions` (additive).

## Milestone 20: promotions, rank, display

**Promotions grant secondary groups through their own table.** `user_group_grants` holds groups
added by promotions, separate from hand-assigned `user_groups`, so a promotion never touches a
group an admin assigned (a group both granted and assigned survives demotion), and the
combination triggers take the union. A member's state per promotion is `auto` (applied by
evaluation), `manual` (promoted by hand, kept whatever the criteria) or `exempt` (demoted or
excluded by hand, never applied).

**Criteria are a registry like permissions**: post count, days registered, reaction score,
verified email, avatar, active within N days, inactive for N days, active warning points below N.
Boolean criteria take 1 (must hold) or 0 (must not hold). Adding a criterion is one entry plus
an evaluator.

**Evaluation runs after relevant events and in a daily sweep, with one decision function.** The
promotions subscriber evaluates the member behind `content.created` (posts, threads, profile
posts, comments), `reaction.added`, `member.warned`, avatar changes and admin group changes; it
ignores its own group-change events. The sweep walks members in chunks of 200 (one short
transaction each, resumable through a chained job with a unique key). Both are idempotent and
log only real changes. Deleting a promotion deactivates it and removes its grants in chunks.

**Rank rules for promotions** mirror groups: nobody creates, edits, applies or deletes a
promotion granting a group ranked at or above their own highest rank, and applying a promotion
by hand also needs `admin.members` over the member.

**Measured:** a cold sweep of 60,000 members against 50 promotions takes about 0.9 s (largest
chunk 18 ms); reads while sweeps run continuously stay at p95 13 ms, max 21 ms.

**Member activity is buffered in memory** (`ctx.activity`, written by actor resolution) and
flushed with thread views every five seconds, so a read never writes. `last_activity_at` feeds
the activity criteria and the weekly digest.

**Display group:** profiles and `auth.me` return the member's highest-ranked group (ties: lowest
id) with its user title and badge. `Profile.groupTitle` still names the primary group.

**Events are delivered to registered subscribers every second.** `dispatchEvents` (scheduled
each second, overlap-protected) feeds each subscriber in batches of 100, yielding between
batches. Subscribers keep the existing durable cursors and must be idempotent. Publishing an
event does not enqueue a job, so job counts asserted by existing tests are unchanged.

## Milestone 21: Markdown extensions

**Directives use a small tokenizer of our own, not `marked-directive`.** Mentions (`@name`),
quote and spoiler containers (`:::quote{post=N}` / `:::spoiler{title="..."}`, closed by `:::`)
and inline `>!spoilers!<` are marked extensions; the published directive plugin could not nest
quotes inside spoilers and the reverse. Rendering stays on write, and
`content_mentions` / `content_quotes` are stored in the same transaction as the content.

**Mention and quote limits come from the author's permissions** (`mention.maxPerItem`; new
members get `newMemberMentionLimit`). An edit keeps the mention ids it already had, so editing an
old post never re-notifies or drops members; only `newlyMentioned` ids reach notifications.
Quoting a post the author cannot see is rejected; quotes already stored in the content stay valid
on edit even if the quoted post became invisible since.

## Milestone 22: watching, following, ignoring

Watches, follows and ignores are rows with recency indexes and denormalized follower/following
counts maintained in the write transaction. Ignoring applies only while the ignored member holds
`member.ignorable`, so staff cannot be ignored; banned members can be. One rule
(`profiles/shared.wallAllows`) decides every ignore check. `watch_on_create` and
`watch_on_reply` default per member.

## Milestone 26: moderation additions

**Hierarchy applies to member-directed actions only** (warn, ban, restrict, spam cleanup, member
admin): nobody acts on a member whose highest group ranks at or above their own, and moderators
cannot warn themselves. Content moderation is not ranked. **Accepted by the owner.**

**Privacy denials look like missing content** (NotFound), so profile privacy cannot be probed.
Authors keep access to their own posts on walls that became private.

**Queues stay open to members with a per-item filter.** Report and approval queues and the
moderator log scan at most four times the requested limit per request, so a page can be short
and still carry a `nextCursor`, as search pages do. The approval queue walks the state indexes
newest first and checks each candidate's node through its thread.

**Thread merge and split are the only operations that renumber post positions.** They run as
chunked background jobs guarded by `thread_transfers` (one primary-key lookup on every reply and
reorganization). The target's first post keeps position 0; the other posts interleave by
`(created_at, id)`. Each chunk completes its own job and queues its successor in the same
transaction, matching the claimed job's id and lease, so a replayed or reclaimed chunk does
nothing. A failed transfer sets `failed_at`; repeating the same merge or split resets the real
failed jobs. Replies and moderation of either thread return a conflict while a transfer is
pending. Split copies the source's active thread bans; watches are not copied.

**Unread state keeps using post ids after a merge**, so moved posts older than the reader's
marker count as read.

**Moderation events carry `{actorId, reason, notify, message}`** plus `previousState`/`state` in
the existing `content.*` payloads; only merge and split publish `moderation.action`. Lifting a
ban or restriction publishes the same event type with `lifted: true`.

## Milestone 27: push groundwork

**Push endpoints are limited to the browser push services** (`fcm.googleapis.com`,
`*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com`) on the default HTTPS
port, without userinfo, checked at subscribe and again at send time. Any other host would let
members make the server POST to internal addresses. Self-hosted push services are not supported;
owner review.

**Delivery is one job per (notification, subscription)**, queued with one `INSERT ... SELECT`
inside the notification batch, so one failing device never causes re-sends to the others.
Requests are built with `web-push` and sent with `fetch` under a 10 s deadline. 404/410 remove
the subscription; 3xx/400/403/413 drop the job (403 usually means our VAPID keys are wrong, and
deleting on it would wipe every subscriber); anything else retries. Members keep at most ten
subscriptions (the oldest is replaced). An endpoint moves to another member only when they present
the same `auth` secret, which only the browser holding the subscription has.

## Milestone 23: notifications

**Fan-out runs in background batches of 40 recipients.** Each domain event queues one unique
`notify:<eventId>` job; recipient keysets advance with the cursor in the same transaction as the
batch's notification writes, and the job yields between batches and re-reads the content (primary
key) in every batch, so content hidden or moved mid-fan-out stops reaching members who can no
longer see it. Replays are idempotent (per-member checks bounded by the event time minus one hour,
so a clock step cannot cause duplicates). `notification.created` is published once per batch.

**Unread counts are exact and mark-all is constant time.** `users.unread_notification_count` is
maintained in every write; unread means `read_at IS NULL` and the row's epoch equals the member's
`notification_epoch`. Mark-all bumps the epoch and zeroes the count in one short transaction; a
chunked job stamps `read_at` on older rows later.

**Reason precedence:** a member gets at most one notice per event, from the first reason that
actually delivers to them (mention, quote, then watches and follows), so turning one reason off
falls through to the next. Ignoring a member suppresses their notices except moderator duty
notices (reports, approvals), which are cleared for every moderator once handled. Approvals count
as new content only if the item was never visible; mentions added by an edit into moderation are
delivered on approval. Thread reads clear notices up to the read post id (post ids, as for unread
state). Ban notices stay email-only (the account email); verification-driven group changes create
no notice.

**Channels:** turning in-app off for a type stops email and push for it too (notice rows feed every
channel). Email and push go out once per unread group. For watched threads and forums the watch's
email flag decides unless the member turned that type's email off; an admin `notificationDefaults`
email value for those types has no effect. Independent channels would need notice
rows for members with in-app off. **Accepted by the owner.**

## Milestone 24: mailer, notification email, digest

Nodemailer (pooled SMTP, STARTTLS required except on loopback unless `SERMO_SMTP_REQUIRE_TLS=false`,
30 s timeouts) or an in-memory capture driver; MJML layouts with a plain-text part; English and
Spanish ICU catalogs (`intl-messageformat`). One-click unsubscribe (RFC 8058) uses an HMAC token
derived from the auth secret with a purpose label, binding the member's current email without
putting it in the link; unsubscribe-all writes explicit per-type email preferences for the
registered non-security types (visible and reversible; later types follow site defaults). Owner
review.

**Refusals are classified by sender policy and mailbox status.** Only RCPT 550/551/553 with an
explicit 5.1.x or 5.2.1 enhanced code marks an address undeliverable. Policy refusals (5.7.x
anywhere, DATA 5xx without a mailbox code) concern every member, so they defer with backoff and
mark nobody. Other 5xx skip that member and are recorded. Asynchronous bounces from relay
providers are not processed.

**`notifications.email_sent_at`** (migration 0015) is claimed conditionally before a send, so a
grouped notice is emailed once and retries never double-send.

**The weekly digest sends in small, time-boxed batches** from one self-continuing job (claims in
groups of five, members re-read when their digest is built, threshold six days to absorb start
jitter), so it never monopolizes the serial job queue; it is exempt from the hourly cap. Graceful
shutdown waits up to 30 s for the running job; a crash can lose at most five members' digests for
that week (at-most-once).

## Milestone 25: account emails

With a mailer configured, sign-ups join Unconfirmed; verifying the email (or a change-email
verification of a never-verified account) moves them to Member and publishes
`member.groups_changed` with source `"verification"`. Existing members are not moved on upgrade.
Without a mailer, sign-ups join Member as before. Verification, welcome, password reset, password
changed, email changed (to both addresses), API key created and ban emails are security emails: no
unsubscribe, exempt from the cap, still suppressed for undeliverable addresses. The ban email
respects the moderator's `notify` flag and prefers their message; its subscriber starts at the
newest event, so upgrading sends no historical ban mail. A password reset revokes sessions; with a
mailer configured the session cookie cache is off so revocation takes effect immediately (about
0.07 ms per request); without one the 5-minute cache stays. Reset requests need a trusted
`redirectTo`. Verification, reset and change-email requests are limited to five per hour per
client IP (not per address; open item).

## WAL checkpoints during background jobs

A PASSIVE checkpoint running beside a stream of commits stalled single commits for 0.3–6 s on this
Windows machine (reproduced with a standalone bun:sqlite script, independent of database size,
mmap, the checkpointer's synchronous setting, interval, and thread versus process; once on Linux
under an extreme write rate). Background jobs now hold checkpoints while they run; the checkpointer
still runs at least every 30 s and keeps checkpointing until the WAL stops growing. Notification
reads during a 20,000-recipient fan-out went from max 81–134 ms to 7–10 ms. Request writes do not
hold checkpoints, so a request write can still meet a checkpoint; owner review.

## Milestone 28: economy foundation (credits, credit rules, awards, shop)

**One additive migration** (`0016_economy`) holds the whole pass: three counters on `users`
(`credits`, `award_xp`, `shop_purchase_count`), the ledger, credit rules and their applications,
awards, grants and per-member totals, shop categories, items, inventory and purchases, and the two
tables of purchased permissions and groups. The product references were the DragonByte Credits and
Shop add-ons; the owner asked for the idea, not a copy, so one currency, no transfers between
members, no real-money purchases, and no item types that act on other members' content.

**The balance is a counter with a ledger behind it, and one function writes both.**
`shared/credits.ts moveCredits` updates `users.credits`, appends the `credit_transactions` row
with the resulting balance and publishes `credits.changed`, inside the caller's transaction. No
other code writes either table, so the balance always equals the sum of the member's ledger; a
daily job recomputes balances from the ledger as a repair. A purchase is a conditional UPDATE
(`requireFunds`), so two concurrent purchases can never both spend the same credits.

**Balances may go below zero, but never through a purchase.** Penalties (a negative rule, a
revoked award's credits, a reversal of hidden content, a manual removal) apply in full; if they
stopped at zero, spending first would dodge them. **Accepted by the owner.**

**The ledger is ready for wagers and a lottery without being built for them.** The row type is
plain text checked in code, the cause is a generic `(source_type, source_id)` reference, and
`moveCredits` takes several members' movements in one transaction, which is what a pot or a bet
needs. Nothing else of those features exists.

**Credit rules pay once per source, through an applications table.** A rule's payment to a member
for one source (a thread, a post, one member's reaction on one item, a follower, a warning, an
award grant, a day) is a row in `credit_rule_applications` with a unique key, so reprocessing an
event never pays twice, and un-reacting and reacting again, or unfollowing and following again,
is not a farm. Each row stores the amount it paid and the last event applied to it: hiding the
content flips it to `reverted` with a ledger row of exactly that amount, restoring flips it back,
and replays of older events are ignored. The same table serves the per-member limit (a count over
a rolling window of hours, reverted rows included, so deleting does not free the limit).

**Hiding a thread takes back what the thread itself paid, not what its replies paid.** Reverting
every reply of a 10,000-reply thread would move credits of thousands of members in one event, for
content they did not remove. Reply rules are bounded by their limits. **Accepted by the owner.**

**Rule ids are never reused** (`AUTOINCREMENT`, the one table that uses it): applications outlive
a deleted rule so their content can still be reverted, and a later rule must not inherit them.

**Two new events feed rules that had no fact to react to:** `member.registered` (published with
the member's row) and `member.active_day` (published when buffered activity is flushed and the
member's last activity was on an earlier UTC day, so reads still never write).

**Awards cover achievements; there is no second concept.** Each grant is a row carrying the XP
and credits it gave, so revoking one grant takes back exactly those, whatever the award says now.
A revoked grant keeps its row (`revoked_at`), which keeps the history and means grant ids are
never reused. `member_award_totals` holds the count per member and award for listings, and
outlives its grants so that an award the criteria granted once is neither re-granted after a
revocation nor taken back when the criteria stop holding (an achievement stays earned).
`users.award_xp` is the member's total; clients derive the level from it.

**Criteria are shared.** `modules/promotions/criteria.ts` moved to `shared/criteria.ts`, and
promotions and awards both use it. Four criteria were added: credits at least / at most, has
bought item X, has bought at least N units (`users.shop_purchase_count`). "Has bought" reads the
purchase log by buyer, so a gift counts for the member who paid.

**A purchased permission is a layer of its own in the member's combination.** Storing it as a
member-specific permission entry would let a purchase overwrite an entry an admin set, and its
expiry delete it. Instead `shop_permission_grants` rows load as a second per-member layer beside
the member entries (`p:<userId>`, sharing the member layer's version row), so the usual rule
applies unchanged: any `never` denies, otherwise any allow grants, integers take the highest, and
bans and restrictions still override. Triggers on the table make the member's combination private
and bump the layer and cache versions, so a purchase or an expiry is seen by the next request in
every process. A node permission is granted on every node (items sell capabilities; access to one
forum is sold as a group). `permissions.explain` reports the layer as `purchase`.

**A purchased group has its own table too** (`shop_group_grants`), for the reason promotions got
theirs: removing it on expiry must never remove a group an admin assigned or a promotion granted.
The eight combination triggers of `0011` were recreated with the extra union. Paid ranks are items
with a `group` effect.

**Selling a permission or a group needs `admin.permissions` as well as `admin.shop`**, and a
sold group must rank below the admin, as with promotions: creating such an item is editing
permissions.

**Only the permission and group effects apply in this pass.** The others (frame, name color,
thread cover, highlight, bump, username change) are stored and validated, and using the item
publishes `shop.item_used` for a later subscriber. A grant holds while the inventory row is held:
a non-consumable until it expires, a consumable while units are left.

**Temporary items end within a minute of their expiry, not at the instant.** A job marks them
expired and removes their grants; checking the expiry inside every permission check would put a
query (or a per-member timer) on the one path that must stay a memory lookup. **Accepted by the owner.**

**An item that was bought keeps its effect, kind and duration**, and an item or award that was
ever bought or granted can only be deactivated, not deleted: members hold what they paid for, and
the purchase log and grant history keep their references.

**Gifts are decided at purchase.** The purchase stores buyer and recipient separately; the charge
goes to the buyer and the item to the recipient's inventory. An item already in an inventory
cannot be given away.

**No hierarchy condition on `credits.adjust` and `award.grant`.** Giving credits or an award is
not a sanction, and with the condition the only administrator could not credit themselves or a
colleague. The cost is that a moderator given `credits.adjust` could debit an administrator.
**Accepted by the owner.**

**The seed gains the economy** after all earlier content and with its own random sequence:
14 credit rules, 400,000 rule applications with their ledger rows, 60 awards and 150,000 grants
(one member holds about 800), 6 categories, 90 items and 80,000 purchases with inventories,
1,000 members holding a purchased permission or group, and every balance, XP total, award total
and stock computed as the services maintain them (about 600,000 ledger rows).

**Administration is never for sale.** A permission of the `admin` category cannot be an item's
effect, nor a group that holds `admin.permissions` (checked when the item is saved and again at
purchase). Otherwise the last member with `admin.permissions` could be someone whose access ends
when an item expires, which no check at expiry time could refuse. For the same reason a group a
shop item sells cannot be given `admin.permissions`, and cannot be deleted while the item exists.

**Nor is administration earned.** A promotion cannot grant a group that has an entry for
`admin.permissions`, and a group a promotion grants (listed by one, or still held through one
while its deletion job runs) cannot be given such an entry. Promotions are evaluated by jobs that
cannot refuse, so the last-administrator guard would otherwise count someone who stops being an
administrator at the next sweep. The rule covers `never` as well as allow, for promotions and for
sold groups: a group that denies `admin.permissions`, gained by meeting criteria or by a
purchase, would take it from the last administrator just as silently. This was chosen over making
the guard ignore administrators who depend on a grant, which does nothing about `never` and
needs every combination resolved a second time. Accepted limit: a promotion stored before the
rule that already grants such a group keeps being evaluated by the jobs, which can still demote
its members; promoting or resetting by hand, or saving it, is refused until the group is removed
from it, and demoting by hand is refused when it would leave no administrator.

**The administrator guard runs on what is committed, and covers bans.** Operations that change
permissions, groups, memberships or promotions reload the acting member inside their write
transaction and authorize again there, so a member revoked by another process cannot act on the
principal their request resolved earlier. A ban (manual, from spam cleanup, or from the warning
threshold, where the warning is refused with it) cannot hit the last member who has
`admin.permissions`; banning anyone else is never refused. Deleting a group moves its members to
Member, so it is refused to anyone the Member group does not rank below, like any assignment.

**Accepted limits of this pass.** A member whose only activity of a UTC day falls in the five
seconds before midnight, and who is active again before the flush, gets the next day's
`member.active_day` but not that day's (activity is buffered as one timestamp per member). Credit
criteria take thresholds from zero up, so "in debt" is expressed as at most 0. The public catalog
filters inactive items while walking a category's items in order; categories hold tens of items.
Seeded temporary items that are still active end in 2100, so benchmarks never expire them.

**A rule never pays for events older than itself.** `credit_rules.created_after_event_id` holds
the newest event id at creation, and the subscriber skips older events; a timestamp cannot order
two events of the same millisecond. A rule's limit is evaluated at the event's own time (the
application takes the event's `created_at`), so processing an event again reaches the same
decision. No per-event receipt table: it would add a row for every domain event to protect only
a manual reset of the subscriber cursor.

**What a child paid follows the child's own state.** Reverting and re-applying look only at the
state of the item that paid: hiding a thread or a profile post leaves what its replies, comments
and their reactions paid, and a reply restored while its thread is hidden is paid again. New
payments still need the item and its parent to be visible. Merging a thread away reverts what
that thread paid. Hiding content with many paid reactions reverts them in batches of 500, each
its own transaction.

**More accepted limits.** Content created visible and hidden before the subscriber first sees
it (about a second) is not paid if it is restored later. The balance repair job sums a member's
whole ledger inside its chunk's transaction, which is milliseconds for the histories seeded and
grows with a member's history. `credits.history` reads the balance and the page in two queries,
so a movement committed in between shows for one response.

## Review of the whole code base (after milestone 28)

**Better Auth's own endpoints do not trust the cookie cache.** Only `/get-session`, which
`resolveActor` uses, reads the cached session; every other Better Auth endpoint reads the session
row, so a revoked session cannot renew its cache through them. A banned member cannot create a
session or change their profile there (`ACCOUNT_BANNED`). The cache strip relies on Better Auth
1.7.7 passing the hook's headers on; a test fails if an upgrade changes that.

**Change-email links are bound to the account and work once.** Better Auth's link is a stateless
token that finds the account by email, so a used link could later act on whoever registered with
the old address. A verification row keyed by the token's digest now holds the requesting account
id and is consumed before Better Auth runs. Better Auth still performs the final update by email;
replacing that endpoint is the remaining step if it is ever needed.

**Password reset requests need `redirectTo`** (`REDIRECT_REQUIRED` otherwise, the same answer
whether or not the address exists). **A username is valid only if its lowercase form is too**, so
every name accepted at sign-up can sign in in both forms; visually similar names in different
scripts are not detected.

**MCP tool calls are charged to the limit of their operation**, per call and with the same keys
as REST, on top of the per-request MCP limit; a batch can no longer do a hundred writes as one
request. A batch that contains a cancellation notification is rejected, because the SDK would
never answer it. Published tool schemas never reject input the server accepts: length limits on
trimmed strings move to the description.

**The upload route takes bodies up to the largest upload the settings allow** (1 GiB); every
other route keeps a 128 MiB ceiling, since their bodies are parsed in memory. A rejected
multipart request stores nothing.

**The counter rebuild leaves alone what a thread transfer is moving** (the thread, its node and
its posters) and repairs it on the next run; deferring would wait forever on a failed transfer.
One failing event subscriber no longer stops the others. The OpenAPI document lists anonymous
access for every GET and every public-marked operation, which includes a few reads that do need
an account.

## Second review round (after the whole-code review)

**A dead session cookie is refused everywhere except where no session is used.** Every Better
Auth endpoint other than `/get-session` loads the session row itself; a missing or expired row
answers 401 and clears the cookie. Sign-in, sign-up, password reset (request, link and submit)
and plain verification links never read a session, so there a dead cookie is cleared and the
request goes on: a member whose sessions were revoked elsewhere signs in at the first attempt.
The list (`SESSIONLESS_PATHS`) holds only endpoints whose handlers were read not to touch the
session or the cookie cache; a test compares it with an explicit copy, so a new endpoint is 401
by default. A change-email link keeps the 401, because it checks the session. Over REST and MCP
`resolveActor` still uses the cookie cache: without a mailer a revoked session keeps working for
at most five minutes; with a mailer the cache is off. Bans apply at once in both cases.

**The change-email confirmation is applied by Sermo in one write transaction**, by account id and
original address, and consumes the link in the same transaction; Better Auth's own step is never
reached for those links. It is the one place besides the purge that writes `auth_user` and
`auth_verification` directly.

**Expired credentials are purged in batches** (`purgeExpiredCredentialsBatch`: at most 1,000 ids
per table per transaction, by primary-key keyset, yielding between calls). Each hourly run walks
the three tables once from the start.

**Migration 0018 keeps every member's effective `admin.permissions` and writes as little as it
can.** Administration cannot start or end in a promotion: promotion grants of an administering
group become hand assignments, and those members keep the group after their criteria lapse. A
legacy entry on Unconfirmed, or a `never` on Member, is removed from the group; a private `never`
is written only for a holder who would otherwise resolve an allow, and an Unconfirmed allow stays
with its current holders. A member who had only the group's `never` therefore carries nothing: if
they are made an administrator later, the old `never` does not follow them. Orphan grant rows are
skipped rather than aborting the migration. The repair has no last-administrator guard: if the
only effective administrator held it through a stale combination, nobody administers afterwards
and the bootstrap configuration (`ensureAdmin`) is the way back. Before applying it to real data:
stop other writers, take a backup, run `PRAGMA foreign_key_check`, and review the promotions that
listed an administering group. It needs SQLite 3.44, like 0016.

**Writes that depend on the actor's standing decide inside the transaction** with `currentActor`:
permissions, groups, promotions, bans, warnings, thread bans, spam cleanup (including its queued
run), restrictions, credit adjustments, and the shop (catalog, buy, use). The administrative
reads of permissions and promotions go through `readWithCurrentActor`. Reports, `moderation.setState`
and `moderation.bulk`, word filters, settings, awards, the forum moderation writes (lock, sticky,
move, merge, split, delete, restore, moderator edits) and profile post and comment moderation also
re-check with `currentActor` inside their transaction (October 2026 round). Known limit: the admin
catalog writes (prefixes, navigation, notices, pages, storage) still decide with the actor resolved
for the request; the window is one request. A moderator who lost sight of the node gets NotFound from the
thread-ban operations, as before the transaction.

**Positions returned while a merge renumbers are decoded.** A merge stores a final position `p`
as `-(p+1)` until it flips; `thread.lastPost.position`, `posts.get`, the post listings and search
return the decoded value. `posts.list` on a merge target pages on each post's final
position (renumbered posts decode theirs, the rest are placed by creation time the way the
renumbering will place them), so a job step between two page requests duplicates or drops nothing.
Before the flip step this reads every post of the target and its sources per page (about 45 ms at
100k posts, 2 ms at 5k); from the flip step it is an indexed range. Known limit: `threads.markRead`
looks up by the stored value, and during the streams phase `posts.get` and search show a post not
yet processed at its position from before the merge.

**The permission-coverage analyzer counts a check inside a callback only when the callback is
invoked**: passed to a collection method (`map`, `flatMap`, `filter`, `forEach`, `some`, `every`,
`find`, `findIndex`, `reduce`, `reduceRight`), directly or through a variable. It does not follow
control flow, so a collection it cannot see into counts as non-empty; a visibly empty literal
does not.

**Published MCP input schemas are never stricter than the server.** Constraints on values the
server normalizes (trimmed strings, URLs, coercions) move to the description, and a field a
preprocessor fills in is not `required`. A schema-valid string that is blank after trimming is
still rejected by the server.

## Web consolidation (the frontend joins the repository)

Work on `feat/web-consolidation`. Entries marked **Owner review** were decided without the owner
and are cheap to reverse.

### Import and tooling

**The frontend lives in `apps/web`, imported with its history** (`git subtree add` without
`--squash`): its 97 commits keep their ids and `git log -- apps/web` reaches them. The workspace
is `@sermo/web`.

**One lockfile, exact versions.** `apps/*` is a workspace and the web app's own `bun.lock` is
gone. Its caret ranges are pinned to what that lockfile resolved. Transitive packages shared with
the backend (`express`, `@hono/node-server`, the MCP SDK, browser data tables) now resolve to the
backend's versions.

**Packages the web app imported without declaring are now declared**, at the versions already in
its lockfile: `unified`, `remark-parse`, `parse-entities`, `use-intl`, and the types
`@types/mdast`. They are not new: `react-markdown` and `next-intl` brought them in, and a
standalone install happened to place them where an import could find them. A workspace install
does not.

**`@types/node` is pinned at the root (26.6.4, the version the backend already resolved).** The
web app declares the 20 line; without a root pin that copy was hoisted and broke the backend
typecheck (`node:worker_threads`). The web app keeps its own copy.

**The web app keeps TypeScript 5.9.3 and its own `tsconfig.json`; the root typecheck does not
cover it.** Next 16.4 has not been shown to build with TypeScript 7. `check:web` runs the web
typecheck, tests and build, and `check` / `check:fast` include it. The root `test` script is
scoped to `./packages`, because the web tests resolve paths from their own directory.

**One Biome (2.5.15), two configurations.** `apps/web/biome.json` is a nested configuration
(`"root": false`) that keeps the web app's own formatter width and its Next and React lint
domains, so the root `lint` covers both. Moving from 2.4.2 changed no formatting. 2.5.15 lints
SVG files, so `apps/web/public` (static artwork) is excluded from the web lint.

**Ignore rules that matched at any depth are anchored to the root**: `/data/` (it hid
`apps/web/data`) and `/logs` (it would hide a route folder named `logs`).

### The seam between the web app and the backend

**The web app calls the REST API; it never opens the database** (assumption A1). One process owns
the SQLite file, and the HTTP adapter's rate limits, CSRF rule and client-IP handling apply to the
web app like to any other client. Everything goes through `apps/web/src/lib/sermo/`:
`call(contract, input)` builds the request from the route table, forwards the visitor's session
cookie, user agent and address, and validates the answer against the contract's output schema.
Pages do not know the transport, so replacing it means rewriting that folder.

**Two entry points load without the core**: `@sermo/core/contracts` (Zod schemas and table
definitions only; `MAX_BODY_LENGTH` moved to `limits.ts` so the contracts no longer import the
renderer) and `@sermo/api/route-table`. The web app imports nothing else from the backend.

**The session cookie cache can be turned off** (`AuthConfig.sessionCookieCache`,
`SERMO_SESSION_COOKIE_CACHE`, default on). A Server Component cannot write a cookie, so behind
the web app the backend runs with the cache off: resolving the visitor writes nothing back, every
request checks the session table, and a revoked session stops working on the next request.

**Sign-in, registration and sign-out stay in Better Auth.** The web app's server actions post to
`/api/auth/*` and deliver every `Set-Cookie` of the answer to the browser with its attributes.
The account switcher, the login without a password and the social sign-in button (no provider is
configured) are gone. "Stay logged in" maps to Better Auth's `rememberMe`. The terms checkbox is
required and checked on the server; acceptance is not recorded. **Accepted by the owner:** sign-in stays in Better Auth. **Owner review:** whether acceptance should be recorded.

**The client address reaches the backend in `x-forwarded-for`**, which the backend trusts through
`SERMO_TRUSTED_PROXY_HEADER`. The web app forwards the last entry of the header it received. Next
keeps a client-supplied `x-forwarded-for`, so in production the web app must sit behind an ingress
that sets the header itself, and the backend must not be reachable from outside.

**A dead session cookie is a guest while rendering.** `auth.me` is asked again without the
cookie; the cookie is replaced at the next sign-in. Member-only routes are gated in the proxy on
the presence of a session cookie (a redirect to `/login?next=`), and every operation still
decides for itself.

**Until its zone is migrated, a page still reads the JSON data** and sees the JSON member whose
username is the signed-in account's (`apps/web/src/lib/session.ts`). The bridge is deleted with
`lib/db.ts`.

**A development fixture** (`bun run dev:fixture`) creates four accounts and a little content
through Better Auth and operations. It refuses `NODE_ENV=production` and does nothing when the
member `nova` exists.

### Appearance is data: picture and colour catalogs

**Two catalogs, not six tables.** `catalog_images` holds avatar frames, profile covers and thread
covers (a `kind` column); `palette_colors` holds accents, name colours and prefix colours. One
set of operations per table (`catalogImages.*`, `paletteColors.*`, permission `admin.appearance`).
A catalog holds at most 500 entries of a kind and is cached whole in memory, so its lists are not
paginated and the public `site.get` runs no catalog query when warm.

**Catalog pictures are their own file purposes** (`frame`, `cover_preset`, `thread_cover`,
`award_image`, `shop_image`, `site_logo`, `site_icon`, `site_backdrop`). They differ from a
member's uploads in four ways: the matching admin permission is checked at upload, not at attach;
the types are fixed to JPEG, PNG and WebP (no SVG, assumption A7); they are outside the storage
quota and the member upload size setting (a fixed 25 MiB); and once attached they are served
`public, max-age=31536000, immutable`, because replacing a picture always creates a new file id.

**Deleting a catalog entry that is in use deactivates it** and keeps its picture: members,
threads and shop items keep what they have and nobody new can pick it. The check lives in one
function per catalog that later features extend.

**The picture of an entry that was never activated is readable by its file id.** Catalog art is
not secret, and an entry deactivated because it is in use must stay readable, so files do not
follow the entry's active flag. **Accepted by the owner.**

**A frame's placement is measured at upload** (`modules/images/frame-geometry.ts`) and stored
with the file; `catalogImages.create` uses it unless a placement is given, and the administrator
can adjust it afterwards. The rule was recovered from the 93 frames the frontend shipped and its
hand-generated table: it reproduces 45 of them within half a percent and 86 within about two.
It proposes; it does not replace looking at the preview. **Accepted by the owner.**

**The default palette is seeded by the migration** (6 accents, 11 name colours, 8 prefix
colours, the values the frontend had in its stylesheet), so a new site looks right before anyone
opens the panel. They are ordinary rows and can be changed or removed.

**The site's logo, icon and backdrop are settings** (`logoFileId`, `iconFileId`,
`backdropFileId`), not catalog entries: there is one of each.

**`settings.update` changes only the keys it names.** Its input used to be the settings schema
made partial, and Zod fills a default into every optional key that is left out; each update
therefore reset every defaulted setting the caller did not send. The input is now built from
the fields without their defaults. This was a defect before this work.

**Every picture setter takes `fileId: null` to remove the picture**, instead of separate clear
operations. Deleting an award or a shop item deletes its picture.

### Forum content, site chrome and members

**A forum list sorts by a generated column.** `threads.sort_at` is the later of the last post and
the last bump, VIRTUAL and indexed. Everything that maintains `last_post_at` is untouched, and a
bump is not a post: unread state, counters and last-post data do not move.

**Rankings are computed in the background and kept per forum** (`rankings`, job every five
minutes and at startup): the most replied-to, most reacted-to and most viewed threads, and the
hot threads (see "Hot replaces Top"). A reader merges the rankings of the forums the viewer can see,
filters by current state and ignored authors, then cuts (`threads.ranked` applies the viewer's
ignores to the three "most" rankings; `latestPosts` and `latestThreads` do not). Two earlier designs were rejected by
review: one global list (hidden forums pushed everything out, and its emptiness hinted at hidden
activity) and a per-forum cap equal to the reader's size (nothing replaced filtered entries). No
hot path counts or totals reactions.

**The `following` feed covers the 100 members followed most recently.** It walks each followed
author's newest content through an index and merges; an unbounded followed set would not be
bounded work.

**The feed is a list of conversations, not a log of posts.** `feed.list` answers one entry per
thread, at its newest post, and says whether the viewer may reply (`canReply`: the decision
`posts.create` makes before it looks at the reply, the forum's posting rules included, with the
viewer's thread bans and the forums' rules read once per page), so a card can be answered where
it is read. An entry per reply filled the home page with one busy thread. `latest` walks the
visible threads by last activity through the existing index `threads_public_feed`, as the
`latestPosts` ranking does, and merges them with the wall posts by time: every thread examined is
a candidate, so the examination cap is spent only on what the viewer may not see, and a page is
full whatever the number of replies in the threads above it. A first version walked posts and
kept each thread's newest; a thread with more replies than the cap then emptied the pages below
it. The cursor of `latest` is the thread's place (last post time, thread id) and the wall post
id; a cursor of the earlier shape, or of another scope, is refused. `following` still walks the
followed members' posts and only drops the repeats within one answer: the exact rule there is
"the newest post a followed member wrote in the thread", which needs a lookup per thread and
followed author, so a later page may list a thread again with older activity. `top` ranks posts
and is unchanged.

**Navigation and static pages are data.** `navigation_entries` holds the header, the phone bar,
the account menu and the footer in two levels; the entries the site ships with are seeded, carry
a stable `builtin` key the client can attach presentation to, and can be renamed, reordered,
switched off and re-audienced but not deleted or pointed elsewhere. `static_pages` holds Markdown
pages by slug. No page is seeded: the starter loader creates them.

**A page body is at most 20,000 characters.** The renderer is quadratic on emphasis runs: the
worst case measured is 0.4 s at 10,000 characters and 1.7 s at 20,000, synchronous. Only
administrators write pages; a longer text is split.

**Member presentation is read in batches, separately from content.** Listings keep the small
`UserSummary`. A page collects the member ids it shows and calls `users.cards` (avatar, frame,
name colour, title, badges, level) or `users.authors` (the card plus cover, awards shown, level
bounds, signature, counters) once. Both are open to everyone: they hold only what is drawn next
to content that is itself visible. The alternative, widening `UserSummary` in every operation,
would have changed every hot path and every contract.

**A badge is a group's title, colour and style key.** `groups.badge` was already defined as a
style key; a member shows one badge per group that has one, highest rank first. The style keys
are the frontend's design system (`solid`, `tint`, `outline`, `heart`, and the built-in groups'
`admin` and `moderator`); the choice per group is data.

**The frontend's five "permissions" are real permissions**: `profile.signature`,
`profile.customTitle`, `profile.awardSlots` (an integer), and, with the shop task,
`profile.coverPreset` and a free rename. A signature or custom title a member loses the
permission for stays stored and stops being shown.

**Levels are settings** (`levelStep`, `levelTitles`); the level is computed from award XP, never
stored. Signature and title limits and the member-of-the-month weights are settings too.

**Member of the month is computed by a job, not in write paths.** `member_month_stats` is
recomputed every ten minutes for the month in progress from bounded id ranges; when a month ends
its winner is written once to `month_winners` and never rewritten.

**Referrals come from referral links** (item 2, below; it replaced naming a referrer after
signing up).

**Reputation and vouches are not built.** The frontend displayed both and nothing could ever
change them (new members got 0; only the demo data had values). Reputation is shown as the
existing reaction score; vouches are dropped from the screens. This departs from assumption A5,
which asked for both to be built with the frontend's behaviour as the specification: there is no
behaviour to specify. **Accepted by the owner.**

**A birthday publishes its day and month only.** The year is stored for the member and never
returned to others.

**An award's picture is a backdrop, its icon a glyph.** The round award icon (next to a name, on a
profile, in the panel) always draws the glyph of the award's icon key in the colours of its tier.
The picture is a wide banner drawn behind the award's card on `/awards` and behind the heading of
its own page. For a while the icon showed the picture when the award had one, which cropped the
middle of a 16:9 banner into a circle and pushed the emblem of every starter award to its right
edge. One picture cannot serve both shapes; a square picture for the icon would be a second file.

**Messages and alerts open as panels from `md` up; the phone bar holds them below it (item 7).**
The envelope and bell buttons of the header open a drop-down panel (the latest items, a link to
the full page, and the panel's action), as forum software commonly does; the panel is capped at
the width of the screen less a small margin. Below `md` the header has no room for them, and the
phone bar's Messages and Alerts entries link to `/conversations` and `/notifications`, each with
its unread number. Search stays a link on phones: its panel is a form, which the search page
already is.

**The footer carries no LITE link, and its lists pair up on a phone.** The link to the LITE
settings is taken out of the footer for now, at the owner's request. Members still reach the
settings from the avatar menu; a guest has no link to `/lite` until one is placed elsewhere. Below
`sm` the footer's link lists stand two to a row instead of one under another.

### Shop effects, wearing, renaming and ranks

**A shop effect names a catalog entry.** `frame`, `nameColor` and `threadCover` carry the id of a
`catalog_images` or `palette_colors` row instead of free text or a hex value. Migration `0024`
converts stored items: a hex colour becomes (or reuses) a name colour; a free-text frame or cover
key becomes a picture-less, inactive catalog entry and its item is taken off sale until an
administrator gives the entry a picture.

**Holding and wearing are separate.** Buying a frame or a name colour makes a member hold it;
`appearance.set` decides whether they wear it. A member holds something through an inventory row
that is active or has units left. What they stop holding (an item that expires, is used up or is
replaced by an upgrade) comes off in the same transaction, through one helper. Accents are free
to everyone. A cover from the gallery needs `profile.coverPreset` and stops showing, without being
forgotten, when the permission is lost.

**A group's name colour replaces the frontend's rank colour unlocks.** The frontend let a paid
rank unlock a name colour, inherited by higher ranks. A group now has a name colour of its own and
its members show it unless they chose another, so nothing needs unlocking.

**Thread effects apply in `shop.use`, in the transaction that takes the unit.** Milestone 28
left applying them to "a later subscriber" of `shop.item_used`. Applying them where the unit is
taken means the member sees the result at once and a unit is never spent without its effect. The
event is still published. A bump sets `bumped_at` and nothing else: it is not a post.

**A username changes only through `users.changeUsername`.** It is free for holders of
`profile.renameFree` and otherwise takes one unit of a `usernameChange` item (assumption A9: the
frontend's policy, core's grammar). The unit is taken first and given back if Better Auth refuses
the name; if the process dies in between, a unit is lost without a rename. Better Auth's own
update endpoint refuses a username change unless it comes from this operation. Before this, any
member could rename themselves freely through that endpoint. **Accepted by the owner.**

**A rank is upgraded by paying the difference, less what the old rank is worth**
(`shop.upgrade`, assumption A6). A member's current rank is the most expensive `group` item of the
same category they hold that is active and has not run out (the expiry job marks a lapsed row up
to a minute late, so `expires_at` is checked too); the new one's catalog price must exceed the old
one's catalog price; the old item leaves the inventory with its group. Ranks only go up.
*Changed after review.* The first version charged the difference of the two CATALOG prices: a
member whose rank had nearly run out, or whose price had changed since, got the full catalog value
back. Now the inventory row records what was paid (`shop_inventory.paid_price`; a gift carries the
buyer's payment to the recipient) and the credit is that amount: in full for a permanent rank, and
for a timed one the amount times the share of its duration still ahead, rounded down. The member
pays the new catalog price minus the credit, never below zero, and the new row is worth the credit
plus what was paid, so the next upgrade credits correctly. A 30-day rank bought for 100 with 10
days left, upgraded to a 250 rank, credits 33 and costs 217; a permanent 100 rank whose catalog
price was later raised to 200, upgraded to 250, credits 100 and costs 150. Migration `0026`
backfills existing rows from the newest purchase that gave the member the item (a consumable: the
sum of its purchases), else the item's current price; a rank that was itself reached by an
upgrade is therefore valued at the difference it was recorded at, not its full value. The frontend also granted an award with a rank: an award with
the existing "has bought item" criterion does that without new code. **Accepted by the owner.**

**`shop.buy` refuses a yes/no permission the recipient already holds another way**, as the
frontend refused selling a perk a rank or a staff role already gave. *Changed after review.* The
check now applies only to permissions of global scope held through something other than a shop
item (it asks the permission explanation for an allowing group or member layer). Number-valued and
per-forum permissions are always sellable, and a permission held only through another shop item
does not block a purchase. A username change is sold in units, so `shopItems.create` and
`update` refuse a `usernameChange` effect on a non-consumable item and `0026` takes existing ones
off sale. If a rename succeeds at the identity provider and the forum's own update then fails, the
provider's name is put back and the unit returned; if that fails too the unit stays spent and the
mismatch is logged.

## Administration (members, erasure, staff, the panel's home)

Review fixes to `modules/admin`. Entries marked **Owner review** were decided without the owner.

**Erasing a member** (`users.adminErase`). The first transaction does three things together: it marks
the member erased (`users.erased_at`, also cutting every session, see below), bans them for good,
and writes the one `member.erase` log entry. Everything after it only takes something away and
looks at what is already gone, so a run that stops anywhere is finished by running it again, and a
rerun writes no second log entry (it writes no entry at all: the first one is the record). In
order: sessions and API keys are revoked; every pending token of the member in
`auth_verification` is deleted (Better Auth keys a password-reset link and the forum's own
change-email record by a random identifier and holds the member's id as the value, so they are
found by value; email verification links are signed and name an address, not a member, and stop
matching when the address changes); the address becomes `erased-<id>@invalid` and the password is
removed; follows end, the profile is cleared (about, title, signature, location, website,
birthday, social handles, what they wear, avatar and cover); queued account emails for the member,
which hold the old address and sometimes a reset link, are deleted; last, the name becomes
`Deleted member <id>`, or the first free `Deleted member <id>-<n>` (n up to 20) when an account
from before the name was reserved holds it. The name goes last because nothing else depends on it.
Also removed in the profile step: the member's rows in `email_failures` (by member and by their old
address), the old address in `undeliverable_emails` (both are deleted just before the address is
replaced, because afterwards the old address is unknown and a rerun could not find it), their
`push_subscriptions`, `auth_user.image` (through Better Auth), every account email job of the member
that is not running (finished ones hold the address too), and the referral links: their own
`referred_by`/`referred_at` end and the referrer's `referral_count` drops by one; members they
referred lose their `referred_by`/`referred_at` and the erased member's own count becomes 0. The month standings keep
what they already counted. What stays: what the member wrote (under the new name), their ledger,
warnings and every log entry. **Owner review:** `@name` mentions and quotation attributions
inside other members' posts keep the old name; rewriting other people's posts is not done, so the
name of an erased member can still be found there (a test lists the only table that holds it). An erased member is marked, not just banned: `bans.lift` refuses them, a session cannot
start for them even with no ban in force, Better Auth's reset-password endpoint refuses a link of
theirs and its request endpoint makes none, `AdminMember.state` is `erased` (it wins over
`banned`), and every administrative write on them (identity, profile, sessions) is a conflict;
only reading them, and running the erasure again, are allowed.

**The name `Deleted member ...` is reserved.** A username whose lowercase form begins with
`deleted member` cannot be registered, chosen, set by an administrator or reported available;
the refusal reads like any taken name so the rule is not advertised. Only an erasure (and putting
back a name a member already had, after a failed rename) may take such a name.
`auth_user.name` follows the username on every rename, as registration gives it the username.

**Sessions end at once, even with the session cookie cache on.** `users.sessions_revoked_at` is set
when all of a member's sessions are revoked by an administrator, when an administrator sets their
password, on a ban (manual or by warning threshold) and on erasure. `resolveActor` refuses a
session created at or before it. The member's row is already read to build the actor, so this
adds no query. It uses the session's `createdAt`, which the cached cookie carries. No window
remains for those cases. One residual window: revoking a single session by id deletes its row but
cannot single it out of the member's cache without a lookup on every request, so that session's
cached cookie lasts until the cache expires (five minutes at most). **Owner review:** the
alternative is to cut all of the member's sessions when one is revoked.

**Wrong passwords are limited.** The administrator's own password, asked again before a sensitive
change (`auth.verifyPassword`, `users.adminUpdateIdentity`, `users.adminErase`, and the writes that
confirm with `actorPassword`), allows five wrong answers in fifteen minutes **per session** and
twenty per member across all their sessions (`admin_password_failures`, one row per answer with
its session). Further answers, right ones included, are refused for the session that used its five,
or for every session once the member's twenty are used, until the oldest wrong one leaves the
window. The count used to be per member only, which let one stolen session send five wrong
answers every fifteen minutes and keep the owner's correct password at 429 for good (with mail
off there is no reset path). Now a session can only use up its own five: the member limit is
larger so guessing through one session cannot exhaust it, and it stays finite because opening a
session takes the password. An API key or token actor takes no part (it cannot confirm). An
in-process caller counts as session 0. A guess is recorded before the
check, so answers sent together are counted, and a right answer gives its own guess back without
clearing the earlier wrong ones. The refusal is a `RateLimitedError` (code
`rate_limited`), which the API answers with 429 and the same body as its own request limiter
(`{ error: { code: "rate_limited", message } }`), so clients see one kind of 429; MCP reports the
same code.

**Reaching an administrator takes `admin.permissions`.** Setting a password or address, ending
sessions or erasing lets an administrator sign in as the member (or close them for good).
`users.adminUpdateIdentity`, `users.adminErase` and `users.adminRevokeSessions` on a member who
holds any permission of the `admin` category, from any source (a group, a personal entry, a shop
grant), also require the actor to hold `admin.permissions`; otherwise they are forbidden (the actor
already knows the member exists). Rank alone is not enough: a holder of `admin.members` only could
otherwise give themselves the account of a lower-ranked member who administers through a personal
entry or a low-ranked group, and sign in as them. The rule is checked again inside the write
transaction with the committed permissions. A side effect: erasing the last holder of
`admin.permissions` is now refused earlier, because an actor who is not a holder is forbidden.
**Owner review.**

**A password or address set by an administrator cancels the member's pending links.** A reset or
change-email link the member asked for earlier would otherwise set a password afterwards.

**Lists stay bounded.** `moderatorLog.list` with `action` filters the rows a bounded walk
examines (the same bound as the other filtered lists, 400 rows), so a page may be short or empty
and `nextCursor` says where to go on. `users.adminList` reads a group through its two membership
indexes (primary and by hand, merged in the application), unconfirmed through its group, and a
prefix by two range scans. A prefix cannot keep "newest first" without sorting every match, so its
results are ordered by username (members whose username starts with it) and then by email (those
matched by address alone); the cursor carries the position. **Accepted by the owner.** The rosters read each
group on its own bound and return `truncated`. `admin.activity` keeps its result 60 seconds per set
of kinds, and counts reports only for someone who handles them site-wide.

**Group, permission and promotion writes are confirmed with the password in the same call.**
`permissions.set`, `users.setGroups`, `groups.create`, `groups.update`, `groups.delete`,
`nodes.setModerator`, `promotions.create`, `promotions.update`, `promotions.delete` and
`promotions.apply` take `actorPassword`: the acting administrator's own password, checked with
`verifyActorPassword` (the same wrong-answer limit as `users.adminUpdateIdentity`) right after
the early permission check, so someone who may not act is told it is forbidden whatever they send,
and a wrong answer stops the request before anything is changed. The owner's rule is that changing
groups and permissions needs the administrator's password, and a rule kept only by the web app
is not kept: a browser can call the REST API directly with the same session cookie. So the
requirement is made by the backend, and it keys on one explicit marker: the actor field
`interactive`, which only the HTTP layer sets (the request middleware of `/api/v1` and `/mcp`),
on a `user` actor it resolved from a session cookie. An interactive actor that sends no
`actorPassword` gets a validation error naming the field; a wrong one is refused before anything
changes. An API key or token is refused on all of these operations (Forbidden), whether or not it
sends a password: it cannot confirm, so these changes need a signed-in session plus the
administrator's password. `users.setSuperAdmin` follows the same rule. Actors built by hand (the
starter loader, the dev fixture, jobs, tests, the benchmark harness's `callInProcess`) never carry
the marker and are not asked; they are never a key and cannot be built from HTTP or MCP, since the
request middleware marks every session actor it resolves. A new caller that resolves sessions from
cookies and should be held to the rule must set the marker. The promotion writes are included
because a promotion grants groups to members. Group names stay readable without it. This replaces
the earlier exemption for keys (Owner review #3). `DELETE` routes read
their input from the query string, so `groups.delete` and `promotions.delete` over REST carry the
password there.

**Panel reads carry what a screen needs to draw a row.** `reports.list` and `approvals.list`
rows gain `excerpt` (plain text from the stored source, markup and tags removed, at most 200
characters) and `where` (`{ kind: "thread" | "profile", id, title }`), from one batched lookup per
kind of content on the page (no lookup per row; a test holds the statement count constant as the
page grows). Messages of a conversation are never described (empty excerpt, `where` null):
nothing but `reports.viewConversationMessage`, which is logged, lets a non-participant read a
conversation. A profile the viewer may not see (privacy, no `profile.bypassPrivacy`) is not
described either. `reports.list` already carried `reportCount`. `site.get` carries
`maxUploadBytes` (the member upload limit the API enforces; catalog pictures keep 25 MiB).
`notifications.types` marks the watch types with `emailFollowsWatch` (their email default is
forced on). `creditRules.list` returns `triggers` with `acceptsForums`. The edit-member history
can already filter `credits.ledger` and `promotions.log` by `userId`; `awards.memberGrants` lists
the grants a member holds now (revoked ones are not in it).

**An erased member takes no further administrative or moderation write.** The rule that already
covered identity, profile and sessions now covers every write that targets a member:
`permissions.set` (for a member), `users.setGroups`, `nodes.setModerator`, `warnings.create`,
`restrictions.create`, `bans.create`, `threadBans.create`, `credits.adjust`, `awards.grant`,
`promotions.apply`, `spamCleanup.start` and `shop.buy` with a `recipientId` (a gift) answer a conflict with one message (`requireNotErased`: "This member's account
was erased."), checked inside the write transaction after the permission decision, so a caller who
may not act is still told it is forbidden. Taking something away stays possible (lifting a ban is
already refused for another reason; revoking an award, lifting a restriction or a warning's
expiry do not add anything). A walk over every write whose input names a member found no other gap. Taking
something away stays open: `threadBans.lift`, `bans.lift` (refused for its own reason),
`restrictions.lift`, `users.unfollow`, `users.unignore`. A spam cleanup already running when the
member is erased finishes: only the start is refused, the job continues the same function.
Actions between members (following, ignoring, messaging, profile
posts) are not covered: they are the members' own, and an erased account is
permanently banned, which the referrer rule already treats as absent.

**Group names are readable by those who must pick a group.** `groups.list` and `groups.get`
need any one of `admin.groups`, `admin.permissions`, `admin.promotions` or `admin.members`: the
screens those open (entries for a group, a promotion's groups, a member's groups) show group
names, and a holder of one of them could not read any. The writes still need `admin.groups`.
Every group carries `memberCount`: members with it as primary group plus those holding it by
hand without it being their primary (promotion and shop grants are not counted). `groups.get`
always counts; `groups.list` counts only with `counts: true` (otherwise `memberCount` is null and
no counting statement runs), because most screens only need the names; `groups.update` counts
after its write transaction has committed, never inside it. The count is one
statement for the whole list, two correlated counts per group over covering indexes
(`users_group`, `user_groups_group`) and a point lookup on `users` for the overlap, so the cost is
bounded by the number of groups and the size of each group's own index range; this is an
administration read, never part of a page view.

**The panel's pending work comes with `auth.counters`.** The queue reads return no total, and
counting on every page view is against the rules, so `auth.counters` (the site header's read)
gains `openReports` and `pendingApprovals`, each `{ count, more }`. They look at the newest 100
entries of each queue (the queue reads' own statements, no cursor, limit 100, never a COUNT),
count those the viewer may act on with the queue reads' own rule (`filterModeratable`, so a
moderator of some forums sees only theirs), cap the number at 99 and say so (`cap`, so no client hardcodes 99), and set `more`
when the window was full. `more` means the scan stopped at its bound, so `count` may be
incomplete; it does not mean the viewer has more than `count` (the window holds the newest 100
entries of the queue, whoever they belong to). A client shows `count` when `more` is false and
"`count` or more" when it is true. A scoped moderator on a busy site may get `count: 0` with
`more` set: the 100 entries were not theirs. Everyone who holds none of the
permissions that open a queue (a guest, a plain member, a moderator without report or approval
rights) pays no statement for it: the check is the permission state already in memory, and a test
holds a plain member to one statement and a guest to none, as before. Unlike the activity counts
of the panel's home page the numbers are not cached: they are a few indexed rows for staff only.

**API keys are credentials.** A key cannot change groups, permissions or promotions at all;
minting a key from a stolen browser session still had to be closed. `POST /api/auth/api-key/create`
from a session now needs the member's current password in the body (`{ "name": "...", "password":
"..." }`): a missing one is a 400 (`PASSWORD_REQUIRED`), a wrong one a 403 (`INVALID_PASSWORD`),
and the answers are counted with the same limits as `actorPassword` (five wrong per session,
twenty per member in fifteen minutes; a further answer, right ones included, is a 429). A call made
in-process with a `userId` and no session (loaders, tests) is not asked. A member's own change of
password, a reset by link, an administrator setting the password and an administrator signing the
member out of every session each revoke all the member's API keys; revoking one session by id does
not. What a key can and cannot do:

- A key acts with the permissions of its member, on every operation that does not ask for a session.
  The group, permission, moderator and promotion writes that take `actorPassword` are not among
  them: a key is refused there, with or without a password.
- A key cannot create, list or delete keys, change the member's password, address or username through
  Better Auth, or open a session (those endpoints need a session cookie, and a request with a key is
  unauthenticated there).
- A key cannot call `auth.verifyPassword`, `users.adminUpdateIdentity` or `users.adminErase`, which
  need the acting member's own password and a session.
- A key stops working when the member is banned or erased, when its expiry passes, and in the
  cases of the previous paragraph.

**Sign-in counts wrong passwords per account and address.** `/sign-in/email` and
`/sign-in/username` had only Better Auth's three requests per ten seconds per address, which
rotating addresses multiply. Now ten wrong passwords in fifteen minutes for one account name (or
address) as typed, from one client address, end that account's sign-ins from that address with a 429
(`TOO_MANY_ATTEMPTS`), right passwords included, until the oldest wrong one leaves the window.
Other addresses are not affected, so a stranger cannot lock the owner out from elsewhere. The count
is kept for names that do not exist too, so the answer never tells an unknown account from a known
one. It does not reuse `admin_password_failures` (a row there belongs to a member by foreign key,
which an unknown account has not): `sign_in_failures` (migration 0029) holds one row per wrong
answer under a SHA-256 digest of the account and address, so it stores neither; it is pruned per key
on every write and in bounded batches by the hourly cleanup. A request with no client address
(an in-process call) is not counted. A guess is recorded before the password is checked and given
back when the answer was anything but a wrong password.

**Cards respect profile privacy.** `users.cards` and `users.authors` answered the full block for any
id, so a member whose profile the viewer cannot open (`profileViewPrivacy`, or the viewer lacks
`profile.view`) still showed title, cover, join date, counters and signature, and a guest could
walk the member table by id. For such a member both now return the minimal card: id, username,
avatar, frame, name colour and badges (what is drawn next to a post; there is no separate staff
flag, the staff groups' badges carry it), title empty, level 1, and `restricted: true`; the author
block also has a null cover, the epoch as join date, zero counters, `nextLevelXp` 1, no awards and a
null signature. The rule is the one of `profiles.get` (the member themselves, or a holder of
`profile.bypassPrivacy`, or the privacy mode against the viewer), decided for the whole batch from
one privacy query and the viewer resolved once. Other loaders (administration, directory, standings)
are unchanged and report `restricted: false`. Banned and erased members are treated as before.

**Better Auth's own password endpoints.** `/api/auth/verify-password` (a session could ask "is this
my password?" without any limit beyond 100 requests per ten seconds per address) is no longer
served; the forum's `auth.verifyPassword` is the one place that asks. `/api/auth/change-password`
asks for the current password and Better Auth limits it to three requests per ten seconds per
address, which a stolen session can multiply with addresses; it now takes a guess from the same
counts as the administration checks (five per session, twenty per member in fifteen minutes) and
answers 429 once they are used up. Only an answer Better Auth refused with its error code
`INVALID_PASSWORD` (the CURRENT password was wrong) stays counted; a success, a rejected new
password (too short or long, checked before the current one) and any other failure give their
guess back.
## Deployment: two services

**Three containers, one published port.** `sermo` (backend) and `web` (Next.js) publish nothing;
`ingress` publishes one port (8080 by default). The backend trusts `x-forwarded-for` only because
nothing but the ingress and `web` can reach it, so publishing its port would let anyone choose their
address. Documented in `docs/deployment.md` with that warning.

**The ingress is Caddy**, because a complete reverse proxy for this layout is a 40-line file, the
image is small, and it overwrites `X-Forwarded-For` by default and can terminate TLS later without
another component. The ingress sets the address itself: verified with a forged header sent through
it (the backend recorded the connection's address, never the forged one), and verified without it
(the web app forwards the last entry of whatever it received, so a forged header became the recorded
address). That second result is why the ingress must sit in front of `web`, not beside it.

**Browser `/api` requests go ingress to backend, not through Next's rewrite.** It is the shorter
path, session cookies and the `Origin` check see one origin (`BETTER_AUTH_URL` equals the address in
the browser bar), and file downloads never pass through Next. Paths routed to the backend, taken
from the route table in `packages/api/src/app.ts`: `/api/*` (Better Auth, REST, files, OpenAPI),
`/mcp`, `/health`, `/robots.txt`, `/sitemap.xml`, `/sitemaps/*`, `/feed.atom`,
`/forums/*/feed.atom` (and `/nodes/*/feed.atom`, which answers 301 to it), and `/*.txt` (the IndexNow key file; the web app serves no `.txt`). The web
app has no routes of its own under any of these. Uploads from the pages are Next route handlers and
travel ingress, `web`, backend.

**One public address scheme.** Everything the backend publishes as a page address (sitemaps,
feeds, canonical links, structured data, push links) is `/forums/<id>-<slug>`, `/threads/<id>-<slug>`
and `/members/<id>-<slug>`, the addresses the web app serves; the slug is cosmetic and the number
decides. The per-forum feed is `/forums/<id>/feed.atom` (the slugged form is accepted too); the
earlier `/nodes/<id>/feed.atom` answers 301 to it. The REST API's own `/api/v1/nodes/...` routes
are unchanged. Static pages are served by the web app at `/pages/<slug>`; the sitemaps do not list
them.

**The build-time `/api` rewrite is acceptable and `next.config.ts` is unchanged.** The rewrite is
fixed when the image is built, but with the ingress it only answers when the web app is reached
without it. `Dockerfile.web` takes `SERMO_API_URL` as a build argument that defaults to
`http://sermo:3000`, so even that fallback is right. Everything the web app calls at run time
(`apiUrl()`, `publicUrl()`) reads the environment per request. Observed without the ingress and
with the default build: a sign-up posted to the web app's `/api` failed with a 500 because the
rewrite pointed at the development port baked in at build time.

**The web image uses Next's standalone output, switched on with `NEXT_PRIVATE_STANDALONE`.** That is
Next's own switch for `output: "standalone"`; setting it in the build avoids editing
`next.config.ts`, which this change leaves alone. The build finds the monorepo root from `bun.lock`
and traces the workspace packages, so the build works as a plain `bun --bun run build` in a Bun
stage and the runtime is `node:24-alpine` running `server.js`. It runs as the `node` user.

**The web container is stateless except for one leftover.** `apps/web/src/lib/db.ts` still reads and
writes `apps/web/data/db.json` for the zones that are not migrated yet. The image carries the
seed copy, so those pages render, but anything written there is lost when the container is
recreated. It disappears with the bridge.

**One named volume, `sermo_data`**, for the database and local files, unchanged. Compose's
project name is not set in the file, so existing installations keep their volume.

**Fixed by Compose, not by `.env`:** `PORT`, `SERMO_DB_PATH`, `SERMO_TRUSTED_PROXY_HEADER`,
`SERMO_SESSION_COOKIE_CACHE=false`, `SERMO_API_URL`, `SERMO_PUBLIC_URL` (taken from
`BETTER_AUTH_URL`, so the public origin is written once). They follow from the topology; a wrong
value breaks the deployment.

**The upload limit is set in three places:** the site setting (default 25 MiB), `INGRESS_MAX_BODY`
(default 32MiB, Caddy `request_body max_size`), and the backend's fixed transport ceiling. The first
two are raised together. Caddy does not buffer request bodies unless asked to.

**Health checks and ordering.** Backend: its `/health`. Web: a check that the port answers, so its health
does not depend on the backend. Ingress: a separate internal listener (`:8081/ready`) so it reports itself
only. `web` waits for `sermo` to be healthy; the ingress waits for both. Restart `unless-stopped`;
stop periods 40 s (backend, existing), 20 s, 10 s.

**The ingress runs as uid 65532 with a read-only root, no capabilities except binding low ports**
(the Caddy binary carries that file capability, and the container will not start without it) and a
tmpfs for its data directory. `persist_config off` stops it writing its config.

**The backend image drops Next's compiler.** The lockfile covers the web app and `bun install
--production` installs it for the backend too (about 400 MB, loaded by nothing there); the image
build removes it. `--filter` did not help. The web build stage installs the whole workspace because
the build's type check needs the Bun types of the root package.

**First administrator:** the existing `SERMO_ADMIN_*` bootstrap (all three together, only while no
administrator exists). There is no CLI and the first registered member is not promoted; that is a
gap only if the variables are left empty.

**TLS** is out of scope; the docs say it goes at the ingress, or in front of it with
`trusted_proxies` set. Both upstreams get `header_up X-Forwarded-For {client_ip}`: Caddy defines
`client_ip` as the connection's address, or, when the connection comes from a configured trusted
proxy, the real client parsed from the forwarded header. Setting it explicitly means the backend and
the web app always receive exactly one address, never the list a proxy chain would append. Without
`trusted_proxies` behind another proxy every visitor shares that proxy's address, which turns the
per-address limits into site-wide ones; `docs/deployment.md` says so. The backend refuses to start
when `BETTER_AUTH_SECRET` is shorter than 32 characters.

## Upgrading and rolling back

**Migration `0026` was rewritten before it shipped.** Its backfill looked up each inventory row's
purchases by item and recipient with only the `(item_id, id)` index to help, so an item held by many
members cost a scan of all its purchases per holder (17 s for 20,000 holders, inside the start-up
transaction). It now creates a temporary index on `(item_id, recipient_id, id)`, runs the same two
updates, and drops the index in the same migration. The result is identical. Drizzle records an
applied migration by its journal timestamp, not by the file's content (it applies a migration only
when the timestamp is newer than the last recorded one), so a developer database that already ran
the old `0026` does nothing: it is neither rerun nor flagged. A test runs the statements over 20,000
holders and fails above five seconds.

**Rolling back.** After migration `0024` the shop effects are stored in a shape that `main`'s code
rejects (they refer to catalog entries by id). Going back to `main`'s code therefore needs a
database restored from a backup taken before the upgrade; running the old code on the upgraded
database fails when it reads a shop item.

**Custom staff groups.** Migration `0023` marks only the built-in Moderator and Administrator
groups as staff (`groups.is_staff`). Groups an owner made for staff before the upgrade need "listed
as staff" ticked once; `docs/deployment.md` says so under Upgrade.

**Catalog pictures are immutable by file id.** A picture is served from `/api/v1/files/<id>` with a
year-long cache, and replacing one requires a new upload (a new file id; the old id is refused as
a replacement because it is no longer an unattached upload). The entry then points at the new id and
the old file is queued for permanent deletion by the storage job. A client that cached the old
address keeps showing the old picture from its cache until it reads the entry again (it then gets
the new address, so the old one is simply no longer referenced); once the job has run, the old
address answers not found.

## Shared pieces instead of one per screen (conversations, posts, reactions)

**Conversations read like forum threads.** The two-pane chat (a list pane on the left, bubbles, a
sticky one-line composer) is gone. `/conversations` is a full-width list, a conversation is a page
shaped like a thread (title, participants in the aside, messages in one card, the reply form at the
end), and `/conversations/new` is a form page like a new thread. Reason: the chat felt like another
product inside the forum, and every chat-only piece had to be built and kept apart from the rest.

**One frame for a thread post and a conversation message.** `components/forum/post-frame.tsx`
(`PostFrame`, `PostNote`) draws the author, the time, the body, the actions and the signature; the
thread page and the conversation page pass what differs (post number, share, quote, edit, the
moderation block). A message shows the same author header and signature a post does. The profile
wall keeps `MessageRow`, which is a lighter row on purpose.

**One reactions element.** `components/forum/reactions.tsx` (`Reactions`) is the only way an item
shows and takes reactions: thread posts, wall posts and comments, the feed and conversation
messages. The number is shown once (on the button, or on the summary when there is nothing to
press), and nothing is drawn for an own item without reactions. Only it and the styleguide import
`ReactionButton` and `ReactionSummary`.

**A reaction refreshes the page it was made on, whichever it is.** The `react` action used to
revalidate the path only when it matched a list of routes (threads, members, conversations); the
home feed was not in it, so a reaction made there fell back to the old state until a reload. The
action now calls `refresh()` and names no path, so a new screen with reactions needs nothing added.
Not tested: whether a page visited earlier can show a stale reaction when the visitor goes back to
it, since `refresh()` does not empty the client's cache of other pages as `revalidatePath` did.

**Duplicated code is measured.** `bun run dupes` runs jscpd (`.jscpd.json`: tests, migrations and
build output left out; five lines and fifty tokens). It finds literal copies only. After the first
pass the count went from 143 clones (1,649 lines) to 102. What was shared: in the staff panel the
screen frame (`ScreenFrame`, `StreamedPanel`), the notice, the criteria fields of awards and
promotions with `criteriaOf`, `RunNow`, the entity form rows and entry lists, the pending submit
button, the staff list and the head of the permission pages; on the public side `LoadMore`,
`FormError`, `FormFooter` and the answer of the two attachment upload routes. Left as they are, on
purpose: the create-or-edit props of each staff form (as many parameters as lines saved), the
toolbar buttons of the editor, the `<output>` status lines (a polite live region, not an alert),
and the staff mobile menu against the site navigation.

## Forum statistics panel as a site setting

**The forum statistics panel is optional and off by default.** The site setting
`forumStatsEnabled` (General settings in the panel) decides whether the forum list shows the
ranked thread lists. It lives in the settings JSON like `profilePostsEnabled`, so there is no
migration and a site that upgrades has it off. `site.get` carries it: the forum list page and its
loading skeleton read it from the cached site, so a guest's page costs no extra request and the
skeleton has the shape of what settles. When the site cannot be read the panel is left out.
`threads.ranked` is not gated: the home feed's sidebar uses it too, and it shows nothing a visitor
cannot already list.

## One version for the whole repository

**`VERSION` at the root is the version of Sermo.** One line, `major.minor.patch`. Every commit on
`main` raises it, by a patch step unless the change calls for more; a task branch raises it once,
in the commit that is merged. The `version` fields of the packages are not maintained; the OpenAPI
document reads the file once at start (its `info.version`), so a missing file stops the server.

## The Upgrade link lives in the account menu

**Upgrade is an entry of the member's own menu, not of the header or the footer.** Migration
`0030` moves the built-in entry `header.upgrade` to the account location as `account.upgrade`
(after whatever the menu already holds, for members; a title, a switched-off state or a permission
audience an administrator set are kept; an audience of guests becomes members, the only people
the menu is drawn for) and deletes `footer.useful.upgrade`. Entries an administrator placed under
it move with it so the rows stay consistent, but the account menu is a flat list and does not draw
the children of an entry that has its own page: they have to be moved by hand. The navigation
shows a guest no link to `/upgrade`; the page itself is unchanged and the shop's rank ladder still
links to it for everyone. The
header no longer marks any entry in the accent colour: that was drawn for this one entry only.
The migration changes the benchmark seed's hash.

## A narrower page, chosen in the browser

**The page width is one CSS variable, switched by an attribute on `<html>`.** `--container-width`
is 1420px; `data-width="narrow"` makes it 1100px inside the forum layout (`data-forum-layout` on
the `(main)` wrapper). The shared `Container` reads it, so the header, the footer and every forum
page narrow together with no condition in any component. The staff panel and the pages outside the
forum layout stay wide: they have no button to undo the choice. The choice lives only in the
visitor's `localStorage`: a cookie or an account setting would have made the root layout depend on
the request for a cosmetic preference. A small script in the document head applies it before the
first paint. The attribute, not the stored value, is what the button reads and toggles, so a
browser that refuses storage still gets a working button for the page it is on; another tab's
change is applied through the `storage` event. There is one narrow width, and the button is hidden
below it, where it could change nothing.

## Reaction pictures and sprite sheets

**A reaction type can carry a picture; its emoji stays required.** The picture is a new catalog
file purpose, `reaction_image`, uploaded with `admin.reactionTypes`. It is stored unscaled, as
lossless WebP from a PNG or WebP upload of at most 2048 pixels a side: a rendition that changed the
pixel geometry would break the frames. Animated input is refused, as for every other picture. The
emoji is what is shown wherever a picture cannot be: with LITE blocking, in notification
sentences and in plain text.

**A sprite sheet is one file plus a frame size and a frame count** (migration `0031`:
`image_file_id`, `frame_width`, `frame_height`, `frame_count` on `reaction_types`). Frames read
left to right, then top to bottom, at most 64 of them. The geometry is checked at write time
against the measured file: the frame size divides the picture and the count fits its cells.
`ReactionType` carries `image` and `frames` (with `columns`, so a client lays the sheet out
without another read). A type whose file row is gone lists without its picture: a public read
does not fail for one broken type. There is one fixed frame duration (100 ms) and no editor;
the animation is CSS only and holds the first frame under `prefers-reduced-motion`.

**Reactions are a LITE category of their own, decided in the data seam.** `lib/sermo/reactions.ts`
drops `image` and `frames` on the server when the category is blocked, so the address never
reaches the browser, and its output is a sealed type: only that output can be handed to
`ReactionPicture`, the one reviewed gate that draws a reaction picture. `Art` could not be used:
it is an async server component and the reaction button is a client component. Every picture is
drawn in the square box the emoji had, whatever the frame's shape.
The migration changes the benchmark seed's hash.

## Icons chosen from a set (forums, navigation entries)

**An icon is stored as a key; the web app owns the set.** Migration `0032` adds `nodes.icon_key`
and `navigation_entries.icon` with `icon_position` (`before` or `after`). The backend checks only
the key's shape (`IconKey` in `contracts/common.ts`: lowercase words joined by hyphens, at most 64
characters), so the set can grow or shrink without a migration; a key the web app does not know
draws the fallback or nothing. A forum's key is separate from its uploaded pictures: the key is
the glyph before the title, the picture stays the card's backdrop.

**One picker, one set** (`apps/web/src/components/icons`). The set is a curated part of lucide,
152 icons, holding every key the forum icons and the navigation already used. `IconPicker` is a
client component that writes a hidden input, so it works inside the server-action forms and knows
nothing about what it is choosing for; it follows its form's reset. Labels are interface text and
live in the messages; the search words stay with the set. The prefix and award forms keep their
free-text keys for now.

**The set never reaches a public page's client bundle.** An entry's chosen icon is drawn on the
server and handed to the client navigation as a rendered element; the client keeps only the few
default icons of the built-in entries. An entry's own icon wins over that default. In the phone
bar the icon stays above the label whatever the position says. A form that does not carry the
icon fields never clears them.
The migration changes the benchmark seed's hash.

## Alerts: conversations, exact landing, the dimmed page

**A new conversation message raises no alert.** Conversations have their own counter. The
delivery stage for `conversation.message` and its configurable type are removed; mentions and
quotes inside a message, and being added to a conversation, still alert. Mail and push were built
from the same notification row that raised the alert and its counter, so they went with it: a
hidden row kept only for the two channels was refused, and delivering them without a row is a
redesign of the channels that has not been done. Old rows of the type stay and still list; a data
migration (`0033`) marks the unread ones read and lowers each counter by its current-epoch rows,
never below zero. An unsubscribe link or a queued mail for the retired type ends quietly.

**Opening a conversation clears its alerts in the same write as its read state.**
`conversations.markRead` marks the caller's unread current-epoch alerts about that conversation
(its own and those about its messages) and lowers the counter by the rows it changed. The page
calls it when the conversation is unread or the member has any unread alert, on whatever page of
messages it opens; with neither there is no write and no refresh.

**An alert's link names its target, and the page finds it.** Posts already carried their page.
A wall post, a wall comment and a conversation message are named in the address (`?post=`,
`?comment=`, `?message=`) and the page walks the existing reads to the page that holds them: at
most ten pages, for signed-in visitors only, reusing the first page on a miss. A backend read
that answers "the page holding this item" would make it one read; it needs a contract change and
was left out. Report alerts open the report in the panel, approval alerts the approval screen, a
follow alert the follower's profile. Announcements and a resolved report have no page of their
own and open the alert list.

**The named element is brought into view and the rest of the page dimmed** (`HashTarget`, once in
the main layout). The dim layer is one fixed element with a large shadow around a hole: it takes
no input and no focus, so the first click both dismisses it and acts. It follows the element
while shown, leaves on any press, key, wheel or touch, on a scroll once the bringing-into-view
has ended, or after four seconds. It runs when the visitor arrives by a link or a typed address,
not on Back, Forward or reload, where the browser restores the position itself. With reduced
motion there is no animated scroll and no fade.
The migration changes the benchmark seed's hash.

## The postbit: the author in a column beside the post

**The author's information is one shared piece, `Postbit`, drawn by `PostFrame` and by the member
card alike (item 8).** From `md` up it is a column of 10rem at the left of the post: avatar, name
and group badges, the viewer's actions on the member (follow, message), title, level and XP bar,
the member's shown awards, then joined, posts and reactions. Below `md` it is a compact header
above the body: the avatar beside the name with the highest group badge (the name keeps at least
12 characters and the line never wraps; further badges show only in the column), the title and
counts under it, and, when there are any, a last line with the awards at the start and Follow and
Message as two 40px icon buttons at the end. The parts are one set of elements in the column's
order, and the compact header places them on a grid, so only the avatar is drawn twice. Known
trade: in the compact header the reading and Tab order (name, actions, title, awards) differs from
what is seen (name, title, awards, actions); the column, where a keyboard is likelier, matches;
fixing the phone order would mean drawing the awards twice or breaking the column's order. Thread
posts and conversation messages both get the block from the one `PostFrame`. `Postbit` knows
nothing about posts and takes its arrangement as a prop, which is how the member card uses it. The
avatar and the name are the links to the profile; there is no profile button.

**A member whose profile the viewer may not open, or one the backend does not return, shows no
facts.** The backend's minimal author carries an epoch date and zero counts; printing them would
state things that are not true. `MemberView` carries `restricted` for this.

The column's width is one variable (`--postbit-width`) used by the grid. The member's cover is
part of the block: behind the column (the whole height of the post, fading down) from `md`, behind
the header strip on a phone. It is drawn against the box that holds the block; the frame says how
wide it is (`--postbit-cover-width`: its padding plus the column, so it ends at the column's
border), and the card leaves it the card's width.

## The conversation page: widgets, adding people, renaming

**A conversation's starter may add people and rename it; nobody else may.** Two operations,
`conversations.addParticipants` and `conversations.rename`, with no new permission, event or
column. Adding needs `conversation.start` and renaming `conversation.reply`: a rename changes what
every participant sees, so it is not a write on the actor's own row. Someone else who can see the
conversation gets Forbidden, someone who cannot NotFound. The rules of creation apply to the
people added (members only, not yourself, not someone who ignores the starter), and
`conversation.maxRecipients` limits the other active participants after the addition. Someone
already in is skipped; someone who left is made active again in the same row, with the read
position they had; a new person starts unread exactly when there is a message they can see. The
conversation keeps its place by last message in their inbox. `conversation.participants_added` is
published for those who became active, so they get the existing alert, again on a re-addition.
`Conversation` carries `canInvite` (with room left under the limit) and `canRename`; the web app
never derives the starter rule itself.

**The page shows the name as its heading and widgets beside it**: information, participants with
"Add people", rename, and "mark as read". One widget set is drawn in the aside from `lg` up and
in a sheet behind a "Details" button below it, where a compact line of participants stays in the
header. Leaving stays a header control.

**Opening a conversation still marks it read; the "mark as read" widget is for when that failed.**
The two requests met here: with the automatic mark, a card shown while the latest message is
unread would flash on every open. So the card is drawn only when the conversation is unread and
the automatic mark was refused, and a refused press says why.

**After the first browser pass (wave 1).** The dim layer's hole is measured into plain numbers: a
`DOMRect`'s fields are prototype getters, so a copy by spread is empty and the layer covered the
whole page. The history guard that keeps Back and Forward from starting the scroll and the
dimming lives outside the component: this Next version hides a page it leaves instead of
unmounting it, which reset a guard kept in the component. The reaction picker wraps onto further
rows and never exceeds the viewport, since staff can now add reaction types beyond what one row
holds on a phone.

## Name icons: a shop item worn on the name

**A name icon is bought, held and worn like a name colour.** The effect is
`{ type: "nameIcon", icon, position }`: an icon key checked by shape (the web app owns the set)
and `before` or `after`. Buying grants nothing, so the purchased-grant rules are not involved; the
item cannot be consumable. A member wears one such item at a time: `users.name_icon_item_id`
(migration `0034`), set through `appearance.set` with the same held check as a colour, inside the
write. Expiry, the last unit, an upgrade and an erase take it off where they take a colour off.
`MemberCard` carries `nameIcon`, read for the whole page in one statement by primary key; a
restricted member's minimal card carries none. A stored effect that no longer parses gives no
icon instead of failing the read.

**One piece draws a name with its icon, on the server.** `NameWithIcon` is used by `UserLink` and
the few places that draw a name themselves, and is marked server-only: the icon set stays out of
every public page's client bundle. With an icon the name truncates in its own span and the icon
stays visible on either side. The header's account menu, notification rows and the client pickers
draw names plain, as they do for the colour.

Left as the colour already behaves: renewing a lapsed timed icon takes it off until it is worn
again; a card can show a lapsed icon until the expiry job runs; staff can take an icon off a
member only by an erase. Six icons ship in the starter shop.
The migration changes the benchmark seed's hash.

## Postbit actions: follow and message beside every post

**One batched read answers for the viewer.** `users.relations` takes up to 50 member ids and says,
for each, whether the viewer follows them, may start following them and may start a conversation
with them. It is kept apart from `users.cards` and `users.authors`, which stay the same for every
viewer. A thread or conversation page (and the rows added while it is open) asks it once for the
authors on the page, in parallel with the authors read, and only for a signed-in viewer; a failed
read removes the buttons and nothing else.

**"May message" follows conversation creation.** It is false without `conversation.start`, for
yourself, when the viewer's recipient limit is 0, and when the member ignores a viewer who can be
ignored, so the button is not offered when sending would be refused for a reason this read can
know. The ignore state therefore shows as "cannot message" for up to 50 members in one request;
creation already revealed it one member at a time.

**Unfollowing needs no permission.** `canFollow` means "may start following"; the control is drawn
when the viewer may follow or already follows, because `users.unfollow` is open to a member who
lost `member.follow`.

**Following from a post does not navigate.** The action ends in `refresh()`, as reactions do: a
redirect would lose the reader's place and replay the scroll to a `#post-N` address. The profile
header keeps its redirecting button.

**One shared piece.** `MemberActions` draws both actions, as two 40px icon buttons on the last line
of the phone header (and in the card's sheet) and labelled in the column, and nothing for a guest,
yourself, or a restricted or unknown member. There is no profile button: the avatar and the name are
the links. A refusal is shown under the buttons without widening the row. The styleguide draws the
same view with an action that stores nothing. Posts and messages show them again from item 8; "One
action bar for every item" no longer says otherwise.

## The member card on hover: the postbit, floating

**The card is the postbit (item 8).** Clicking a member's name, avatar or `@mention` shows the
very block a post draws for that member (same parts, order, cover, awards and actions; the compact
header in the phone sheet and the column in the popover, which switch at the same 48rem as `md`),
with only "View profile" under it. It is rendered on the server when the card opens, so its
pictures obey the Data saver cookie; nothing is read before that. A member who is unknown,
restricted or closed to the viewer gives the name alone. The card is read again on every open and
after a follow made inside it, because content fetched for a card does not follow the page's
refresh. A test renders a thread post and the card for one member and compares the blocks.

**Cards never nest.** A scope set inside `Postbit`, the thread preview, the reaction users list and
the members directory's own card turns every trigger below it into a plain link. So a post's own
postbit opens no card: the information is already there.

**Touch and pen: a tap goes to the profile.** Before, a tap opened the card and blocked the link.
A click never opens a card and always closes one, and a card does not survive leaving the page
and coming back.

**Keyboard.** A name opens its card on keyboard focus, as before. An avatar opens on hover only, so
tabbing through a post does not stop twice per author. A mention opens on mouse hover only: its
card's buttons could not be reached by keyboard, and the mention itself is the link to the
profile. The mention card never moves focus.

**Mentions share one popover.** Post HTML is drawn on the server and is not parsed in the browser;
one delegate around it opens a single card anchored to the hovered mention, with the same loading
and popup pieces as the name trigger.

## Back and Forward on an address with a target: told apart by history entry

The first fix told a traversal from a new arrival with a `popstate` listener. In a browser the
router and the effect run before that event is seen, so Back still scrolled to the post and
dimmed the page. Each history entry has a stable key (`navigation.currentEntry.key`) that survives
the router's `replaceState` and is new for every navigation: the component remembers the key and
hash it has already handled and does nothing on a second visit to the same entry. A new
navigation to the same address is a new entry and is handled again. The `popstate` guard stays
only for browsers without the Navigation API.

In the profile heading a name with an icon wraps (`NameWithIcon` `wrap`); in rows and lists it
still truncates with the icon visible. The conversation details sheet scrolls its body and keeps
its cards at their natural height.

## Member card and history fixes after the wave 3 browser pass

**The card's client parts are registered where a card can open.** A server action that returns UI
can only reference client components that the current route's client reference manifest lists,
and Next lists only those imported by a server module of that route. `member-card-parts.ts` lists
every client component the card can hold and is imported by the server modules that draw card
triggers (`UserLink`, `UserAvatar`, `HtmlContent`), so routes without a member name, such as the
sign-in pages, do not load them. A test walks the card action's imports and fails when a client
part is missing from the list.

**A loading card never blanks the page.** The card's content may wait for its client code; it has
its own loading boundary inside the popup and is installed in a transition, so the page's own
boundaries keep their content and the card does not close under a resting pointer.

**Back and Forward to a target address end where the reader left.** The browser jumps to the
element the address names after restoring the saved position. The position is recorded when a
handled entry with a target is left (a Navigation API `navigate` event, replacements ignored) and
held for up to a second after a traversal, until the reader scrolls, types or touches. Other
entries are left to the browser.

**Same-page hash links go through one component.** This Next version keeps the first load's hash
in the route's address and appends the next hash to it (`#post-45#post-43`). `HashLink` pushes the
current path and query with the new hash when the target is on the page (so selection and cursor
views are kept) and is used for post numbers and the reply link.

## Spanish: a second interface language with no locale in any address

**Pages live under a hidden locale segment.** With `cacheComponents`, a language read from a cookie
or header in the request config would make every page dynamic, and the usual fix is a locale in
the address. The routes live under `app/[locale]` instead, prerendered for `en` and `es`, and the
proxy rewrites each page request to the visitor's language; the address the visitor sees never
changes. A request that names `/en/…` or `/es/…` is sent (307) to the same address without it, so
the segment is never a second address. Upload routes and `favicon.ico` stay outside it at their
public paths. Pages are sent `private, no-store`, so no shared cache mixes languages (the proxy cannot add a `Vary` header: Next's render replaces it).

**Which language.** The cookie `forum_locale`, then the browser's `Accept-Language` (first
supported language by weight), then the site's default language (`site.get` now carries
`defaultLanguage`; the proxy keeps it for 60 seconds and never waits on it after the first read),
then English. A member's saved language (`auth.me` carries it) reaches the proxy through the
cookie: saving preferences sets or clears it, and on a browser whose cookie differs a small client
step writes it through a server action, which also drops the router's cached pages. Guests have no
chooser: they follow their browser. Server actions and route handlers cannot read the segment and
negotiate from the same sources.

**Text.** `messages/es` holds the same 31 files as `messages/en`, which stay the source of the
types. A parity test holds every Spanish message to the English keys, arguments, rich-text tags and
plural/select selectors (as sets, so word order is free). Dates and numbers are formatted in the
active language. Not translated: the backend's own refusal messages shown in forms (English
literals in the backend), the error page drawn outside the layouts, and the styleguide.

Wording (owner's choice): threads and forums are followed, not watched ("Follow thread", "Seguir
tema"); members, threads and forums share the verb and buttons name what they follow. Thread stays
"tema" in Spanish. Group promotions are "promoción" in Spanish; the paid account upgrade keeps
"Mejora".

## XenForo pass: posts, BB code, bookmarks, staff tools, light theme, account screen

Behaviour follows XenForo where the owner asked for it; the look stays Sermo's. Migration `0035`
carries every schema change of the pass.

**Super admin is a column, not a permission.** `users.is_super_admin` is a flag only a super admin
grants or removes (`users.setSuperAdmin`, password required, logged as `user.superAdmin`). A super
admin bypasses the rank hierarchy and the rank ceiling when editing members; nobody else can act on
a super admin. A usable super admin is not erased, not banned and holds `admin.members`, and the
last usable one cannot be removed by any path (`setGroups`, group delete, permission changes,
erasure). The migration marks `lucien`, else the lowest-id member of the Administrator group; the
bootstrap marks the first admin of a fresh site. The owner's "cannot edit groups or sessions" came
from the hierarchy refusing equal rank with no exemption for oneself. Not guarded: automatic group
removals (promotions, shop expiry) and a super admin acting on themselves.

**Conversation messages are edited and deleted like posts.** New permissions
`conversation.editOwn` and `conversation.deleteOwn`; staff use `conversation.moderate`, and only in
conversations they take part in, since moderators never see private conversations otherwise. The
first message cannot be deleted on its own. `conversations.getMessage` returns the source only to a
viewer who may edit the message.

**A locked conversation blocks replies only.** The starter or a holder of `conversation.moderate`
locks it. While locked, authors cannot edit or delete their messages and moderators can; renaming
and adding people still work.

**BB code next to Markdown.** Both render at write time; existing posts are unchanged. Our own
parser with allowlisted colours, fonts, URL schemes and embed providers; unknown tags stay text.
Code is highlighted on the server with highlight.js, the one dependency added: it is the only
synchronous, dependency-free highlighter with the language coverage we need, so rendering stays
before the write transaction. It is loaded with `require` and local types, because its own types
pull the DOM library into the backend typecheck. Highlighting stops at 2,000 characters per block.
Labels ("Code:", "said:", "Spoiler") are not stored: the web supplies them in the reader's language
through CSS variables. `[color=…]` has no contrast guard, as in XenForo.

**Spoilers are absent from the HTML until opened.** Their content is stored apart
(`content_spoilers`) and `spoilers.get` checks that the reader can see the item; moderators may read
those of reported or moderated messages and of the three messages around them. Excerpts, plain
text, SEO and the member card mask them. Texts without per-reader visibility (signatures, static
pages, announcements, notices) keep spoilers inline as `<details>`. Search can match words inside a
spoiler; its snippet stays masked. Spoilers are reveal-on-click, not secrets, so a source read
(profile posts, quotes) may contain them.

**Attachments placed in the text.** Each uploaded file offers "Insert thumbnail" and "Insert full
image"; the request travels as an event on the composer's own form, so several composers on one
page stay apart. Inline files are not repeated in the list under the body; removing a file strips
its tags. Inside a link an inline picture is drawn without its own link. A tag whose file is not on
the item (views that carry no attachments, such as feed cards and moderation) shows a muted
"Attachment" label. The toolbar's code button writes a fenced block, because the Markdown export
escapes `_` and `*` inside `[CODE]`; it is disabled in lists and quotes. Media links become
`[MEDIA=site]` through a table in the web, tested against the backend's resolver. Not done: a tag
inside a spoiler stays a label after the spoiler opens.

**One action bar for every item.** Thread posts, conversation messages, wall posts and comments use
`ContentActions`: who reacted above it; React, Quote, Reply on one side; Bookmark, Share, Edit,
Delete, Report and moderator tools on the other. Follow and Message are not in the action bar: they
belong to the author, so they sit in the postbit of every post and message, as in the member card
(item 8). Share uses the system share sheet where there is one, otherwise a "Copy link" menu, and
shows the link to copy by hand when the clipboard is unavailable; it is the same button everywhere.
Report shows to signed-in members on others' items because these outputs have no `canReport` yet; a
group without `report.create` is refused on sending. Only a thread post's Delete asks for a reason.

**The member card opens on click.** A plain click, tap, Enter or Space on an avatar, name or
mention opens it (popover from 48rem, bottom sheet below); modified clicks navigate. Hover no longer
opens it. Cards never nest (`loadMemberCard` disables triggers inside). A card that cannot load
shows the name and the profile link.

**Bookmarks.** Threads, posts and conversations, no labels or notes. Pages ask `bookmarks.status`
in one batched read instead of an `isBookmarked` field on every output. Removing needs no
visibility, so items one can no longer see can still be cleared; the list skips them and scans at
most 300 rows per request. A bookmark follows thread merges in the list and when set; `status` does
not, so a bookmark made before a merge reads as absent on the target (resolving it on merge needs an
index on the content). The account menu entry is fixed in the web code, because a seeded menu entry
needs a migration. The toggle's label carries its state (no `aria-pressed`).

**Alerts reach their sender and open their link.** The admin alert (`announcements`) goes to
everyone, a group (primary or secondary) or named members, with an optional link. The sender gets it
when in the audience; the old send skipped them, which is why the owner, the only admin, never saw
one. The alert row shows the text and opens the link (external links in a new tab).

**Notices.** Site-wide banners whose audience is a criteria rule (everyone, guests, members, one
group or any other rule; see "One criteria engine" below), with optional start and
end (UTC). Members dismiss per account, guests in the `forum_notices_dismissed` cookie. One
permission, `admin.announcements`, covers alerts and notices. No styles, types or page criteria.

**Settings.** Analytics (Matomo or Google) and the month's exclusions (staff by permission, and
members stored by id so a rename keeps them) live in the settings JSON. The analytics tag is added
from the cached site in the main layout; staff pages are not tracked.

**The light theme is a browser choice.** System, Light or Dark, stored like the page width and
applied by a head script before paint; the server renders dark so a page without scripts is
consistent. XenForo stores the style per account; here the root layout must not depend on the
request. Colours an admin or member picks are drawn as text through an OKLCH lightness clamp
(`.ink`, `--primary-ink`) that keeps their hue and reaches 4.5:1 in both themes; fills keep the
raw colour, and browsers without relative colours get the raw colour. Tests compute contrast from
the tokens and forbid fixed colours in components. The error page drawn outside the layouts stays
dark.

**One account screen.** `/account` holds profile, appearance and links to the other account
screens; `/account/appearance` redirects to `/account#appearance`. Choices save at once, text after
a pause or on leaving the field, with a saving/saved/error state per row and an Undo after clearing.
Removing a picture asks first instead, because the backend deletes the file. The username keeps an
explicit confirmation (rate-limited). Avatar and cover are framed in the browser (drag, zoom, pinch,
keys) and cropped on a canvas to 512x512 or 1600x640, never enlarged; a picture the browser cannot
decode is sent unframed, and framing an animated GIF makes a still picture. The picture route
answers JSON only.

**A dead session cookie does not block public files.** `GET /api/v1/files/<id>` treats a session
cookie that no longer resolves (expired, revoked, a reset database) as a guest, so avatars and
public pictures load; every other route still answers 401, and an invalid API key, bearer token or
`Authorization` header, or a banned member, keeps its refusal. Private files stay 404 for guests.

**The editor leaves BB code as typed.** The Markdown export escapes `*`, `_` and brackets; after it,
escaped BB tags (`[*]`, `[SIZE=5]`, `[URL=…x_y]`) and the raw content of `URL`, `IMG`, `EMAIL`,
`USER`, `MEDIA`, `ICODE`, `PLAIN` and `ATTACH` are restored, except inside code spans and fences.

## October 2026 round

**No stat tiles on the account screen.** `/account` no longer shows messages, reputation,
followers and following; the member's public profile still does. Their skeleton and the four
`account.profile.*Label` keys went with them.

**LITE mode is called Data saver.** Every visible mention reads "Data saver" ("Ahorro de datos"),
including the label drawn where a picture was held back (in the visitor's language, also in the
proxy's placeholder picture). The internal names stay (`lite-*` files, the `forum_lite` cookie,
`LiteState`, message keys), so saved preferences keep working. The pages are `/data-saver` and
`/account/data-saver`; `/lite` and `/account/lite`, with or without a language prefix, answer one
308 to the new address with the query kept. The avatar menu holds one entry that shows On, Off or
Custom and opens the page; the quick switch is gone. Guests reach the same page from a small
settings menu in the header, which replaces "a guest has no link to the Data saver page".

**Remove formatting in the editor.** An eraser button and `Ctrl+\` (also `Cmd+\` on a Mac) clean
the selection, or the whole message when nothing is selected, in one Undo step. It takes off inline
formats, colour, size and font, and turns headings, quotes, lists and alignment back into
paragraphs; with a selection only the touched list items and quote lines leave their list or quote
(a split numbered list keeps its numbers), and a block the selection only reaches at its edge is
left alone. Typed BB code tags are stripped to their text, `[QUOTE]` and `[LIST]` included; links,
mentions, attachments, media, spoilers, images, e-mail, tables, `[PLAIN]` and code blocks stay. The
command is written by hand (Lexical has none). Known limits: a tag pair split by a line break is
left, typed `[CODE]` blocks lose the formatting tags written inside them, and `Ctrl+\` cannot be
typed on layouts where `\` needs AltGr (the button still works).

**Press, slide and release to react.** Holding the reaction button for 450 ms opens the picker;
without lifting, the reaction under the finger grows and shows its name above it, and lifting gives
it (or takes it back). Lifting on the button or near the picker leaves it open for a tap; sliding
more than 48 px away cancels. A quick tap still gives or removes the first reaction. The reaction
under the finger is found by position (`elementFromPoint`), since the button keeps the pointer.
While the picker is open the page does not scroll, select text or show the long-press menu, until
the finger lifts; moving before 450 ms is a scroll. One pointer at a time. Mouse: hover still opens
the picker, and press-drag-release works too. The gesture is a pure state machine
(`reaction-gesture.ts`) with its placement maths (`reaction-placement.ts`: 16 px margins, 40 px
reactions, flips below when there is no room above), used by the one reaction button everywhere.
Not yet checked on real phones; a second finger during a slide can still double a reaction.

**API keys cannot change groups or permissions.** Recorded in "Group, permission and promotion
writes are confirmed with the password" above. The benchmark's guarded scenarios (permission,
group, moderator and promotion writes) now call the operation in-process, so their timings leave
out HTTP and key checks and are not comparable with runs before 0.1.35.

**Moderation writes re-check the moderator inside the write.** Every moderation write named above
reads the actor again inside its transaction and re-runs the lookup it made before (thread, post,
profile post or comment, as now committed), so losing sight of the content gives NotFound, losing
the action permission gives Forbidden, and a ban stops the write. Each has a test where another
connection revokes the permission between the request and the write.

**The OpenAPI document passes Redocly's recommended lint.** `info.version` is `VERSION`, `servers`
is `/`, list query parameters say `style: form, explode: true`, and file, feed and SEO answers have
schemas and the error answers their handlers give. Seven warnings are left on purpose: Better
Auth's callback and username-check entries have no success answer (they redirect), and
`/robots.txt`, `/sitemap.xml`, `/feed.atom` and `/health` have no 4xx path. A test checks the real
upload answer against the documented schema. The Dockerfile copies `VERSION` in its own late layer.

**One criteria engine.** Promotions, automatic awards, notices and shop categories and items all
store a rule `{ match: all | any, conditions }` (column and field `rule`, migration `0036`
converts the old data and aborts on malformed JSON, so run
`SELECT id FROM promotions WHERE NOT json_valid(criteria)` and the same for awards before
deploying). `shared/criteria.ts` is the registry, loads only the facts the rules ask for (one
query per kind) and holds the one decision function, `evaluate`. An empty rule means everyone;
an award with no conditions is manual only, and a promotion needs at least one. Audience criteria
`is_guest`, `is_member`, `in_group`, `not_in_group` were added; guests are in no group, and
`in_group` counts every group a member holds however it was obtained. A promotion may not read a
group that it or any other promotion grants (refused at save), so promotions cannot chain or flip
members back and forth. Gaining or losing a shop group re-evaluates promotions and awards.
Criteria are `cheap` or `background` (`warning_points_below`, a sum over warnings); notices and the
shop take only cheap ones. A shop rule applies to the buyer and to a gift's recipient; an item
hidden by its rule reads as not available, and the rule is shown only to shop managers (award
rules only to award managers). Announcements keep their own audience for now. A notice with an
unknown audience value migrates as inactive. OpenAPI schema names changed (`CriteriaRule`,
`CriterionDefinition`).

**Cookie consent is opt-in, decided on the server.** `vanilla-cookieconsent` 3.1.0 draws the banner
(Accept all, Reject all and Choose with equal weight, nothing pre-ticked, no wall; English and
Spanish). One typed inventory (`lib/consent/inventory.ts`) feeds the banner, the `/cookies` page
and a test that scans every source file for cookie and storage writers, so a new one fails until it
is listed. The server reads the consent cookie (`forum_consent`, six months, carrying the policy
version) and leaves the analytics tag and embedded players out of the first HTML until consent;
players are drawn as a placeholder (Load, Always load embedded content, Open the original) that the
client rebuilds against the same host list as the backend. Withdrawing deletes the category's
cookies on every parent domain; withdrawing analytics or embeds reloads the page. "Always load"
pressed before choosing records a choice with only embeds on. The referral cookie is `forum_ref`
(30 days). The policy version comes from an optional `cookiePolicyVersion` on the site (1 until the
backend sends it). Policy text and lifetimes are drafts. Not checked in a browser yet.

**Polling reads only what is new.** `conversations.listMessages` takes `afterMessageId`, `posts.list`
takes `afterPosition`, and `feed.newCount` (`GET /feed/new-count`, latest or following) counts new
feed items up to 99 with the same filters as `feed.list`, without building them. `posts.list` with
`afterPosition` also returns `afterPostId`, the post the viewer can see at that position: a poller
that gets a different id (or null) reloads the thread, which makes merges exact; splits, edits,
removals and late approvals are not seen by a poll and show on the next reload. Every new query is
one index seek (no migration). One tab's polling (about 29 requests a minute) stays well inside the
read rate limit.

**New threads are written in the wall composer.** One shared composer (`components/forum/composer`)
serves wall posts and new threads: close and Post at the top (Post waits for title and text), a
"Posting in" chip that opens a searchable list of the forums the member can post in, the title as a
borderless line, prefix chips, the shared editor and bottom bar, which stays above the phone
keyboard. Changing forum keeps the draft and replaces the address. `/forums/<id>/new` draws the
composer as a page. The thread draft (title, text, prefix; attachments are dropped) is kept per
member in the tab's session storage and cleared at send; a failed request or a sign-in redirect
during the send loses it. Posting a new thread without JavaScript did not work before and still
does not.

**`/llms.txt` is a backend route beside `robots.txt`.** It is built from the site name and
description and the forums a guest can see (at most 200, grouped by category, notes cut at 200
characters, all site text flattened to one line and escaped), and links the OpenAPI document, the
MCP endpoint, the Atom feed and the sitemap. It is not an operation (no contract, no MCP tool) and
is documented in the OpenAPI document like `robots.txt`. The ingress's `/*.txt` rule reaches it; a
deployment that sends every path to the web app needs a rule for it, as for `robots.txt`. Not
built: `llms-full.txt`, browser tools.

**One rule builder.** Promotions, awards, notices and shop categories and items edit their rule with
one component (`components/staff/rule-builder.tsx`, drawn by `RuleField` for a place). The rule
travels in one JSON field read with the shared `CriteriaRule` schema; conditions are never merged,
and one the builder cannot draw is saved back unchanged. Notices and the shop are offered only
`cheap` criteria. An empty rule reads "Everyone" (awards: manual only; a promotion asks for a
condition). The criteria and the groups a rule may name come from one read, `criteria.list`, open
to holders of admin.promotions, admin.awards, admin.shop or admin.announcements, so each editor
needs only its own place's permission; `promotions.criteria` and `awards.criteria` stay for external
clients. The builder is keyed by place, record and rule, so choosing another record on the same
page never posts the last draft. The limits (20 conditions, numbers up to 1,000,000,000, 500 ids)
are exported by the contract and shown inline. Member, group and shop-item picking is one
`IdPicker`, shared with the conversation recipient picker. A stored rule naming a deleted group is
refused by name until its chip is removed. Known limits: the shop-item picker lists the first 100
items per category (no shop-wide item search yet); new-record forms on list pages keep the last
draft, like their other fields.

**Long lists scroll on one infinite list.** The feed, forum thread lists, conversations, search,
profile posts and threads, bookmarks and notifications draw through `components/forum/infinite-list`
(TanStack Query 5.104.2 and TanStack Virtual 3.14.19, one query provider in the root layout). The
server draws the first page as plain markup and hands it to the query, so nothing is fetched on
mount; later pages come from server actions that use the same page function. The address keeps
`?pages=N`, so Back and a reload return to the same list (the server redraws at most 8 pages, 2 for
search, and stops at the first page it is refused); without script, the "load more" control is a
plain `?cursor=` link. Rows far off screen are unmounted, except one holding focus or typed text;
a player restarts when scrolled back to. A stale cursor or an ended session ends the list quietly.
Replying from the feed returns to the same address (a same-origin path from the Referer, else `/`).
Known cost: a reaction, bookmark or follow refreshes the route, which redraws every restored page:
about 15-18 backend reads per click before, about 31-40 with 8 pages loaded (8-10 such clicks a
minute against the 300-read limit), and a row beyond the 8 redrawn pages shows its old state until
reload. Item 20c replaces the refresh with in-place updates. The members directory, profile wall,
award holders, credits and staff lists still use the older load-more button.

**More member criteria.** A rule's condition carries what its criterion declares: a number
(`value`), a list of ids (`ids`: groups, members, threads, awards, shop items and categories,
credit rules), a look-back window (`days`) and how a list is read (`mode`: one, all combined, each,
none). `criteria.list` gives each criterion's `idKind`, `window` and `modes` (inactive awards only to
award managers); `assertRule` refuses anything else, and ids that do not exist. Criteria live one
area per file under `shared/criteria/`. Facts on the member's row come with the one member query;
the rest are measures, one statement per distinct condition for a page of members, never one per
member, each naming its index and checked with EXPLAIN in a test. `cheap` is the member's row or
one seek per listed id; counts and sums over history are `background`, so notices and the shop
never run them. A criterion names the events that change its fact; promotions and awards check the
affected member at once and otherwise wait for the daily sweep. A pass (sweep or member check)
loads its facts before opening its write transaction, which re-reads what it changes, so the write
lock does not grow with history (bench seed: 1-5 ms for an award chunk, 16-28 ms for a promotion
chunk); a promotion or award edited meanwhile waits for the next pass. Counted criteria count posts
only in visible threads, like `post_count`; a member who never posted does not hold "days since
last post". An award's rule may read awards: giving or taking one checks the member's other awards,
`awards.create` and `update` refuse a rule that makes an award require itself directly or through
others, and `awards.delete` is refused while any stored rule names the award (automatic grants are
final, so `none` and `at most` decide only at grant time). `credits_earned` reads a covering index on
(member, date, type, amount), so a rule that holds it is decided on events like any other.
"Replies on their threads" includes the author's own. Not built: ranking criteria (rankings are
not built), polls and tags (items 9 and 10).

**Reactions, bookmarks, follows and sends update in place; the open screens poll.** A reaction,
bookmark or follow shows at once and is put back if the backend refuses, if the call fails (with a
message) or if the session has ended (the answer says where to sign in); none draws the page again
(a click was 31-40 reads with 8 pages loaded, now one write). The change is kept by key in a store
outside the row, because rows far from the window are unmounted and drawn again from the server's
markup; it shows only while the markup is older than the server's answer to it, so a header drawn
again after "Mark all read" wins. A client component must keep the element it builds from what the
server sent (a test scans for it). An older answer never overwrites a newer change. The stores are
emptied when the page is drawn for another member. A message or reply written on the newest page
of a conversation, or the last page of a thread, shows at the end while it is sent and is replaced
by the server's row; a refusal removes it and keeps the form; a reply saved but not drawn counts as
sent. One polling hook: a conversation every 3 s, the last page of a thread every 10 s (reloaded
when `afterPostId` differs or is null), the feed every 30 s for a "N new posts - show" bar, the
badges every 60 s; it pauses while the tab is hidden, doubles its wait on failures up to 60 s and
stops after 10 minutes without input. A poll starts after the newest row a poll returned, never
after the member's own row. An empty poll is one backend request; one tab asks for at most 21 reads
a minute. "Show" adds every new entry or restarts the list from the newest page, and goes to the
top. Award holders, the credits ledger, the member directory, the rankings and the month's standing
scroll on the shared list. Not converted: profile wall, credits inventory and shop, staff lists,
the conversation's older/newest links. Not checked in a browser: sign-out and sign-in on one tab, a
session ending under a click, "show" with more than a page of new entries.

**Hot replaces Top.** The feed's `top` scope (the week's most reacted-to posts, where a thread could
appear many times) is now `hot`: threads, each shown as its opening post, scored by
`(4*replies + 3*reactions on the opening post + 0.1*views) / (age_hours + 2)^1.2` (named constants in
`rankings.ts`; age from the thread's creation, so a revived old thread does not come back), and
needing 3 replies or 3 reactions on the opening post to be listed. Same rankings job and cadence
(every five minutes), same stored table (kind `hot`); the week scan of posts is gone, and migration
`0037` deletes the old `feedTop` rows. Gravity 1.2 is gentler than a news feed because a forum moves
slower. Views are the raw counter, uncapped, until bots can be excluded. `top` is accepted as an
alias of `hot` in `feed.list` and in the web `?tab=` for one release. The Hot tab does not poll for
new entries. Spanish label "En tendencia". Since item 5 the tab reads "Trending" (Spanish
"Tendencias") everywhere in the interface; the ranking, the `hot` kind and `?tab=hot` keep their
names, and the older entries here (the feature entry at lines 2334-2338, "Home tab per member", the
sorting audit at line 3013) still say Hot for the tab.

**Reactions you unlock.** Each reaction type has a rule (`reaction_types.rule`, the criteria
engine's `{match, conditions}`, cheap criteria only; empty = everyone with `reaction.react`), a
forum list (`forum_ids`: exactly the forums listed, not their subforums; empty = everywhere; a
non-empty list refuses wall posts, comments and messages) and `hide_when_locked` (per type: a
member the rule excludes either sees the type greyed with a padlock and a hint, or does not see it).
Migration `0038` adds the three columns; existing types read as "everyone, everywhere". The check
runs in the write transaction on a fresh row, only for a new reaction or a change to another type:
a reaction already given is kept and counted after access is lost, and removing is never checked.
Measured criteria (thread bans, ban history, awards, owned or worn items, purchases) are refused in
reaction rules so the picker costs at most one statement per page (the viewer's facts), filtered
in memory per item. The hint names number and yes/no criteria ("Unlocks with: Post count: 500 or
more"); anything else, and every group condition, reads "Locked", because group titles are not
public. The alert names the type ("gave your post the Crown reaction"); grouped alerts say "a
reaction". `criteria.list` is open to `admin.reactionTypes` so the reaction form can draw the
builder, and `awards.delete` lists reaction types among an award's readers. Known limits: a
deleted group in a rule leaves the type locked until edited; a held reaction cannot be removed if
the picker offers no type at all.

**Staff picks and paid promotion.** A feature is a row in `thread_features` (migration `0039`):
thread, kind (`staff` or `paid`), who, start, end (null = until unfeatured; paid = 24 hours). A
table rather than thread columns, because a thread can hold a staff pick and a promotion at once and
the reads want one small index over the active rows. A feature counts while its end is null or in
the future, so expiry needs no job. The rankings job deletes features that ended over 30 days ago.
Moderators feature and unfeature with `threads.setFeatured` under the new node permission
`forum.feature` (like `forum.stick`), logged as `thread.feature`, re-checked in the transaction.
It sends no notification to the author. Hot pins at most 10 features (newest first) at the top,
whatever their activity, with the same visibility rules as Hot. The rest of the 50 come from the
ranking, and an older feature appears only where it ranks. Pinning rather than a score boost makes
"shown regardless of the floor" literal and keeps the read to one indexed lookup. Cards in Latest,
Following and Hot show "Featured" or "Promoted" ("Recomendado" and "Promocionado"). The home page
shows a "Featured" card with up to three current features (`threads.featured`). The shop effect
`promote` is a consumable used on one of the buyer's own visible, unlocked, unfeatured threads, like
bump. Credits are taken at purchase, and the unit is spent with the feature row in one transaction,
so a refusal keeps the unit. The starter item costs 1000 credits. Known limits: a moderator cannot
end a paid promotion; an unused unit with a duration can lapse; per-user node moderators made
before this change do not get `forum.feature`; a staff pick on a deleted thread stays until
unfeatured.

**One account menu; Messages and Alerts are header buttons (item 7).** The avatar is for the
account only: it carries no count and opens one menu with the avatar and "Edit", name, title and
Log out on top; two tabs, Account and Bookmarks (XenForo's own pair, labelled with words); and
"Update your status" at the bottom (a post to the member's own wall, shown to members who may post
on profiles). It is a popover on wide screens and a bottom sheet below `md`, and always opens on
Account. A tab loads its list only when opened (TanStack Query). The Account tab draws the site's
account navigation entries and then the account page's own links from one shared list
(`account/links.ts`), plus Data saver and the theme. Messages (envelope) and Alerts (bell) are
separate header buttons beside the avatar. Each shows its unread count as a number (1-99, then
"99+", nothing at 0; one shared `CountBadge`, hidden from screen readers because the button's name
says "N unread") and has its own panel: the latest rows, loaded when the panel opens (TanStack
Query; the list's code comes with the panel), then the footer (View all and New conversation; View
all and Mark all as read). Counts follow the counters poll and the server's redraw after a read.
In the site header the two buttons show from `md` up; below it the phone bar holds Messages and
Alerts with the same numbers and the same envelope. In the staff panel's top bar they show from
`sm` up (below it the section title needs the room, and the logo leads to the site); there the
counts are drawn at page load and do not poll. How the header makes room for them between `md` and
`lg` is in "Unread counts as numbers; Messages and Alerts as header buttons". Conversations has no
"mark all read", because the backend marks one conversation at a time and marking the five listed
would not be "all". Bookmarks shows no count, because bookmarks have no unread state. Known
limits: a status draft is lost on Esc; neighbouring rows in the Account tab's two columns can
start at different offsets, because only some links have icons; a site whose admin removes the
phone bar's Messages and Alerts entries leaves phone members no menu path to those pages (the
pages themselves, alert links and the desktop buttons remain).

**Keyboard shortcuts.** Built on `@tanstack/react-hotkeys`, pinned at exactly 0.12.1 (MIT; it is
pre-1.0, so expect API changes on upgrade). It handles sequences and ignores fields itself, and
adds about 8 KB gzip, loaded once in the main layout for every visitor. `?` opens a help dialog
listing every shortcut; `/` goes to search; `j` and `k` move between thread posts, conversation
messages, feed cards and forum thread rows, stopping at the ends, and start from the window when
the focused item has scrolled away; `r` focuses the reply editor; `c` follows the forum's New
thread link, because the Create button is not built; `g h`, `g n` and `g c` go home, to
notifications and to conversations. `Esc` and `Ctrl+\` stay native and are only listed. Nothing
fires in a field, while a dialog or menu is open, with a modifier held, or for a key something else
has already handled. A key is cancelled only when its shortcut did something, so browser type-ahead
find keeps working. `/` acts only on the real `/` character, not on the key in that position on
Spanish, German or French layouts. Members turn shortcuts off in Preferences
(`users.keyboard_shortcuts`, default on, migration `0040`, carried by `auth.me`); guests have them
on. Known limits: the staff panel and sign-in pages have no shortcuts; on non-Latin layouts letter
keys can still match by position.

**Load only what's needed: a JavaScript budget per page.** `apps/web/scripts/js-budget.ts` reads
the build's per-route client reference manifests and the build manifest, and prints the gzip size
of the client JavaScript each route loads. `js-budgets.json` gives each group of routes a budget:
home, thread, editor, forum, profile, conversations, account, search, auth, staff (shared), the
styleguide, and the rest. `check:web` runs it after the build, and it fails when a route is over
budget, has no budget, or a budget matches no route. Budgets are the measured size plus 10%. The
owner's example of about 150 KB for the thread page is out of reach without a larger rework: React
and Next are 134 KB, and the shared page layout adds about 100 KB. So the budgets guard against
growth rather than meet that target. The measure leaves out the `nomodule` polyfill and misses
about 2% that Next loads on its own, which the headroom covers. Cuts: the thread page's reply
editor loads on focus or first input through the existing `LazyEditor` (thread page 436 to 322
KB). A quote pressed before then goes into the plain field, and the caret lands below it once the
editor arrives. Keyboard shortcuts load after the page through `next/dynamic` (about 8 KB off
every main page). Avatars and pictures in posts load lazily, except the header, profile and
account avatars, which load at once. Fonts were already Latin-only through `next/font`, and there
is no animation library. Known limits: Markdown pictures and the site logo have no stored size, so
they can shift the page as they load.

**IP log, device detection and View IPs (item 8a).** One `ip_log` row (migration `0041`) is
written for every sign-in, registration, failed sign-in on an existing account, thread, post,
conversation start and reply, profile post, comment and report. Each row holds the member, the
address, the action, the content reference, the parsed device and the time. Writes go in the same
transaction as the action; sign-in and registration go through Better Auth hooks, and a logging
failure never fails the sign-in. The address is the trusted `x-sermo-client-ip` that the api
middleware strips and re-sets, not Better Auth's masked session address, normalised with
`ipaddr.js` (IPv4-mapped IPv6 becomes IPv4; IPv6 is grouped by /64 for "members sharing an
address"). This is only safe while the backend is reachable solely through the proxy. Guests'
addresses are never stored. Devices come from `node-device-detector`, parsed once per user agent
behind a bounded cache; the agent is cut to 300 characters. It replaces the web's own parser:
sessions show the stored device. Thread views skip bots with the detector's cheap bot check, not
a full parse. Staff read addresses with the new `member.viewIps` permission (administrators by
default) through `users.ips`, `ips.members` and `ips.content`, on one screen
`/moderation/ips` plus an address line on report and approval pages. The permission follows the
member hierarchy like `users.adminSessions`: a member of equal or higher rank is refused, so an
administrator cannot see a fellow administrator's addresses. `ips.content` answers only for content
the reader may see. Erasing an account deletes its rows. Known limits: the views are not written
to the moderator log; failed sign-in rows keep strangers' addresses under the targeted account,
and nothing is deleted yet (retention, a `created_at` index and the privacy text are item 8b);
`ips.members` can return a short page with more behind it; the detector costs about 90 ms and
57 MB at backend start.

**Anti-spam limits (item 6a).** One flood interval (`floodSeconds`, 0 = off) is shared by threads,
replies, wall posts, wall comments and conversation messages. A held post starts it too. It is
checked inside the write transaction and refused with 429 and the seconds left. Daily caps are
integer permissions: `antispam.postsPerDay`, `threadsPerDay`, `conversationsPerDay` and
`negativeReactionsPerDay`, each a rolling 24 hours. Deleted and held posts count, and a new thread
counts as a thread and a post. Both 0 and -1 mean no limit, because an integer with no entry
resolves to 0 and a strict "0 = none" would lock custom groups out of posting; an admin who types
0 expecting "none" gets unlimited, as the labels say. A cap reads the date of the member's N-th
newest row on the existing `(user_id, id)` indexes for posts and threads. Conversations and
negative reactions get new indexes (migration `0042`), the reactions one partial on `score < 0`.
The reaction cap counts only negative reactions, so positive ones cost nothing. A reaction that
turns negative is deleted and inserted again, so ids keep growing with time for the standings
bisection. Two settings use the criteria engine (cheap criteria only). The links rule is decided
on the rendered HTML and refuses with what is missing ("You need Post count: 3 or more"; a false
yes/no condition reads "Not: …"). The approval rule holds new threads and replies, not edits or
wall posts. `antispam.externalMediaAsLinks` is a restriction nobody holds by default:
administrators get Never, and Never exempts a group. When it applies, outside pictures and players
are stored as links at save time, spoilers included; a staff edit follows the author's permission.
`antispam.bypassFlood` (moderators, administrators), `bypassWordFilter` and `bypassSpamCheck`
(administrators) lift the checks. The staff page is `/admin/settings/antispam`, and
`criteria.list` is open to `admin.settings`. Known limits: a thread split inserts a thread with a
high id and an old date, so `threadsPerDay` can be briefly off; a measured criterion in either rule
runs inside the write lock.

**Criteria that needed an index (item 3m).** Migration `0043` adds:
- `posts.reaction_total`, the sum of `reaction_counts`, backfilled from the stored counts and kept
  in the same transaction that changes the counts (the rebuild job repairs it);
- indexes for reactions given and received by type, for quotes of a member, for a member's
  most-reacted post (partial, posts with reactions), for the credits ledger by member and date, and
  for referrals by referrer and date.

Four criteria use them. Reactions given and received by type take a list of reaction types (modes
all, one, each). The most-reacted post counts every reaction on the post, negative types included,
as the spec sums the counts. Quoted by others counts posts, profile posts and comments, never the
member's own quotes, and only posts in visible threads. All four are refused in reaction rules (10b
refuses measured criteria). The giver of a reaction is re-checked on `reaction.added`. A reaction
now writes three more index entries, two on `reactions` and one on `posts` when the total is above
zero. Folding `reactions_recipient` into the new `(content_user_id, reaction_type_id)` index is
left for the benchmark to justify. Each reaction re-counts the giver's and receiver's reactions of
the listed types for the rules that use them, which grows with a member's reactions.

**Location, sign-in history, last active, new-device alert and retention (item 8b).** Migration
`0044` adds `ip_log.country/region/city`, a partial index for a member's sign-ins, an index on
`ip_log.created_at` and a `session_activity` table (Better Auth's tables are never written).
- *Location.* The api deletes its internal `x-sermo-client-country/-region/-city` headers on every
  request and sets them from Cloudflare's `cf-ipcountry/cf-region/cf-ipcity` only when
  `SERMO_TRUST_LOCATION_HEADERS=true`, a trusted proxy header is configured and was present on that
  request. The proxy header alone is not enough: the shipped compose always sets it, so any visitor
  could forge a country. The shipped Caddyfile drops `CF-*`; a deployment behind Cloudflare removes
  those lines. Without trusted headers an optional MaxMind City database (`SERMO_GEOIP_DATABASE`,
  library `maxmind`, loaded only when the path is set; a missing file stops the start) gives the
  place, looked up once per sign-in.
- *Retention.* `SERMO_IP_LOG_RETENTION_DAYS` (default 180) is deployment config, not a site
  setting. A daily job deletes older rows 200 per transaction. `privacy.logRetention` gives the age
  to `/cookies` and `/privacy`, which say what the log and live sessions keep.
- *Last active.* `resolveActor` notes a session in memory at most once per 5 minutes; the 5-second
  task writes the notes in one transaction, inserted from `auth_session` so a session already gone
  writes nothing. `auth.sessionDevices` returns place and last use; `auth.signInHistory` lists the
  member's own sign-ins (no address) on `/account/security`.
- *Alert.* A sign-in from a browser (name + system) or country not among the member's retained
  successful sign-ins sends the `newDevice` mail. A crawler, empty or unreadable user agent is one
  browser, "unknown", and alerts the first time: a real crawler never signs in, so an exemption
  would only hide an attacker. No alert on the first sign-in or when no country source exists. A
  failing check never costs the sign-in its log row.
- *"This wasn't me".* The mail links to a page with a button (a scanner opening the link changes
  nothing). The token is an HMAC over member, issue time and expiry (7 days) with no table: it is
  spent by `users.sessions_revoked_at >= issuedAt`. `auth.notMe` revokes API keys, marks the cut in
  the transaction that spends the link (so cached session cookies stop at once), deletes sessions,
  marks again and revokes keys again for a key made in between. A failure before the mark leaves
  the link usable.
Known limits: no alert for a member whose sign-ins were all purged; two simultaneous first
sign-ins from a new browser can each send a mail; staff IP views do not show the place; the
MaxMind adapter has not been tried with a real database file.

**Home tab per member (item 14).** Five tabs in a fixed order: Latest, Hot (Trending since item 5),
Following (members only), Forums (the forum list, the same component as `/forums`, which is
unchanged) and Media.
Every tab has a stable `/?tab=` address. With no tab in the address the member's own choice
(`users.home_tab`) applies, else the site setting `homeTab` (ordered `{ rule, tab }` entries of
the shared criteria engine, cheap criteria only, plus a fallback; first match wins; Settings, Home
page). The backend decides: `auth.me` carries the stored choice (`homeTab`) and the decided tab
(`openHomeTab`), so a member's home page makes no extra request; guests are decided by the same
rules (`site.homeTab`, cached with the site, Latest if it cannot be read). Following needs an
account: a rule a guest can meet and the fallback cannot pick it (refused at save), and a guest
asking for `?tab=following` gets Latest, not a sign-in prompt. The bar shows three tabs: the
default plus the first tabs of the fixed order that are not it, drawn in the fixed order, with the
open tab always shown in place of the last non-default one; the rest are in a More menu (not in
the HTML without JavaScript). No per-member pin editing. The wall composer and Featured card show
on the feed tabs only. The `top` alias of `hot` is gone. `media.list` walks the attachments of
posts and wall posts newest first through the new index `attachments_type_id`, at most 400
examined per request (a page can be short and still carry a cursor), with the feed's visibility
checks plus `forum.viewAttachments`; conversation attachments are never listed. Thumbnails load
lazily behind the LITE gate (`LazyArt`); a file with no thumbnail shows an icon. Migration `0045`:
`users.home_tab` and the index. Known gaps: the static LITE category scan does not know `LazyArt`.
Item 5 changed the phone side: below `md` the bar shows every tab of the viewer (Latest, Trending,
Following for members, Forums) with Media in More unless open, whatever the default tab, with
icons and, below 640 px, a label only on the open tab; the wall composer is not drawn below `md`.
From `md` the pinned three-tab bar described above is unchanged.

**Referral links replace "name your referrer" (item 2).** `users.setReferrer` and any way to name a
referrer after registering are gone. A signed-in member's Share/Copy link carries `?ref=<id>` (one
helper in `ShareButton`). The proxy sets `forum_ref` (HttpOnly, Lax, 30 days, first referrer wins)
on a guest's page load with a valid `?ref=` only when the cookie banner's referrals category is
accepted, and removes it when it no longer is. Pages that state a canonical address take it from
the backend, which never carries `ref`. The register action sends the cookie's referrer, else the
form's `?ref=`, in the sign-up body. The backend records it at registration when mail confirmation
is off; with it on, it holds it in `users.pending_referrer` and records it only once the address is
confirmed (the confirmation link, or the next sign-in of a member confirmed another way), within 7
days of registering: signing in with an unconfirmed address records nothing, so made-up addresses
cannot farm referrals. Self, missing, banned, erased and unconfirmed referrers are dropped without
blocking the sign-up or sign-in; a referrer still unconfirmed when the newcomer registers is
dropped for good. Reason: the old call was refused for Unconfirmed members, so the referral was
lost whenever mail confirmation was on. Known limits: without consent only `/register?ref=` credits
the referrer (a `?ref=` on another page is lost at the Register click); accepting the banner on a
`?ref=` page sets the cookie on the next `?ref=` load; the proxy reads consent against the web's
policy version constant until the site carries one (7e-record).

**Permissions, part 1 (item 4a).** New permissions are plain allow flags with built-in defaults; a
hand-made group holds none until set. `site.view` closes every read of the site: forums, threads,
feed, search, profiles, the member pages and awards, spoilers, bookmarks, who reacted, the follow
lists and the files of posts and wall posts. When the Guest group lacks it, the public surfaces
serve nothing either (Atom feeds, sitemaps, `llms.txt`, SEO, IndexNow). A closed-out member keeps
their own card, their conversations and the files in them, and the account pages; writes are not
gated. `member.viewList` covers the member list, the pages of `/members`, the rankings and the
holders of an award (the web leaves those blocks out instead of failing), not every query that
returns members. Integer permissions use -1 as the only unlimited value, so the most permissive
group wins; the rename window is the exception (longest wins, 0 is unset). Own username changes
are recorded in `username_changes` (migration `0047`) in the transaction that takes the unit;
`profile.renameNeedsApproval` refuses with a message to ask staff (no queue). `profilePost.postOwn`
and `profilePost.post` are the own wall and other members' walls; `auth.me` `canPostProfile` is
the own wall. `content.editSilently` leaves `edited_at` alone; revisions are kept, staff see them,
and an author with `forum.viewOwnHistory` sees only their own edits of a post they may still open.
`conversation.alwaysInvite` bypasses the recipient's ignore, not `conversation.receive`.
`attachment.maxFileSize` (bytes) only lowers the site's limit. Known limits: avatar and cover files
stay public; `users.search` stays open (mentions, recipient picker); `watches.list*`, `pages.get`
and `notifications.list` are not gated; email and push still reach closed-out members; spoilers and
who reacted inside a closed-out member's own conversations are refused; admin award pages fail for
a staff group without `member.viewList`; the web does not hide the uploader for a limit of 0.

**Hard delete and batch updates (item 7a).** Deleting for good is a second step after a soft
delete, for administrators (`forum.hardDelete` per forum, `profilePost.hardDelete`): only content
whose own state is `deleted`, 500 posts or comments per call. A thread or wall post stays
`deleted` until a call answers `completed`, and meanwhile cannot be restored or merged (the newest
hard-delete log entry of the target says `completed: false` and no later one says `true`; no
dates are compared). It removes the content with its reactions (the author's reaction score gives
them back), attachments, alerts and the alerts of its reports, bookmarks, reports, quotes and
mentions, and takes back, with ledger rows, the credits its applications still hold; read markers
are clamped to what is left. It keeps the moderator log (title and author included),
`credit_transactions`, `domain_events` (removing the newest events would let later ones take ids
below the subscribers' cursors) and the `ip_log` rows (their pointer is nulled). A purged thread
takes its merge tombstones with it, found through the moderator log. SQLite gives the id of a
deleted newest row to the next insert, so what names the old id is deleted, and readers of kept
rows look only at the row's own life (`created_at`): credit rules (not for a split thread created
held, which carries an old date) and report alerts do. `AUTOINCREMENT` on the content tables is an
owner item and would close the rest. `threads.batchUpdate` applies one change to up to 100 threads
and answers per thread (one transaction, a savepoint each), with the permission of the single
action in each thread's forum; delete, restore and move stop at 250,000 visible posts per batch,
counting only threads that changed. A member's own delete stays a soft delete that moderators can
see and restore; it is not logged (the moderator log counts as moderator actions in the criteria).

**Cookie choice saved on the account, policy version and banner settings (item 7e, part 2).**
The cookie policy version is a site setting (`cookiePolicyVersion`, on `site.get`) that only
"Ask everyone again" (`consent.askAgain`) raises, by one; `settings.update` ignores it. Every
consumer reads it from the site: the banner, `/cookies`, the register action, and the proxy
through the one-minute site facts it already keeps (no request per page; a bump reaches it within
about a minute). A signed-in member's choice (optional categories, policy version, the time of
the choice as the banner recorded it, client-reported and capped at the server's clock) is saved
in `consent_records` (migration `0048`), one row per member, the latest choice, deleted with the
member; `consent.save` refuses a version other than the current. At sign-in, or a registration
that signs in, the account wins: a browser with no current choice, or a different one, takes the
account's (written for the host, marked as coming from the account, followed by a full page load
so the banner reads it), and a browser's choice goes to the account only when the account has
none for the current version. No clock decides. A cookie carrying the account mark is never saved
onto an account: another member's gives way to the member's own record, or is removed so they
are asked. Signing out removes a cookie written from the account. Staff with `admin.members`
over the member see the record read only (`users.consent`). Settings (own screen): Matomo
cookieless (`disableCookies`, not held back for consent, no statistics choice in the banner) and
"banner outside Europe" (default on; off asks only the EU, EEA, UK, Switzerland and unknown
countries, from the trusted proxy country only, so the guest actor carries `clientLocation`). The
site is silent only toward a guest who never answered the banner under any version (they count
as having accepted until they choose); anyone who answered an earlier version, and every
signed-in member, is asked, and nothing optional runs until they answer, so a version bump never
turns a refusal into an acceptance. The prose of `/cookies` is the static page with slug
`cookies`; the inventory table stays generated. Known limits: latest choice only (no history);
withdrawal is not pushed to other devices; sessions opened by the confirmation link do not sync
until the next choice or sign-in; the adopted cookie outlives session expiry, "sign out
everywhere" and account deletion until the next sign-in on that browser.

**Signature limits and Turnstile (item 6b).** Signature limits sit on the anti-spam screen:
characters and lines (source), links, pictures, emoji and text size (measured on the rendered HTML,
so Markdown and BB code count alike; 0 and -1 both mean no limit, as for the daily caps, and a kind
is forbidden by leaving it out of the allowed formatting), the allowed kinds (bold, italic,
underline, strikethrough, code, colour, font, size, heading, link, picture, list, alignment;
anything outside the list is refused at save, never stripped) and a cheap-criteria rule on who may
set one. Quotes, tables, code blocks, spoilers, media, more than one block and a signature that
draws nothing (only whitespace-like, default-ignorable or control characters) are never allowed. A
heading counts as text size 8 minus its level. The forum has no smilies, so the limit counts emoji:
each pictograph on its own (a joined sequence counts every pictograph in it, so a chain of joiners
cannot hide emoji), a flag or keycap once, the copyright and trade mark signs and similar only with
the emoji selector, a character with the text selector only when it is an emoji by default (a face,
a flame: most systems draw those in colour anyway). It is strict on purpose: symbols from U+2190 up
that some systems draw in colour (arrows, card suits, the sun, check marks) count even bare. A
signature kept by a member who no longer holds the rule stays stored and is not shown (one facts
query per page of cards, none for an empty rule); saved signatures are not re-checked until saved
again. Turnstile guards registration, sign-in, password reset requests and resend-confirmation (the
only forms a guest can submit; guests cannot post or report): the token travels in
`x-sermo-turnstile`, the Better Auth before hook verifies it with siteverify (trusted client IP as
`remoteip`, 5 s timeout), requires the action to be the form's own and the host to be one of the
site's (public address, site address, trusted origins; `*.` entries match sub-domains; `www.` is not
folded), and fails closed (400 missing or refused, 503 outage). The secret is write-only in its own
`site_settings` row (plain text, so backups carry it); Turnstile cannot be on without key and
secret. Server-side calls (the admin reset link) and a member's own resend are exempt; a session
does not excuse sign-up or sign-in. Sign-in is off in the default form list, and its checkbox warns,
because a wrong secret locks every guarded form. The widget script loads only on guarded forms, is
listed as strictly necessary in the cookie policy and needs no consent. Known limits: a wrong secret
is only found when a visitor submits; a page loaded before a deploy that added the action needs a
reload; signature pictures skip the external-media rules; the site cache can delay the widget a
minute; the `signatureNeeds` sentence is English in the Spanish interface (backend refusal text is
untranslated everywhere).

**Terms and rules acceptance (item 7c).** The `terms` and `rules` static pages carry a version
(`static_pages.version`, default 1) that an administrator raises on purpose with "Publish as a new
version" when saving (a new page, or a page created again after a delete, starts above every version
accepted under its slug). `terms_acceptances` (migration `0049`) holds one row per member, kind and
version with the time and the trusted client address; sign-up records the versions published then
(the register form's one checkbox names the published ones of terms and rules, and privacy; a page
that cannot be read stops the form rather than being left out), and the prompt's Accept records the
versions the member was shown (a version that moved on is a conflict). Existing members have no
record and are asked on their next visit. A member who has not accepted every published page at its
current version (or later) is refused threads, posts, wall posts and comments (creating and
editing), reactions (set, not remove) and conversations (start, reply, add people, edit a message)
with a `forbidden` error whose issue path is `acceptance`; reading, account pages, sign-out and
accepting stay open. The accepted versions travel with the resolved actor (two indexed subselects in
the existing member lookup); the current versions are one two-row lookup per gated write. API keys
are refused the same writes and cannot accept (session only). `auth.me` lists `pendingAcceptance`;
the (main) layout draws one prompt with a link to each page and an Accept button, and the composers'
and reactions' refusal line redraws the page so the prompt appears. Naming a conversation, and
saving profile text, wait for the acceptance too (clearing a field does not); this deliberately
narrows "account pages stay allowed" to the parts others do not read, and staff edits of another
member's profile stay open; reports stay open because they reach only staff. The daily retention job
drops an acceptance's address at the `ip_log` age and keeps the row; a partial index over the rows
that still hold one keeps that walk short. Staff read a member's versions, dates (newest first) and
(with `member.viewIps`) addresses on the member's details page; erasing the member deletes the rows.
Known limits: the staff panels have no prompt, the register page reads both pages in full to know
which exist, and a sign-up through the API can claim acceptance with `acceptTerms` without having
seen the pages.

**Deleting one's own account (item 7g).** `users.deleteOwnAccount` (`POST /me/delete-account`, `{
password }`) is the member's way out and runs the same function as `users.adminErase`
(`eraseMember`: mark, permanent ban, one `member.erase` log entry, sessions and keys, address and
password, profile, pictures, follows, push devices, consent and acceptance records, IP log, referral
links, then the name `Deleted member <id>`); content, ledger, warnings and log stay. The self path
also bans for good, because every rule about an erased account (no lifting, referrers treat it as
absent, the last-super-admin search skips it) reads the ban. Who may: `profile.deleteAccount`, a
plain allow flag held by every built-in group but Guest (Unconfirmed included, so a mistyped sign-up
address can be abandoned), turned off with a `never`; it is checked before the password and again on
the re-read actor in the first transaction. A session actor only (an API key is refused with the
usual message), with the member's own password under the shared guess limiter (field `password`). A
super admin is refused outright (hand the flag on first), and the last administrator is refused by
the ban step, which rolls everything back. The log entry names the member as actor with the reason
"Deleted by the member". The web puts a danger panel at the end of Security (hidden when the
permission is not held; the backend still decides) with the username typed out and the password,
signs the browser out and lands on the home page with a one-line notice. Known limits: a run
interrupted after the first transaction is logged as `[users.eraseInterrupted]` with the member id
and step and can only be finished by an administrator through the API with `users.adminErase` (the
member's sessions are gone and the panel draws no erase form for an erased member); the web cannot
tell a super admin or the last administrator beforehand, so it shows the panel and relays the
refusal.

**Warning types and automatic actions (item 7f).** Migration `0050`. Warning types (managed with
admin.settings; a name in en and es, default points, expiry in days or never, default reason, a lock
on points and expiry) replace the single threshold-ban settings
(`warningBanThreshold`/`warningBanDays` are gone). Automatic actions (ban, add a secondary group, or
an existing restriction, for N days or permanently) fire in the warning's transaction when active
points reach their threshold, once per crossing (`warning_action_fires`); they re-arm when points
fall below it, noticed at the next warning and by an hourly sweep. Falling below, or the end of the
time, takes back only timed group memberships the action itself added; bans, restrictions, permanent
memberships and ones the member already had stay. A refused action (last administrator, a group that
came to decide admin.permissions) refuses the warning; `member.immuneToAutoBan` skips all actions. A
group an action adds is refused by `groups.delete` and by an `admin.permissions` entry. Deleting a
type keeps its warnings as custom ones. A locked type refuses a different points value or any expiry
from the moderator; the reason stays free. Configuring an action that adds a group needs what
`users.setGroups` needs (admin.members, the actor's own password, session only) on top of
admin.settings, and a rank above the group's, also to change or delete it; ban and restriction
actions need only admin.settings. Rank is enforced at configuration time only: when an action fires
the system acts, whoever warns, and the `permissions.set` / `groups.delete` guards keep the group
from gaining admin permissions. A warning given with `notify: false` adds and removes the group
silently. `users.setGroups` keeps the rows of the groups that stay, so a timed group survives an
unrelated edit. System removals of a group leave no moderator-log entry (the log needs an acting
member); the event names the action, and no "removed" event is published for a group the member
still holds another way. Deleting an action or type marks it gone in one transaction (it stops
firing, listing and being picked) and a job does the member-facing cleanup in bounded batches,
resumable from the rows; an action with nothing to take back is deleted at once with its fires by
cascade. An unrelated `users.setGroups` save keeps a timed action group timed; ticking it again does
not make it permanent (remove, save, add, save does).  Known limits: a cleanup job that fails five
times leaves a hidden row marked gone (its group cannot be deleted until the job is queued again by
hand); the production batch sizes are not pinned by a test.

**Popups on demand, only the text the browser reads (item 30).** Menus, popovers, sheets and
tooltips no longer ship with the page: the user menu, the search panel, the guest options menu, the
header headings, the phone menu, the member card (names, avatars and mentions) and the postbit
tooltips draw a plain trigger with the attributes Base UI would give it (a test renders each plain
trigger and the real one from the same props and compares them), fetch the real component on the
first pointer, touch or focus, and mount it already open on the click, key or (for tooltips) 600 ms
of rest that asked for it, so one gesture is enough (`components/ui/lazy-popup.tsx`, behaviour in
`lazy-popup-controller.ts`). A press that arrives before the code shows the trigger as busy and is
withdrawn by a second press, Escape or a press elsewhere; only one press of a kind waits at a time.
A menu asked for with a key mounts closed and has the key replayed on its real trigger (once), so
Base UI focuses the first item as it does on every later use; a sheet opened by touch takes focus
itself. A fetch is tried twice; then the page is reloaded once per address per session (never
offline), and after that a notice tells the visitor to reload it by hand (the mark is cleared
whenever a popup's code does load, so a passing network failure does not use it up) (a member name
or mention goes to its profile instead). The root provider now sends only the `zone.component`
namespaces that client components read (`i18n/client-messages.ts`; a test walks the client module
graph and fails both when one is missing and when one is stale): English goes from 188 KB to 55 KB
in every page's data. The analytics provider's own script loads at `lazyOnload` while its inline
settings stay queued first, naming the first page's address and title, and later client navigations
are pushed on whatever `window._paq` is then. The counters poll does not use React Query; after this
change the provider in the root layout is the layout's only static edge to it. First loads after the
change (KiB, before -> after): home 325.9 -> 311.3, thread 322.6 -> 288.3, editor 418.6 -> 375.3,
forum 323.6 -> 288.1, profile 322.9 -> 307.6, conversations 313.1 -> 277.6, account 307.9 -> 247.8,
search 317.7 -> 277.0, staff 313.7 -> 278.5, other 318.9 -> 296.4; the budget ceilings were lowered
to 3% above them.  Known limits: finished-string props would not take the ICU parser out of the
layout, because the phone bar and the avatar button format live unread counts; visits that end
before the page has loaded are not counted by the analytics provider; the swap and the replay have
not been seen in a browser.

**The public API reference (item 31).** `/developer` is a public, indexable page that draws the
existing `/api/v1/openapi.json` with Swagger UI (`swagger-ui-dist`, exact pin), served from the
site: a lazy chunk fetched after hydration on this page only (about 430 KB gzipped, against about
1.4 MB for Scalar and 25 packages plus Vue), no CDN script or font, and no third-party request (the
validator is off; Scalar names four hosts of its own). Swagger UI's built-in dark look follows the
site's `dark` class; its palette is not the site's tokens. The whole spec is shown, staff operations
included, marked by what they need and answering 401, 403 or 404 to others. "Try it out" sends real
requests (the intro says so) and runs as the visitor (same origin, the session cookie the browser
already holds) or with an API key pasted into Authorize, which the library keeps in memory only (no
persistence, no address fragment). The page reads the spec without cookies, points the server at its
own origin, hides the cookie schemes (a browser cannot set a cookie by hand) and adds the JSON
content type to bodyless writes, which the API demands of cookie writes. The intro, in English and
Spanish, says how to sign in, that a key is created with the sign-in service while signed in and
needs the password, what a key cannot do (DECISIONS "API keys are credentials"), and how the API
refuses; it states no limit numbers. The page's first load has its own budget group (231000 bytes;
218.8 KiB measured). Known limits: Swagger UI's labels are English, the web has no API keys page to
link from, and non-`/api` operations of the spec work only behind the ingress.

**BB code is the only text format (item 5b, plan B).** Posts, messages, wall posts, comments,
signatures, announcements, notices and static pages are BB code (XenForo's tags plus `[hr]`);
Markdown is dropped and typed Markdown or HTML stays literal text. Outside tags only bare
http(s)/www addresses and `@mentions` are recognised (hashtags come later). No admin-defined BB
codes. The renderer is our own linear scanner (tag lexer, one pairing stack, explicit-stack tree
builder; unknown, malformed or unpaired tags stay text) and `marked` is gone: it took 650-880 ms on
10,000 characters of unclosed emphasis, which no cap on the Markdown side fixed cleanly, and the
remark alternative needed seven work caps to stay under the budget. A message whose reading (parse,
HTML, sanitize; not the database lookups) takes over 50 ms is refused with a ValidationError ("This
message is too complex"); the deadline is checked every 64 steps and is the safety net, while the
adversarial suite (about 340 inputs of 10,000 characters) stays under 12 ms p95 without it. The
bound is made less brittle instead of raised: the renderer is warmed up once per process when a
context is created, and a render that trips the bound is tried once more before the message is
refused. Nesting limits are unchanged (10 quotes, 10 spoilers, 30 in all). A message embeds at most
50 `[MEDIA]` players; later ones are links to the provider's page. A quote of a post is
`[QUOTE="Name, post: N, member: M"]`, resolved and attributed when saved as `:::quote{post=N}` was.
Code highlighting is capped (4,000 characters and 20 blocks per message, no line over 200
characters) because highlight.js cost grows steeply with line length. `[URL=/path]` may name a page
of the site. The signature line limit counts lines as drawn (breaks, paragraphs, list items,
headings, aligned blocks), because BB code puts a list on one source line; the other signature
limits still measure the rendered HTML. Excerpts are cut with the renderer's own tokens (`arr[i]`
stays, pictures and attachments leave nothing). The search index reads `post_bodies.body_text`
(migration `0051`), a post's text without its tags written at save: NULL means not computed (the
index reads the source), the empty string means a post with no text (a picture only), so tag names
and quote attributions are not searchable words; every writer of `post_bodies` must set it. There is
no conversion: old posts keep their stored HTML and are indexed by their source until they are
edited.

**Permissions, part 2 (item 4b).** Own content: `forum.deleteOwn` and `forum.deleteOwnThread` hide;
`forum.hardDeleteOwn` deletes for good in one step, refused for a locked thread, content staff hid,
reported content, a post a warning was given about, a thread with other members' posts or over 500
posts, and never taken by someone holding `forum.hardDelete` (they follow the two-step staff rule);
`forum.lockOwn` locks, and the author unlocks only a lock whose newest event names no staff member
(who locked is read from the thread's lock events; a staff lock or relock makes it staff's). Own
locks, unlocks and deletes are not moderator actions and are not in `moderator_log`. All three are
Administrator-only by default. `forum.viewOthers` and `forum.viewContent` are `defaultAllow` flags
(granted unless a group says never; a `no` does not restrict) that close a forum's other-member
threads, or its posts (titles only), on every path including quotes; a member's own work stays
readable and a hand-made group keeps reading. `forum.react` gates reactions per forum. Moderation:
`warning.delete` (`warnings.delete`/`expire`, with `reconcileWarningActions`), `warning.maxPoints`
(10 when unset), `warning.perDay` (20 when unset, counted from the log), `member.banMaxDays` (30
when unset; an explicit 0 means none) and `member.editProfile`. Moderators hold `member.ban` by
default (migration 0052 seeds it), bounded to 30 days; `bans.lift` takes the same reach (a longer or
permanent ban, or one a higher-ranked member set, is not theirs to lift), and a warning a
higher-ranked member gave is not deleted or ended from below; a deleted warning no longer holds its
post; spam cleanup's permanent ban is a separate permission. **`forum.warn`**: a warning that names
a post (`postId`) needs `forum.warn` in that post's forum instead of `member.warn`; a warning
without a post needs `member.warn` over the member, wherever the member posts. So `never` on
`forum.warn` stops only warnings about a forum's posts; with `member.warn` a moderator can still
warn the same member without `postId`. It is not a "warn per forum" limit on moderators who keep
`member.warn`. Moderators holding `member.ban` also list all bans (`bans.list`), as they read the
moderator log. Admin: `admin.prefixes`, `admin.navigation`, `admin.pages`. Known limits: no
moderator screen for warn-from-post or profile edit (the member pages need `admin.members`); ranked
lists leave out whole forums where others' threads are closed.

**Installable forum and a first service worker (item 32).** The web app serves a manifest
(`app/manifest.ts`: site name, description and first accent, the uploaded icon or a default mark)
and a small Serwist worker, a build artifact (`public/sw.js`, bundled by `scripts/build-sw.ts`
before `next build`, served at `/sw.js`) because a route that bundles at request time is dynamic
under `cacheComponents` and the image holds no source. The worker never keeps anything that belongs
to a visitor: it holds the immutable files of `/_next/static/` (content-named, cache-first, no
pictures, which the data saver decides) and the offline page (precached, shown only when a page load
fails on the network); pages, `/api`, files, uploads and every non-GET request are left to the
browser, and it asks for no navigation preload. There is no push, no background sync and no offline
reading (owner, 2026-10-15: "por ahora sin notificaciones, algo sencillo"). An update takes over at
once (`skipWaiting`, `clientsClaim`), which is safe because the worker holds no page; the browser
checks the script on every visit and the worker drops older `sermo-*` caches when it activates (a
bump of `STATIC_CACHE` also costs an open old-deploy tab its cached lazy chunks, so it is only for a
change in how files are kept). Serwist's default precache of every build file was rejected for the
data saver's sake, and `SerwistProvider` for its `history` patching and reload on `online`;
registration is a small component that runs after load, when idle, in production, on secure origins.
Its Cache Storage and IndexedDB database are listed on the cookie policy page as strictly necessary
device storage (own public files only, no account data, no identifier, the site works without them).
To retire the worker, deploy a build with `SERMO_RETIRE_WORKER=1`: its `sw.js` deletes what the
worker kept (waiting for the database delete) and unregisters itself even when that cleanup fails,
and that build registers nothing, so devices without the worker do not install it on every visit;
keep it deployed a month, then remove the registration and the worker's files. Default icons are PNG
bytes in code because `public/` holds no pictures; LITE mode cannot hide the manifest's icons from
the install flow because a browser fetches them without cookies, so that gate only answers requests
that carry the cookie.

**The web editor reads and writes BB code (item 5b, step 2).** The rich editor (Lexical) holds BB
code as bold, italic, underline, strikethrough, inline code, links, headings 1-3, plain quotes,
lists (nested too) and code blocks, and writes them back as BB code with tags that always nest;
every other tag (colour, font, size, alignment, spoilers, tables, media, attachments, quotes of a
post, unpaired or misplaced tags) is plain text in the rich view and is written back exactly as
typed, so nothing is dropped or escaped, and a member who wants a literal tag uses `[PLAIN]`. A `[
]` button switches to a textarea with the BB code and back; what is sent is always BB code, and text
the member did not touch is sent as it was given. Typed Markdown is text (no shortcuts). Pasted rich
text is converted to BB code (bold, italic, underline, strike, http(s) links, lists, quotes,
headings, `[IMG]` for http(s) pictures, the rest as text); pasted plain text is taken as typed. The
quote button writes `[QUOTE="Name, post: N, member: M"]...[/QUOTE]`, with the unpaired QUOTE tags of
the quoted body wrapped in `[PLAIN]`. The edit pages and the new conversation page load Lexical on
first focus like the reply box. `@lexical/markdown`, `react-markdown` and remark are not used any
more (the client Markdown renderers only served the styleguide); LITE filters `[IMG]` in BB code
that goes into an editor and the stored HTML of bodies. Code that shows its own closing tag
(`[CODE]x[/CODE]` as a sample) is written as `[CODE=rich][PLAIN]...[/PLAIN][/CODE]` (inline:
`[ICODE=rich]`; a `[/PLAIN]` in the text is cut in two PLAIN tags that follow each other), which the
renderer draws as a code block of exactly that text (its language is not kept in that case), and the
editor reads that form back as code. Remove formatting keeps a quote that has an attribution. On the
edit pages the first focus carries the caret and selection of the plain box to the editor, counted
in characters of the text the editor shows (the editor's own reading of the text before the caret,
so the tags it shows as text count). The `editor` first-load group fell from 375.3 KB to 270.5 KB
(ceiling 286000). Known limit: a numbered list always starts at 1.

**Hashtags and tags (item 9).** `#tag` in posts, thread opening posts and conversation messages
(text runs only, recognised by the BB code tree builder like mentions) is a tag: letters, marks,
numbers and `_`, starting with a letter, number or `_`, one letter that draws something, up to 50,
not after a letter, number, `&`, `/`, `=` or `#`. A name is one key for everyone (`foldTagText`,
shared by the backend and the web): NFC and lowercase, a Greek final sigma folded, characters that
draw nothing taken out, so look-alikes are one tag. A thread's tags are the ones its author or staff
list (`tags` on `threads.create` and `threads.update`, at most 10) plus the hashtags of its opening
post outside spoilers and quotes (an edit re-syncs only those); replies and conversations only link
to tags that are known and never create or attach. Putting tags on needs `tag.apply` (or
`tag.manage` without a posting restriction); taking them off needs only authorship or staff, so a
muted author or moderator can still remove; a posting restriction takes `tag.apply` and `tag.create`
away. A tag is known to a writer only if it has a visible thread they can read or own (deleted, held
and unreadable threads do not count), so neither a link nor a refusal tells them about content they
cannot see. `tag.create` makes a tag nobody used, `tag.manage` renames, merges and deletes
(`/admin/tags`, checked again in the transaction); a rename or merge keeps the old name as an alias,
and a tag with aliases is kept when it loses its last thread; its empty page is shown only to
holders of `tag.manage` (to others it is a 404, since its names may come from a closed forum whose
threads are gone). The tag page (`tags.threads`, `/tags/<name>`) lists threads by activity from
index runs that separate visible, held, deleted and own held threads (2,048 entries per run per
request, then it resumes), is a 404 only when every run was read to its end without a thread for the
viewer, does not show a tag the opening post's text gave to a viewer who may not read that text, and
merging threads moves their tags. It is indexable, and in the sitemap, only with 3 or more threads
whose title and text are open to guests. The criterion `tags_added_at_least` reads
`users.tag_count`, which counts tags of visible threads, kept by triggers on `thread_tags` and
`threads` (as are `tags.thread_count` and the copies `sort_at`, `vis`, `node_id`; migration `0053`).
Known limits: posts written before the item stay as they were until edited; a held edit tags nothing
and its new hashtags stay dead links until the next edit; ignored members' threads are listed on the
tag page as in the forum list; past 2,048 closed entries a run is best effort (the page may be empty
with a link to go on, the sitemap and SEO count see nothing past it).

**Sign-up approval queue and batch update members (item 7h).** Migration (`signup_queue`):
`users.signup_review` (`pending` or `flagged`, set at sign-up while `approveSignups` is on); a
partial index `users_signup_review` on `id WHERE signup_review IS NOT NULL AND group_id <> 5` (the
same text as `AWAITING_SQL`); and a partial index `notifications_signup_alert` on `id WHERE type =
'moderator.signup' AND read_at IS NULL`, through which the standing alert is cleared. An account
awaits approval once it is marked and has left Unconfirmed, so confirmation comes first. A waiting
account is one flag on the principal: the permission engine resolves it as a Guest whatever groups
it holds (promotions and hand-given groups cannot widen it, and a target that waits is ranked by the
groups it really holds), a permission that needs an account is refused with `forbidden` and issue
path `approval`, and `execute()` refuses every write that is not `public` (a test runs them all, so
a new write operation is covered by default); the upload route is guarded the same way. The one
thing it keeps is leaving: `profile.deleteAccount` and `users.deleteOwnAccount` work for it. Waiting
accounts are left out of search, member lists and others' profile pages (privacy `self`).
Spam-flagged sign-ups, refused while the queue is off, wait marked and are never approved by
themselves. `member.approveRegistrations` (Moderator, Administrator) opens `signups.list` (email
masked unless `admin.members` over the account) and `signups.decide`: approve; reject by **ban**
(the default; the actor's own ban: `member.ban`, length bounded by `member.banMaxDays` like
`bans.create`; for good closes the account, for a time keeps it held and out of the queue until it
ends, when a job returns it with an alert) or by **erasure** (a choice: `admin.members` over the
account, the `users.adminErase` erasure, the actor's password); a ban keeps the sign-up address and
terms record the queue uses against spam waves. An erasure that stops part way leaves the account in
the queue, marked, refuses approval and ban, and is finished by deciding again by erasure; the
rejection mail is queued once, by the transaction that marks the account, and the job drops the
address on every way out; a second decider on an account being erased gets a conflict. One
`signup.approve` or `signup.reject` log entry each; en/es mail in the language stored at sign-up. A
bounded `pendingSignups` counter, and one standing `moderator.signup` alert per staff member that
lists the newest newcomers and follows the queue: events at every place membership changes
(decision, ban, lift, erasure, self-deletion) and one job per timed ban rather than a sweep. Batch
update members is two steps: `users.batchPreview` chooses by a criteria rule (the one engine, only
criteria cheap to check in a request, at most 10,000 members looked at, resumable) or a list and
returns ids; `users.batchUpdate` acts on exactly those ids (group, title, avatar, signature, ban,
lift, erase, up to 100), each through the single action's helper, transaction and log entry, so
ranks, permissions, ban length and stale actors are the single action's; members the actor may not
touch, super admins and the actor are skipped and reported; an unfinished erasure is finished by
erasing again. Known limits: credits for registering and referrals are paid before approval; the
erasure lock is per process.

**Media tab viewer (item 17).** The Media tab shows large 4:3 picture cards (one column on a phone,
up to three on a desktop) from the 320 px thumbnail behind the Data saver gate, and a lazily loaded
full-screen viewer (Base UI dialog, no library) whose state is the address
(`?picture=post-<postId>-<fileId>` or `wall-<wallPostId>-<fileId>`): opening pushes one history
entry, stepping replaces it, so Back or Esc closes and a link opens it. The list tells the viewer
only which pictures it drew (no URLs when post pictures are blocked: the address of a picture is a
`GatedUrl | null` made on the server); who posted it, where, the reaction control and the reply or
comment box are asked for when a picture is shown, through `posts.get` / `profilePosts.get`,
`threads.get` (no view counted) and the reaction types, so the grid makes no extra request and
`media.list` is unchanged. Reacting, replying and commenting are the page's own actions and
components (`ReactionsView`, split out of `Reactions`; `LineComposer`; `replyFromFeed`;
`commentOnWallPost`). Known limits: a pasted `?picture=` link opens the picture with no arrows
(stepping covers only the pictures the list has loaded and mounted, and stops at the last of them);
a typed reply is lost on Esc, Back or a step to another picture; the viewer's history mark
(`history.state.sermoPicture`) is lost if Next rewrites the entry (the list's `?pages=` update), and
closing then replaces the address in place instead of going back; no confirmation shows after a
reply other than the page redraw.

**Polls and quizzes (item 10).** A thread carries at most one poll (one question) or quiz (a
series), written with the thread (`poll` of `threads.create`) or added by its author while it is
unlocked or by staff with `poll.manage`. Texts are one line of BB code read for its words, under the
rules a post is under (the word filter; a text a filter holds for approval, or a link from a new
member where the site holds those, is refused: with a new thread it holds the thread), the forum's
posting rules, the terms, the flood interval and the daily limit; a member whose own posts are held
for approval, or who is banned from the thread, adds no poll or answer. Voters may add one answer
each (`poll.addAnswer`). Questions and answers may carry a picture, an attachment of content type
`poll` read under the thread's rules and drawn through the data saver's gate; the browser is given
file ids only, never an address. A poll is single or multiple choice, may close by date or by hand
(a poll a moderator closed is reopened by a moderator), allow or refuse a change of vote, and show
results always, after the viewer's vote or after it closes (a closed poll shows them to all; creator
and staff always see them); voters are public or anonymous, fixed at creation, and an anonymous poll
never lists voters to anyone, nor does the moderator log or the event log (`poll.voted` names a
member and no poll). A quiz is taken one question at a time, an answer is final and brings the right
answer and explanation of that question only (`polls.get` never carries them before; editors read
`polls.definition`), the score is kept per member, and its structure freezes once someone has taken
it. Permissions `poll.create`, `vote`, `addAnswer`, `closeOwn`, `closeAny`, `viewVoters`, `manage`
(per forum); voting needs a visible thread whose posts the viewer may read (a locked thread still
takes votes). Votes are replaced inside `writeTx` with the actor re-read; `poll_answers.vote_count`,
`polls.ballot_count` and `users.poll_vote_count` (the criterion `polls_voted_at_least`, not revoked
at once when a poll is deleted) are kept by triggers (migration 0055, which also appends the
question text to the opening post's search entry). Editing replaces the whole definition and carries
the version it started from (`loadedAt`): a stale editor is refused with a conflict that names it,
an edit with no version never removes an answer a voter added, and the web keeps what was typed (and
merges the answers and questions added meanwhile, drops what was removed) when it loads what
changed. Votes and ballots are never removed in one big transaction: one transaction removes at most
2,000 voters, so deleting a poll with more hides it at once (`max_choices = 0`) and queues one
background job per poll (`polls.purge`, unique key, one batch per write transaction) that removes
the voters and then the poll; a hard delete of its thread queues the same job and waits for it.
Merging moves the poll to a target without one (else it stays on the merged-away thread and goes
with it); hard delete removes it; erasure keeps votes, and a public voter list shows them as
`Deleted member <id>`. The poll block is drawn above the opening post on page 1 (a product call).
Known limits: no feed badge; pictures carry an empty alt text; a text others reworded meanwhile is
overwritten by a stale editor's own; editing the texts of a poll is not held for a member on
probation.

**Feed filters (item 13).** Migration 0056 (`feed_filters`): tables `feed_filters` (saved filters)
and `feed_hidden_nodes` (forums a member hid), and partial indexes `threads_prefix_feed`,
`threads_sticky_feed`, `threads_locked_feed`. `feed.list` and `feed.newCount` take `forumIds` (a
forum and what is under it, at most 20 named), `prefixId`, `type` (featured, sticky, locked), `tag`,
`watched` and `unread`, in every scope. The fields combine, nothing widens what the viewer may read
(every walk's candidates pass the usual forum, read-gate, state and ignore checks, and a tag given
by the opening post's hashtags is closed to a viewer who may not read that text), and with a field
on only threads are listed (wall posts have no forum; with no field on, wall posts stay even when
every forum is hidden or left out). The walk is chosen by what the filter needs: the tag page's
`thread_tags_hub` for a tag (ordered like that page, so a bumped thread rises above newer posts; the
new-posts count compares post times and can miss entries below a bumped thread until a newer post
passes it), the member's 500 most recent watches for `watched` on Latest (the other tabs check every
watch), the active features (newest 200) for `featured`, one `threads_node_feed` seek per forum when
forums are named (up to 64 forums; the widest case measured is 54 forums, about 11 ms of SQL for ten
batches), otherwise the new `threads_prefix_feed`, the partial `threads_sticky_feed` and
`threads_locked_feed` for a prefix, pinned or locked filter, otherwise `threads_public_feed`; the
forums the site and the member leave out are dropped from what a walk finds, never chosen as a walk.
Unread is one `thread_reads` probe per batch inside the 30-day window, and every field no index
orders is checked per batch by thread id. "People I follow" is the Following tab (one entry per
answer by a followed member). Members save up to 10 named filters (`feed_filters`; the same name
replaces) and hide up to 100 forums from their own feed (`feed_hidden_nodes`, a forum and what is
under it; a filter that names a forum lists it again); admins leave forums out of the feed for
everyone (`feedExcludedForumIds`, never listed, even when named, and also out of the home Featured
block and the sidebar's ranked lists, which ask `threads.ranked` with `feed`). Migration `00xx`. The
web has a lazy Filters sheet, chips, an eye toggle per forum and a hide button on every thread card,
and the admin list on Settings > Home page; the infinite list follows at most two empty pages in a
row by itself, then waits for the button, with a line saying nothing was found yet in what was
looked at. Sorting labels were audited: the feed summary no longer says Hot is newest first, and the
sidebar's "Latest threads" is the newest threads by creation (it showed last activity). Known
limits: a request examines at most 400 candidates per side, so a named category of more than 64
forums, a forum with a rare prefix, type or unread, or a quiet subtree can return short or empty
pages that carry a cursor; `watched` on Latest is 500 watches; scrolled-to pages keep a hidden
forum's cards until reload; hiding has no undo; tabs drop the filter; filtered addresses are
indexable; account erasure keeps saved filter names; `thread type` has no poll value until item 10
lands.

**SEO for the home tabs (item 18).** Each tab has its own title, description, canonical and robots
in the page language, built from the site name; the bare address is the canonical of the tab guests
open on, other tabs canonicalise to `/?tab=x`, and only the plain address of a public tab is
indexed: every address with a cursor, `pages`, a feed filter, a picture, a section or any other key,
and every address whose tab the page did not open, is `noindex, follow` and points at its tab (as
`copyOf` does), which closes the known limit that filtered feed addresses were indexable. Tracking
parameters (`utm_*`, `fbclid`, `gclid`, `ref`) do not make a copy. Following is never indexed. The
owner's site description speaks for the home address; the other tabs use fixed translated text. No
hreflang (no locale in addresses) and no sitemap change (the sitemap lists no home address). Known
limits: the Forums tab duplicates `/forums`; no social card. The head of the home page is now
request-time: it reads the search params and the viewer, so it is streamed with the page instead of
being part of the prerendered shell.

**One Create button (item 16).** A "Create" button in the header (from `md`) and a round + in the
middle of the phone bottom bar open one dialog that asks what to write: discussion, question, poll
or quiz, or a wall post. Threads then pick a forum in the shared searchable list (only forums the
member may post in) and are written in the shared composer in its dialog frame; a poll opens the
poll section; a wall post skips the forum and posts to the member's own wall. A question is a
discussion worded as one (the backend has no thread type for it). The button is a link to sign-in
for guests and is shown to every signed-in member, because which forums they may post in is not
known without a read per page; the dialog shows only what they can do. The dialog code, the forum
list, the editor and the composer load on first use; the dialog stays mounted when closed (drafts
kept, each opening starts at the choice) and closes on navigation. `/forums/<id>/new` stays a page.
A poll the member already filled in stays open when they switch to Discussion or Question and is
sent as a poll (visible in the composer with a Remove button); a blank poll section closes. On
`/forums/<id>/new` the dialog offers only a wall post, so the page composer and the dialog never
write the same thread draft. Known limits: the bar can hold six cells; no avatar on the wall post;
no sign-in link when the session ends under an open dialog; "Poll or quiz" is offered whenever any
forum is postable (the forum list carries no per-forum poll permission; the composer then says so);
two browser tabs keep separate drafts.
Since item 6 the dialog is the whole screen at every size, not a box (see "Create flow: the whole
screen at every size"), and between `md` and `lg` a member's header shows Create as a square +
(item 7).

**Better feed cards (item 15).** A thread card shows its reply count, how many posts the member has
not read (at most 99, "99+") as a link to the first of them (`/threads/ID?page=N#post-ID`), a Reply
button that opens the one-line composer only when pressed (the composer's code loads then;
`replyFromFeed` and `canReply` as before), and a Poll or Quiz badge. `feed.list` carries `unread` on
thread entries, computed for the page with one statement from `thread_reads.last_read_position` (an
index seek per thread, 100 rows at most each, never a COUNT) for threads `isUnread` already marks,
and only where the viewer may read other members' posts; `Thread.pollKind` comes from one
`polls_thread` seek per page in `threadValues`, so every list of threads can show it. A
Cards/Compact toggle in the filter bar keeps the layout on the account (`users.feed_view`, migration
0057, set through `preferences.update`, which now re-checks `profile.editOwn` in its transaction, so
a member whose group is denied it keeps the layout in the cookie instead) and in the
`forum_feed_view` cookie for guests (necessary; the server draws the feed). A compact row is two
lines, no body, one link over the whole row; a change of layout reloads the page so every scrolled
page is redrawn. Counts are visible posts only, by position, and the first unread post can be an
ignored member's; after a thread merge the stored read position can stay behind what was read, so a
card can count posts already seen until a larger post id is read (bounded: the thread must also be
unread by id). Known limits: wall posts keep their always-open comment box, the compact row shows no
text, staff are not counted held or deleted posts.

### media.list speed `media.list` took about 14 ms (p50) on the benchmark seed for every variant.
Cause: the "newest attachments of one kind" read (`WHERE content_type = ? AND id < ? ORDER BY id
DESC`) ran once for `post` and once for `profile_post`. The statistics (`sqlite_stat1`) say one
`content_type` value holds every row, so the planner walks the primary key backwards and filters by
kind instead of using `attachments_type_id`; for a kind with no rows (the seed has no attached wall
posts) that reads all 300,000 attachments (9.8 ms for that one statement; the `post` read, the files
join and the post lookups cost 0.01 to 0.03 ms each). Fix: the statement names the index (`INDEXED
BY attachments_type_id`), as the thumbnail join already names `files_variant`. Same rows, same
order, same cursor, no migration. Measured on the seed: p50 13.9 ms to 0.4 ms, p95 17.6 to 20.3 ms
before and 0.5 to 1.3 ms after, max 24 to 30 ms before and 0.9 to 4.2 ms after.

### Large test forum (item 23)  The seed generator has profiles: one table, `PROFILES` in
`bench/seed.ts`, read by the same code paths. `bench` is `SIZES` exactly as before (same sizes, same
`SEED_VERSION`, same file name, same output: a regenerated bench seed matches the previous one table
by table except wall-clock stamps written by migrations and triggers, and its meta JSON is
identical), so `bun run bench` and its budgets do not change. `large` is the second profile, for
staging and load checks: about 1,000,000 members (100,000 active plus 900,000 lurkers), 500,000
threads, 10,000,000 posts, 20,000,000 reactions (14M on posts, 2.5M on wall posts, 1.5M on comments,
2M on messages), 1,000,000 wall posts, 3,000,000 comments, 200,000 conversations and 4,000,000
messages: 10x the bench in content. The tables that serve single scenarios grow less: notifications,
thread watches, awards granted, purchases, follows and ignores 2x; thread reads and attachments 2x;
moderation queues 2x; credit rule applications 2.5x (they must exceed the visible threads, which
each earn one). The catalog (forums, groups, awards, shop items, promotions) does not grow. `--scale
<n>` divides every activity count of a profile by `n` (the catalog stays), which gives a quick test
forum (`--profile bench --scale 100`, one second) and the 1/10 sample used to size `large`.  **The
file is too big at the bench's body size, so old rows keep a shorter body.** With whole bodies the
large profile measures about 30 GB (bodies, their HTML and the full-text index are 70% of the file),
and the disk allows about 22 GB. `large` sets `shortBodyShare: 0.8`: the oldest 80% of posts, wall
posts, comments and messages keep only the first paragraph of their body (same pool, same random
draws, the HTML rendered again); the newest 20% keep whole bodies. The full-text index stays. The
bench profile has no share, so its bodies are untouched. Measured: 1/4 of `large` is 4.65 GB, so
`large` is about 19 GB.  **One file, no copy.** `bun run seed:large` (or `bun bench/seed.ts
--profile large [--out <file>]`) writes `~/.cache/sermo-bench/large/sermo.db` and its meta next to
it as `sermo.db.json` (the bench meta plus `profile` and `password`, the shared `SEED_PASSWORD`).
The database is built under `<file>.partial` and renamed when finished, so a file at the path is
always complete; a rerun deletes the old file, any partial one and the meta first. The staging item
opens this file directly. A scaled profile or the bench profile needs `--out`, so a sample can never
replace the large file.  **What had to change for 10x, none of it visible in the bench output.**
Pair keys for watchers, follows and ignores multiplied the user id by 100,000 and collided past
100,000 members: they use the member count now. The thread-read readers are capped at a fifth of the
members (2,000 at the bench). The reply applications ask for a negative limit when threads outnumber
the applications, which SQLite reads as no limit: clamped. The credit ledger spaces its rows over
the five years by the number of applications, not by a fixed 225 s. The reaction totals and the
search index are written 1,000,000 posts at a time, one transaction each, because one statement over
10M posts would keep the whole result in the write-ahead log (the bench has exactly one chunk). The
generator caches 512 MiB of pages (the output does not depend on it; 1/4 scale took 174 s instead of
199 s) and collects garbage between stages, so memory stays at the live size: about 1.1 GB at 1/4,
about 3 to 3.5 GB expected at `large`. Time grows faster than the size (1/10: 50 s, 1/4: 174 s), so
`large` is expected to take 25 to 40 minutes.  A test (`bench/seed.test.ts`, part of `bun run test`)
pins the bench `SIZES`, checks the `large` profile's ratios, and writes a 1/100 forum, checks
integrity, counts and a few backend reads (threads, posts, search), and that a second run replaces
the first. The bench profile now also generates with the 512 MiB cache and full GCs between stages;
its output is unchanged, only the generation time.

### Staging site (item 24)  A second backend and web app on other ports, run locally and not through
the tunnel, on the large seed. `bun run staging:build | staging:start | staging:stop |
staging:status` (all in `scripts/staging.ts`, the pure parts in `scripts/staging-lib.ts`); each
takes `--db <path>`, default `~/.cache/sermo-bench/large/sermo.db` (`SERMO_BENCH_DIR` moves the
base, as for the seed).  **No copy of the database.** The disk holds one large file, so staging
opens the seed file itself and writes to it; regenerate it with `bun run seed:large` when it is
spoiled. That also means there is no backup before a migration.  **Migrations run first, with no
time limit.** `start` opens the database in its own process and applies pending migrations with the
core's `runMigrations` before any server starts, prints how many are pending (or "up to date") and
the time taken, then closes it. The migrator runs them in one transaction, so a migration that is
stopped halfway rolls back and starts over: nothing in the script times it out or kills it, and the
call blocks, so the only progress is the line before and after. The readiness wait that follows (2
minutes, for the servers to open their ports) can stay short. If a migration is stopped by hand,
SQLite rolls it back and the next `start` begins it again.  **Ports and exposure.** Backend 4401,
web 4400, both fixed. 4200 and 4201 are the live test site and the tunnel is never involved; `start`
refuses when anything listens on either port (checked with `netstat -ano` and a request). Both
services stay on this machine, because the database has an administrator with a known password. The
backend's configuration has no host setting (`Bun.serve` listens on every interface unless given a
`hostname`, and has no flag or variable for it), so staging starts it with `bun --preload
scripts/staging-loopback.ts`, a three-line module that defaults `Bun.serve` to `127.0.0.1`; no
backend file changes. The web app runs `next start -H localhost`, which binds the loopback of the
machine (`[::1]` on this one), and is reached as `http://localhost:4400` only:
`http://127.0.0.1:4400` is refused. `-H 127.0.0.1` was tried and breaks the app: Next then builds
request addresses on `localhost` while the Host header differs, so the locale rewrite in `proxy.ts`
is taken for an external address and the app proxies to itself. Verified: home, forum, thread,
profile, search and a conversation answer 200 with no loop.  **State next to the database,** in
`<database folder>/staging/`: `files/` (the upload directory), `backend.pid`, `web.pid`,
`backend.log`, `web.log` and `staging.env`. The env file shows every variable staging sets,
rewritten on each start from the code, except `BETTER_AUTH_SECRET`: a random 32-byte secret made on
the first start and kept, so sessions survive a restart. Nothing secret enters the repository.
Services run with the caller's environment minus every `SERMO_*`, `BETTER_AUTH_*`, `PORT` and
`NODE_ENV` variable, so a shell that loaded the live site's `env.ps1` cannot leak its port or
database into staging. (A `.env` file in the repository root or in `apps/web` would still be read by
Bun and Next; there is none in the checkouts today.)  **Settings, env only.** `BETTER_AUTH_URL` and
the web's `SERMO_PUBLIC_URL` are `http://localhost:4400` (the browser's origin), `SERMO_API_URL` is
`http://127.0.0.1:4401`, the session cookie cache is on, and the four limits the backend reads
(`SERMO_RATE_LIMIT_READ|WRITE|SEARCH|MCP`) are 1,000,000 and 100,000 for the others (the live site
raises read to 3,000). Better Auth's own sign-in limit is not configurable by env, so a load test
that signs in many members from one address meets it; sign in once and reuse the cookie.  **Its own
build folder.** `next.config.ts` reads `distDir` from `SERMO_DIST_DIR` (default `.next`, unchanged
for every other build); staging builds into `apps/web/.next-staging`, so `check:web` in the same
checkout never touches the staging build and the reverse. `next build`, `next start` and `next
typegen` all read it, so `start` passes it too. A run with another `distDir` adds `<distDir>/types`
globs to `include` in `tsconfig.json`, which would dirty the tracked file (and reformat it), so the
two `.next-staging` globs are already in `include`; and `.next-staging` is in `exclude`, so the
typecheck never reads staging's generated types (they are made once, at staging build time, and go
stale when a page changes). Shown: with a deliberately broken file in `.next-staging/types`, `cd
apps/web && bun run typecheck` passes and `tsc --listFilesOnly` lists no file from the folder; a
typegen with `SERMO_DIST_DIR=.next-staging` leaves `tsconfig.json` alone and points the untracked
`next-env.d.ts` at `.next-staging`, and the next ordinary `next typegen` (the first step of
`check:web`) points it back at `.next`. The folder is ignored by git, Biome and Docker
(`.dockerignore`). `SERMO_API_URL` is baked into the routes when the web app is built
(`next.config.ts` rewrites), so a staging build is tied to port 4401.  **Start and stop.** `start`
writes the env file, migrates, starts the backend and then `next start` (on Node, as the container
does) detached with output in the logs, writes each PID the moment it exists, and waits for `GET
/health` on the backend and `GET /` on the web app to answer 200 (a redirect is not followed: a loop
would exhaust the local ports). If one does not come up, both are stopped (this command started them
a moment ago) and the last log lines print. `stop` kills a PID only when it is staging's, decided by
`killDecision`: it is the process listening on the staging port, or nothing listens there yet and
its command line shows it is staging's (the backend is started with `--staging-db <path>`, which the
server ignores; the web app is known by its `next` program and `-p 4400`). It never kills by port
alone, and never a process that listens on another port. A PID file left by a crash or a reboot may
name an unrelated process by now; that is refused with the reason and the PID file path. A slow or
saturated service no longer blocks stopping: `stop` makes no request. It kills with `taskkill /PID n
/T /F` on Windows, which cannot be graceful: SQLite recovers from the write-ahead log at the next
open; the view counts held in memory are lost. Off Windows the listener list is unknown, so only the
command-line rule applies, and the signal reaches the leader only (the owner runs Windows). `status`
prints PID, liveness and whether each answers. `start` and `status` print the sign-in: the
administrator's username (read from the database) and `user<id>@example.test`, with the shared
password from the meta JSON next to the database (`adminId`, `password`). Staging is opened as
`http://localhost:4400` (the web binds `localhost`, which is `[::1]` on this machine); the phone
tests, Lighthouse and the load test use that address, not `127.0.0.1`.

### Phone profiles (item 26)  `@playwright/test` 1.64.1 (the one new dev dependency, `apps/web`)
drives the site in five device profiles from Playwright's own list: Galaxy S8 (360 x 740, the design
width; Galaxy S9+ is 320 wide in this version, so it was not used), Pixel 7 (412), iPhone SE (320),
iPhone 15 Pro Max (430) and iPad Mini (768). The iPhones and the iPad run on WebKit, the rest on
Chromium. The suite is `apps/web/e2e/*.e2e.ts` (named so `bun test` does not collect it) with
`playwright.config.ts`, started by `bun run e2e` in `apps/web`. It is not part of `check` or
`check:fast`: it needs a running stack, which it never starts.  Where it runs and as whom:
`E2E_BASE_URL` is the address (default `http://localhost:3000`, the dev fixture). For any other
address `E2E_USER`, `E2E_PEER` (another member, for conversations and for content that is not the
member's own, such as reactions) and `E2E_PASSWORD` (one password for both) are required, and the
run stops before the first test when one is missing. The setup does not skip either: it fails if the
member may post nowhere, if the peer cannot sign in or write a thread, or if the long thread gets
fewer than 22 posts. A setup project signs in through the form once, makes a thread with three pages
and one by the peer (through the REST API, as each member), opens the main pages so a development
server has compiled them, and keeps the session. A run leaves its content on the target: that
thread, a discussion, a poll, wall posts with a picture, a conversation and messages, every time. Do
not point it at a site whose data matters.  What a test waits for is a condition, never a fixed
pause: `ready()` waits until every control of the page has been taken over by React (a press before
that races the hydration of popups) and fails after 30 s; a sign-in waits for the form's server
action and, when the limiter refuses (three tries in ten seconds, `x-retry-after` on its answer),
polls the limiter until it opens; a saved choice waits for its action's answer; a draft waits for
the tab's storage; a gesture that must open nothing runs the page's clock past the hold timer. Every
flow runs at 360 px (`android-small`); flows tagged `@all` also run on the other four. Every test
fails on a console error, an uncaught page error or horizontal page scroll; below 360 px an overflow
is recorded as a "found" annotation instead (the design promises nothing narrower, so a green
`iphone-small` does not say the pages fit 320 px). The service worker test registers the worker and
cuts the network; it skips itself on a development server (its pages load the hot reload client) and
was run against a production build on Chromium.  Four small web fixes came out of the first run. The
cookie banner now leaves room under the page content as tall as itself while it is open
(`--consent-space`, set from the banner's own height and given back when it closes or the page
unmounts), because it covered the sign-in button of the login page at 360 x 740; a short page, such
as the sign-in page, gets a vertical scrollbar of that height while the banner is open, also on a
desktop. The bottom bar labels lose a pixel of padding so "Messages" is not cut off at 360 px in
either language. The guest header gives up its own Create button between 768 and 1023 px (`md` to
`lg`) and shows Log in as an icon there (the text from `lg`, where it used to come at `sm`, 640 px):
on a tablet in portrait the header was 110 px wider than the screen. A guest therefore has no Create
entry at those widths (the bottom bar is phone-only); it only led to the sign-in page, which Log in
and Create Account reach, and the room is not there. The lazy editor now reads the typed text and
swaps in the editor in one synchronous commit: a key pressed while the editor chunk arrived was
lost. Only an end-to-end test guards that, and it reproduces on a development server, where the
chunk compiles slowly; on a production build it passes with or without the fix. There is no draft
for a reply; the drafts tested are the new thread's.

### Load test (item 27)  k6 scripts in `load/` (not a dependency: the binary lives outside the
repository, v2.3.0 under `C:\Users\albert\tools\k6\`, checked against the release checksum) that
simulate visitors against the staging backend, and a log line for slow database writes.  **What it
loads.** The backend REST API, with the calls the web app makes (`/api/v1/...`, the session cookie,
JSON bodies), not HTML pages: the web app keeps no data, so page loads would measure Next, not the
forum. Four `ramping-vus` scenarios share the peak: guests (55%: home, forum, thread, profile,
search), feed scrollers (20%: `feed.list` with keyset cursors, up to nine pages), conversation
pollers (18%: `listMessages` with `afterMessageId` every 3 s, `feed.newCount` every 30 s,
`auth.counters` every 60 s, the intervals of `apps/web/src/lib/poll-intervals.ts`) and posters (7%:
`posts.create`, `conversations.reply`). Reading also writes, so the scripts send the read marks the
web app sends: `threads.markRead` (`PUT /threads/{id}/read`, `{position}` of the last post of the
page) after a member reads a thread, and `conversations.markRead` (`PUT /conversations/{id}/read`)
when a conversation opens and when a poll returns messages. Writes are then about 4 to 6% of all
requests (5.6% in the smoke run, whose poster share is rounded up to 10%; the report prints the
measured share, read marks included). Profiles are chosen by `PROFILE`: `smoke` (10 VUs, 30 s),
`hundreds` (300 VUs, 5.5 min), `thousands` (1,000 VUs, 9 min, `PEAK_VUS` up to 2,000). Thresholds
are a report bar, not budgets: errors under 1% (reads and writes apart), reads p95 under 200 ms,
writes p95 under 500 ms; the report lists every operation with count, average, p95, p99 and maximum
(an always-passing threshold per operation makes k6 keep those sub-metrics).  **Sign-in.** The limit
of Better Auth is 3 sign-ins per address, counted again only after 10 s without one (a steady pace
of one every 4 s still met a 429 on the fourth). The address is the one of the socket: the app puts
the client address in its own header from the connection unless `SERMO_TRUSTED_PROXY_HEADER` is set,
the staging env does not set it, and Better Auth reads only that header
(`advanced.ipAddress.ipAddressHeaders`), so an `X-Forwarded-For` sent by the load test is ignored
and was dropped. `setup()` signs a pool in three at a time with a 10.5 s pause after each three but
the last (6, 40 or 60 members, each in a conversation they take part in, from the meta's
`conversationMembers`) and VUs reuse the cookies (session in an explicit `Cookie` header, no cookie
jar).  **Write waits.** Nothing exposed them: the backend logged failures only and `busy_timeout` is
5 s, so a short wait or a stalled commit left no trace. `writeTx` (`packages/core/src/db/tx.ts`) now
takes `performance.now()` at the start, when the callback begins (BEGIN IMMEDIATE has returned: the
difference is `wait` for the write lock), when it returns (`hold` is the callback's time) and when
the transaction returns (`commit`, where a checkpoint overlapping a stream of commits shows), and
logs `[db.write-wait] at=<time> wait=<ms> hold=<ms> commit=<ms>` only when `wait` or `commit` is 100
ms or more (a write that failed after waiting is logged too; a rollback is not timed). Fast writes
cost clock reads and no allocation or string building. The backend is one thread, so `wait` grows
only when another connection holds the lock (the checkpoint worker, a migration); `commit` is the
number for stalls. A test starts a second process that holds the write lock for 400 ms and expects
one log line with `wait >= 100` and none for a fast write (it fails on the old `tx.ts`).
`load/write-waits.ts --db <path>` reads `<db folder>/staging/backend.log` from a byte offset
(`--size` before the run, `--from` after) and reports the number of slow writes with p95 and maximum
of wait, hold and commit (over the slow writes only), locked-database failures, failed requests
logged and the size of the WAL. Bun prints a failed request's error over several lines
(`SQLiteError: database is locked`, then `code: "SQLITE_BUSY"`), so one failure is counted by its
first line only; a test parses a fixture log (`load/write-waits.test.ts`).  **Rejected:** a
`/metrics` endpoint (a public surface with its own permissions) and a per-statement log (too heavy
on the hot path).  **Not covered.** The scripts do not load the Next server: HTML responses, server
actions and the caching of the web app are untested by them. All signed-in load comes from at most
60 identities (the pool), and 1,000 VUs share them and their session cookies, so per-member rows
(read state, counters, the post flood clock) are hotter than in real traffic and the numbers are
read with that; per-user rate limits do not matter because staging raises them. The thread read
marks use the position of the last post of page one only. `load/` is outside the root tsconfig and
the check scripts; biome checks it. Only the posting visitors send `threads.markRead`; in the app
every signed-in member viewing a thread does, so read-mark writes are understated. `bun test ./load`
runs with the root tests.

### Lighthouse (item 25)  Lighthouse CI on the main pages, in mobile emulation, against a running
site. `bun run lighthouse [--url <address>] [--consent before|after] [--pages ...] [--runs 3]
[--dry-run] [--db <staging database>] [--name <folder>]` (`scripts/lighthouse.ts`, the pure parts in
`scripts/lighthouse-lib.ts`, the Lighthouse CI configuration in `lighthouserc.cjs`). The default
address is the staging site, `http://localhost:4400`.  **Two dev dependencies, and a pin.**
`@lhci/cli` 0.15.1 (root dev dependency, exact) bundles Lighthouse 12.6.1, which has no
agentic-browsing checks. Lighthouse 13.5.0 has a category for them, so the root `package.json` has
`overrides: { lighthouse: "13.5.0" }`; `lhci` starts Lighthouse's own command line as a subprocess,
which is why the pair works (checked: version, mobile form factor and the category in the reports).
Remove the override when a Lighthouse CI release bundles 13. `puppeteer-core` 25.14.0 (exact, root
dev dependency) is the version Lighthouse 13.5.0 already pulls into the lockfile, declared so that
`lhci`'s puppeteer script can use it; nothing new is downloaded. The two pins move together: raising
the Lighthouse override to a release that wants another `puppeteer-core` needs the root pin raised
in the same change, or the lockfile holds two copies.  **Agentic browsing.** The category is
`agentic-browsing`: `llms-txt`, `ard-schema` (`ai-catalog.json` against the Agentic Resource
Discovery spec), `agent-accessibility-tree`, three WebMCP audits (`webmcp-registered-tools`,
`webmcp-form-coverage`, `webmcp-schema-validity`) and layout shift. Each of the six audits is
asserted at 1 on every run, and "not applicable" passes (no `ai-catalog.json`, no WebMCP tools, a
404 for `llms.txt`). The backend's own `/llms.txt` meets the audit's rules (an H1, a link, not
short); it is not reached on staging, where the web app answers 404 for `/llms.txt`, `/robots.txt`
and `/sitemap.xml` (the ingress, Caddy, sends them to the backend, and staging has none), so on
staging the `llms-txt` audit passes without being tested. **Mobile.** Lighthouse's default form
factor, set explicitly: a 412 x 823 screen at 1.75 pixel ratio, a phone user agent, simulated slow
4G and a 4x processor slowdown, and Lighthouse's own reset of caches and storage before each run. 3
runs per address; the assertions use the median (`aggregationMethod: median`) of each category.
Performance, best practices and SEO must reach 0.9, as errors; accessibility is not asserted. Search
results and conversations are `noindex` on purpose, which costs `is-crawlable` about 40 SEO points,
so those two addresses are held at 0.5 (`assertMatrix` in `lighthouserc.cjs`).  **Pages come from
the site's own API.** The forum with the most threads; in it the thread with the most posts (first
page, and `?page=<last>` from the position of its last post and the page size); a member with posts
whose page the backend lets search engines index (an empty profile is `noindex`); a word of a thread
title that `search.query` finds; the first conversation of the signed-in member. Addresses are taken
from the backend's canonical addresses (`/seo/*`) so a run never pays a redirect. The conversation
page signs in with `E2E_USER` and `E2E_PASSWORD` (an email or a username), else as the staging
administrator from the seed meta next to `--db`, and puts the session into the browser's cookie jar
(below).  **Before and after the banner: the cookie goes into the browser.** "Before" is a visitor
who has chosen nothing and sees the banner. "After" accepts it: `lhci`'s `puppeteerScript`
(`scripts/lighthouse-cookies.cjs`) puts the cookie the banner writes on "Accept all" into the cookie
jar of the Chrome Lighthouse drives, before each page. The banner is script that reads
`document.cookie`, so a `Cookie` request header (the first version) was seen by the server and never
by the banner, and the "after" run still showed it. The cookie is the library's (`forum_consent`,
URL-encoded JSON, not HTTP-only, same fields as the cookie of a real click and of
`lib/consent/account.ts`), built from the site's own settings: the policy version, the language, and
no `analytics` when the site's only analytics is Matomo without cookies (the banner leaves it out).
`apps/web/tests/lighthouse-consent-cookie.test.ts` pins its shape to the app's parser and writer.
Proof that "after" accepts the banner: the `final-screenshot` of every address is saved under
`.lighthouseci/<name>/screenshots/`; "before" shows "Your cookie choices" with Accept all, Reject
all and Choose, "after" does not (checked on home, thread and conversation in the first round and on
home after the launcher change). **One launcher for both modes.** The puppeteer script is always set
(with no cookies it does nothing), so every run starts Chrome the same way and "before" and "after"
differ only in the cookie. An earlier version launched "before" with `lhci`'s own launcher and
"after" with puppeteer's, which differ in flags and in how many runs share a browser; the "after"
scores came out a few points lower for that reason, not because of the banner. **Runs share a
browser, so profiles are not fully fresh.** The runs of one group (an address list under one cookie
set) use one Chrome: Lighthouse resets caches and storage before each run (not cookies), but a
cookie a page sets itself (language, referral) stays for the next run of the group. **The
conversation page signs in with the cookie jar too.** The session cookies from the sign-in response
go through the same script, in the environment of the `lhci` process (`LIGHTHOUSE_COOKIES`, which
its children, Lighthouse and Chrome, inherit; same user only), never in a file, in `settings` or in
a report: no `session_token`, `session_data`, email or password appears under `.lighthouseci/`
(grepped), and no third-party origin receives them. The login is `E2E_USER` and `E2E_PASSWORD`
(both, an email or a username); the staging administrator of the seed named by `--db` only when
`--url` is on this machine (localhost or 127.0.0.1); otherwise the conversation page is left out
with a printed note, and so is a failed sign-in: the other pages still run. Reports of the
conversation page contain the conversation's own text (the signed-in member's names appear in it).
**Chrome.** `CHROME_PATH`, else the installed Chrome, else Playwright's Chromium; nothing is
downloaded. Reports go to `.lighthouseci/<host>-<consent>/` (in `.gitignore`), each with a
`summary.json` of the medians. A run of seven pages and three runs is about five minutes, so
`--pages` splits it (the staging command limit is three minutes), run under different `--name`s: a
run empties its own folder first, so no report of an earlier run is mixed in (there is no
`--additive`). `--name` takes `[a-z0-9-]+` only and the folder is resolved strictly inside
`.lighthouseci/`.  **Fixes.** The feed's "Read more" link reads "Read the full post" ("Leer la
publicación completa"): the audit `link-text` rejects "Read more". The main column of the shell is
at least one screen high (`min-h-[calc(100svh-3.5rem)]`): the footer was in the first paint and was
pushed about 13,000 pixels down when the feed streamed in, which was all of the home page's layout
shift (0.086 to 0.003) and the forum's (0.089 to 0.004). **Tried and reverted: blocking metadata for
everyone.** `htmlLimitedBots: /.*/` puts the title, description, canonical address and robots in
`<head>` for every visitor (Next streams them into the body, after the page, for anyone not on its
list of crawlers), which is what the audit `meta-description` reads, and what a crawler that does
not run scripts (GPTBot and the like) or a link preview needs. It cost too much: the observed first
paint of `/` went from 126 ms to 200 to 270 ms (the first flush waits for `generateMetadata`), the
simulated LCP from 5.0 s to 7.8 to 8.5 s (performance 77 to 73), and every unknown address
(`/nonexistent-page`) answered 200 with the not-found page, a soft 404. Without it, unknown
addresses answer 404 for an ordinary browser, Googlebot's user agent and GPTBot's. Consequence:
`meta-description` fails in Lighthouse on every page (the metadata is in the body when Lighthouse
looks), so SEO stands at exactly 0.9 where nothing else fails. Googlebot is not on Next's list
either (it runs scripts and reads the streamed metadata); non-JS crawlers see no description. A
follow-up could serve blocking metadata only to named crawlers (link-preview bots such as
Telegram, WhatsApp) with an explicit `htmlLimitedBots` list.  **The runner fails today, by design.**
Performance is asserted at 0.9 as an error and every address scores 79 to 82 on the small forum
(sizes and audits in the item's Result, for the follow-up on first-load JavaScript), so `bun run
lighthouse` exits 1 until that work lands; best practices, SEO and the agentic audits pass. The
category `agentic-browsing` itself is not asserted (one earlier run read 99 on the conversation page
from a layout shift that did not reproduce); only its audits are. SEO stands at exactly 0.9 on the
indexable pages (`meta-description`, see above). The 0.5 hold for `noindex` pages is anchored to the
address path and ends at a slash, a query, a fragment or the end of the address
(`^https?://host/(conversations|search)(?:[/?#]|$)`; `/searchable` is not held; a test covers it).
**"Before" depends on the visitor.** A guest the backend places outside the EU does not see the
banner when the site's setting "banner outside Europe" is off; the screenshots tell whether it was
drawn.  **Known limits.** The runner measures what answers on the address; the live site runs the
main checkout's build, not this branch. The consent cookie is a copy of the library's cookie shape
(`lib/consent/account.ts` writes the same one), so a change there needs the runner's `consentCookie`
kept in step. Scores move by a few points with other work on the machine (item 26 runs Playwright);
no jump was seen between runs.

### Phone suite on the production build (item 26b)  **The avatar menu's alert rows register their
client component where every page can see it.** `loadAlerts` is a server action that returns
`AlertRows`, which draws the client component `NotificationLink`. React can only serialise a
reference to a client component that the route's client reference manifest lists, and Next lists
only the client modules a server module of that route imports; what a server action imports does not
count. In the staging build 2 of 133 route manifests listed `notification-link` (the notifications
page and the styleguide), so on every other page a production build answered the first open of the
menu with React error #441 (an error in the Server Components render, its message left out of
production builds) and the page showed its error screen. A development server has one manifest for
everything, which is why the phone suite never saw it. `components/layout/panel-parts.ts` lists the
component (the pattern of `member-card-parts.ts`, frozen so the import is kept) and
`account-menu.tsx`, which every page with the menu renders, imports it. `panel-parts.test.ts` fails
without that import. The messages and bookmarks tabs hold only client components the pages list
already.  **Test faults found on a production build, each fixed in the test with its reason.** - The
bottom bar check counted the unread dot (it sticks out of the icon's box on purpose) and the
clipped screen-reader text of a member who has unread alerts. It now measures elements that draw
text and are not `.sr-only`. - The menu opens on the tab with something unread; the theme buttons
and the data-saver link are on   the Account tab. The tests that need them now open that tab. - The
reaction picker was measured while its 100 ms scale-in ran (39.99997 px): the test waits for   the
popover's animations. The Like button was only brought into view, which can leave it under the
fixed bottom bar (an administrator's thread header is taller): it is now centred. - The compact list
test reloaded the page while the toggle's save was in flight (a large forum   answers slowly),
cancelling it or colliding with the page's own reload. It waits until the   document it marked is
gone, also at the end so the next project starts from cards. - Below 360 px a row with a reaction
chip leaves its title less than 120 px: annotated, as   `expectFits` does, since the design promises
nothing under that width. Other projects still fail. - The guest theme test used the home feed,
whose endless list keeps moving the footer down while it   is scrolled to (a press landed where the
button had been, WebKit). It uses the forum list. - The large seed's attachments are rows of the
bench `fake` storage driver: their pictures answer   400 "Storage driver is unavailable" and the
browser logs a line each. The console lines are   forgiven by count, as many as such answers were
seen (Chromium's console line has no address);   any other 400 beyond that count still fails the
test. - The sign-in helper probed the limiter every one or two seconds while it was closed. A probe
that   lands as the window ends is refused and starts it again, so the probing kept it closed. It
now   waits the `x-retry-after` it was told, sending nothing.

### WAL growth under load (item 27b)  **Cause.** Staging's WAL reached 32.6 GB because a stream of
back-to-back commits never lets the WAL restart. A PASSIVE checkpoint copies the frames that existed
when it began; SQLite restarts the WAL (writes from the first frame again) only when a write begins
and finds every frame copied. The notification fan-out commits a batch of 40 recipients, yields one
event-loop turn and commits again, so a checkpoint always ends with newer frames behind it and the
WAL only grows, for as long as the fan-out runs (and the job holds checkpoints for up to 30 s
besides). Each recipient costs about 5 KB of WAL (a row in `notifications` and its nine indexes, the
member's unread counter, the job's progress row; 1.3 frames per row), so a post in a forum with
100,000 watchers is about 0.5 GB of WAL; a few dozen such posts (the Playwright suite) are the 32
GB. No `journal_size_limit` was set either, so the file stayed at its high-water mark after a reset
(`wal_checkpoint(TRUNCATE)` reported `log: 0` over a 32 GB file). The fan-out transactions were
already bounded (40 rows), so batching was not the cause. **Reproduced** in process with no server
(`bench/seed.ts --scale 10` and `--scale 2`; the script wrote posts into the hot forum and thread
with every member watching, ran the job worker, event dispatch and the checkpoint thread as the
backend does, and two reader threads): at 2 posts per second, 331,000 notifications left a 1,696 MB
WAL (431,000 frames, never restarted), at 8 posts per second with readers holding short transactions
7,500 MB for 597,000 notifications; at scale 2, 225,000 notifications left 1,301 MB. **Fix 1:
`paceWal` (`db/checkpointer.ts`).** Between batches the fan-out calls `betweenBatches` (the old
event-loop yield plus `paceWal`). When the WAL file is past `journal_size_limit` the job stops
writing and asks the checkpoint thread for a checkpoint now, waits for the second complete
checkpoint (the first may have begun before the job stopped), and its next write restarts the WAL.
The fan-out resumes from the saved batch position as before; the pause only delays the next batch.
**This is the one exception to the holds rule** ("background jobs hold checkpoints at most 30 s",
"WAL checkpoints during background jobs"): holds still delay the periodic checkpoint, but a pace
checkpoint ignores them. While the job awaits, the event loop serves requests, so request writes and
event dispatch can commit beside that checkpoint, the overlap the older entry blames for 0.3 to 6 s
commit stalls. The overlap is bounded: one extra checkpoint per 64 MiB of fan-out WAL (about 13,000
notifications), not one per tick, and a hold-free checkpoint of an unbounded WAL was due at least
every 30 s anyway. The wait goes on while a checkpoint is running (the same one seen twice 5 ms
apart) or the frames it copied keep changing, so a slow disk is waited for; it ends after 10 s
without progress (a reader keeps an old snapshot), and then waits again only once the WAL has
doubled, a memory dropped as soon as the file is back under the limit, so a stuck reader cannot slow
a job to one batch per 10 s and never switches the protection off for good. Stopping the
checkpointer ends a wait. Costs a pragma read and a `stat` per batch (microseconds), nothing without
a checkpointer. Applied to every loop in `notifications/delivery.ts` (fan-out, deletes, mark-read,
retention purge). Other jobs that stream commits (credit rules, awards, shop expiry, moderation
batches) do not call it yet (not measured); the call is one line where one proves to need it.
**First thing to read on the next staging run:** whether a pace wait ever gave up (the WAL stays
above 64 MiB and grows) on the cold 18.9 GB file; if so the checkpoint is slower than the progress
rule can see. **Fix 2: `journal_size_limit` = 64 MiB on every connection (`openDatabase`).** The
connection whose write restarts the WAL cuts the file back to the limit (checked: setting it only on
the checkpoint thread does nothing), so the file follows the live WAL instead of its high-water
mark, and "file larger than the limit" means "live frames beyond the limit", which is what `paceWal`
tests. **Rejected:** a `wal_checkpoint(RESTART)` or `FULL` escalation (it blocks request writes for
the whole copy, the reason checkpoints moved to a thread); smaller or larger fan-out batches (frames
per row barely change with the batch size, the rows land on different pages); releasing the hold
sooner (the stalls the hold prevents come back). **Measured, same script, before then after:** 2
posts per second for 60 s on the 1/10 forum: peak WAL 1,696 MB then 65 MB, all 331,143 notifications
delivered in 74 s then 70 s, post p95 6 ms then 6 ms, reader p95 0.1 ms in both; 8 posts per second
with readers in transactions: 7,477 MB then 64 MB (delivery 12% slower while the job is saturated,
524,000 against 597,000 rows in the same time, because it now pauses to checkpoint; reads and posts
unaffected); 1/2 forum (1.7 GB file, 30,000 watchers): 1,301 MB then 64 MB for 224,817
notifications, 26 s then 30 s. Commit stalls of 100 ms or more: 6 then 0 at 8 posts per second.
**Not measured:** the 18.9 GB staging file on cold storage (stalls of 1 to 5 s there came from
checkpoints overlapping commits, which fewer, smaller checkpoints made while the job is paused
should reduce; check on the next staging run: `load/write-waits.ts` and the WAL size afterwards).
**Tests:** `foundation.test.ts` (the pragma is applied; `paceWal` makes a held WAL restart and the
file shrink to the limit, returns at once without a checkpointer, and gives up and backs off on a
reader-held checkpoint) and `notifications/index.test.ts` (an 800-watcher fan-out reaches everyone
and the file stays under twice the limit: 0.5 MB paced against 1.7 MB with the call removed).

### Mobile performance (item 25b)  Lighthouse mobile on the small forum went from 77-84 to 80-84 on
the six content pages (search 88 after the banner). The goal of 90 is not reached; what was done,
what was measured and what decides the rest follows.  **The message catalogue was sent twice because
the whole root layout is.** With `cacheComponents` the document carries the static shell's flight
data once (the prelude) and the resumed render replays it (rows `24:o...`): on the home page two
chunks of 149 KB, each holding the layout's 72 KB `messages` prop. That duplication is the
framework's, so anything in a layout is paid twice. The root layout now sends only
`layout.routeError` (`ROOT_NAMESPACES`); a layout adds what its pages need with `<ClientMessages
namespaces={[...]}>` (a server component that picks the namespaces and hands them to `MoreMessages`,
a client component that merges them into the parent provider's messages, since
`NextIntlClientProvider` does not merge). `(main)` sends the shell (header, create flow, feed,
member card: 14.7 KB), `(auth)` and `(staff)` their own union, and `account`, `account/security`,
`conversations`, `forums/[id]`, `tags/[name]`, `threads/[id]` and `ui` add theirs.
`tests/client-messages.test.ts` computes, for every page, layout, loading, error and not-found file,
the namespaces its client modules read (the import graph, dynamic imports included) and fails when a
provider above it does not send one, when a layout sends one that nothing under it reads, and when
one is sent twice. Home: 72 KB to 16 KB per copy; document 987 KB to 864 KB (132 KB to 95 KB gzip);
the shell chunk 149 KB to 93 KB.  **JavaScript.** The share button, the tab overflow menu and a
profile's more menu load on first use through `LazyPopup` (the device share sheet is still asked for
inside the press, where a browser allows it). Home 325 to 307 KB gzip, profile 318 to 301; thread,
forum, search and conversation are unchanged (the one added client component, `MoreMessages`,
offsets what the lazy buttons save). Every content page still has the reaction button's popover, the
thread hover card, the composer dialog, a select or the widgets sheet in its first load, so Base
UI's positioning code stays. `legacy-javascript` is Next's own polyfill module in the main chunk
(feature-tested, always included): no browserslist change touches it; the default target is already
Chrome 111 and Safari 16.4. Budgets lowered where the measured size plus 3% is under the old budget
(home 329 to 317 KB, profile 325 to 310, other 313 to 296); the others keep theirs (the new size
plus 3% was above it).  **Document size.** The 115 icons are 49 KB raw and 2.2 KB gzip together: a
sprite saves nothing worth the change. The document is 70% flight payload.  **`link-text`.** The
failing link on the large forum's profile was the avatar link of a member named "Go...": its text
was the initials, "GO", which Lighthouse's English list rejects. The initials are now drawn with
`after:content-[attr(data-initials)]`, so the link has no text node and keeps its `aria-label`.
**Why the score stays near 80.** Lighthouse simulates LCP from the scripts that finished before the
observed LCP. Observed LCP is 330-500 ms on every content page and all scripts are in by then, so
the simulation counts all of them (4.4 to 5.3 s). The one page whose LCP paints within about 150 ms,
search after the banner (335 KB document), is simulated at 3.5-3.8 s and scores 88-91. Observed LCP
follows document size and hydration work (search 137 ms at 335 KB, forum 378 ms at 516 KB, home 468
ms at 864 KB), not server time (the whole home document is out in 70-90 ms). So reaching 90 on the
other pages means a much smaller first document: the feed's 21 cards and a thread page's 33 posts
are the bulk, and their size is the backend's page-size default, which the web app deliberately does
not copy. Before the banner is accepted the LCP element is the cookie banner, drawn by the library
after hydration; a banner in the first flush would make LCP early on every page in that mode, but it
touches consent handling and was not attempted. Not done, for these reasons: `inlineCss` (no
measurement, risk as in 25), the remaining Base UI popups (about 0.1 s of simulated LCP per 17 KB:
measured, +1 point for 17 KB).  **Phone suite** on this build: 39 passed (android-small).

### Phone suite on the large forum (item 26c)  The six failures of the phone suite on the large
forum were test problems, not slow code. The feed view toggle saves the choice on the member's
account, so the choice outlives a run. The compact list test pressed Compact and expected a save and
a reload, but a run that had stopped earlier (the stale-build run) left the account on compact: the
button was already pressed, `FeedViewToggle` ignores a press of the chosen option, no action was
sent and the page never reloaded. With the account on cards the test passes on the large forum in
about 2 s, and the action itself answers in about 30 ms. The test now starts by pressing Cards when
Compact is already pressed, then goes on as before. The account menu test now looks for the panel of
the tab it just chose (`getByRole("tabpanel", { name })`) because the leaving panel is still in the
page, inert, while it animates out. No app or backend change.  ### A form sent before the page's
script ran (item 26c, round 3)  A form of the `(auth)` pages that the browser posts by itself (a
press before hydration, scripts that do not load) was answered with a document nothing could draw:
the action's state as flight data in script tags with no `<html>`, plus a not-found tree. That held
for every outcome, not only the sign-in that adopts the saved cookie choice: a wrong password, a
refusal by the limiter and a sign-up error all left a blank page, and a sign-in that worked left the
member signed in on it. A `redirect()` from such a post is answered properly (303 to a real page).
With JavaScript switched off altogether the streamed forms stay hidden (React reveals them with an
inline script), so that case is not supported; what is supported is a submit before hydration and
scripts that fail.  Decision (safe option): keep `assign` for the hydrated form, so the banner reads
the adopted cookie after a full load, and answer every other submit with a `redirect()`. The two are
told apart by a hidden field, `hydrated`, which `HydrationMark` renders empty in the server's page
and as `1` after hydration (`useSyncExternalStore`, server snapshot empty). A submit that React
handled carries it; a native one does not. No header is used, so nothing depends on what Next sends.
A refusal of a form sent that way is a redirect to the form's page with `?refused=<key>` (plus
`next`, `ref`, `token` or `form=resend` where the page needs them to draw the same form again). The
key is one of the keys under `auth.actions.errors` (`REFUSALS` in `native-form.ts`, checked against
both languages by a test); the page validates it, translates it on the server and gives it to the
form as its first state, so the message is in the HTML before any script. The name typed is not put
in the address. Applies to sign-in, sign-up, forgot password, choose password, resend confirmation
and the "not me" confirmation; the app has no 2FA step. No new strings.  Test rule:
`apps/web/e2e/native-forms.e2e.ts` blocks `/_next/static/chunks/*.js` (the page's inline scripts
still run; the service worker is blocked too, or it answers the scripts from its cache) and sends
the sign-in by Enter, after asserting that the form is not hydrated. It failed on the staging build
without the fix (blank /login) and passes on the production build of the fix (iphone-large, tablet
and the three Android and iPhone projects of the full suite). What no browser test drives: forgot,
reset, resend and the "not me" step are covered by unit tests only (staging has mail off), and the
pages' reading of `refused`, including the sign-in page's `form=resend` routing, has no test. The
native refusals are coarser than the hydrated ones: an empty email says `invalidEmail` where the
hydrated form says "required", the "not me" step says `generic` for any failure but a bad link, and
a refused sign-up or reset loses the typed fields. That is acceptable for a fallback path.  The
hydration field is set in a layout effect, which runs in the commit that hydrates the form, so React
never handles a submit while the field is still empty (a passive effect left a moment in which the
action took the native branch from a hydrated page: a soft redirect, the refusal text not shown, the
banner not reading an adopted choice). The hidden input has `autoComplete="off"` so a browser that
restores field values cannot carry the `1` of an earlier visit into a page that is not hydrated.
Test rules for the sign-in limits (round 4). There are two limits on a sign-in: Better Auth's pace
limit (a few tries per ten seconds per address; it answers 429 with `x-retry-after`) and the
account's wrong passwords (ten in fifteen minutes per name and address; no wait of a test gives them
back). The native sign-in tests ran with the member's name and wrong password, so five projects of
one run spent half of the member's budget and the auth tests of the later projects were refused. Now
a native test that needs a wrong password uses a name nobody has, new for every test, a refusal for
pace is waited out the way the sign-in fixture does (`limiterWait`, a probe that cannot succeed,
nothing sent meanwhile) and a refusal that names no wait fails with its cause. The tests block the
page's scripts with `serviceWorkers: "block"` as well: a service worker with the scripts cached
answers past the route, the page hydrated, and the "native" form was a hydrated one (this is why the
iphone-large run waited two minutes for a navigation that could not come).

## UI round: editor toolbar, phone bar, cookies, rules gate, home tabs, create, postbit, unread counts

### Phone bar: Home and Forums merged (item 2)  Migration `0058_mobile_bar_merge_forums` deletes
the seeded `mobile.forums` entry (and anything an admin placed under it), so the member bar is Home
· Messages · + · Alerts · Profile and the guest bar Home · + · Log in. Home and Forums both answer
"where is the content": the forums list is a view of the same discussion the home feed shows, so a
five-slot bar spent two slots on one place and split 3 + 2 around the +. Home leads to the feed,
which gets a Forums tab (item 5); `/forums` and the header and footer Forums entries stay. Messages
and Alerts stay separate: conversations you answer and notifications you read are different tasks,
each with its own unread count and destination, and merging them would hide one count behind the
other. The + rule (`ceil(n/2)`) already centres it for an even count (2 + 2) and keeps today's
place for an odd one; tests pin 2, 4 and 5 entries. Admin-edited bars are still capped at 5. With
the Forums entry gone, Home is current on `/forums` and thread pages too, since the home page's
Forums tab holds the forum list now (item 5).

### Cookie banner: green accept, red reject, forum width (item 3)  The banner says what cookies
are for and that saying no is fine, in plain words (en and es; the wording is a draft the owner
finalises). Accept all is solid green with a cookie icon and Reject all solid red, the same size
(equal weight stays); Choose is a quiet outline. New tokens `--consent-accept` and
`--consent-reject`, each with a hover and a foreground, in both themes, all at least 4.5:1;
`--success` is untouched. The settings dialog's Accept all and Reject all take the same colours so
the two screens look alike; its Save stays neutral. The colours go through the library's own
`--cc-btn-*` variables per `data-role`; the icon is lucide's, rendered by React into a hidden span
whose markup the library's HTML label copies. On desktop the banner is exactly the Container's
content box (1388 px at 1440, 1068 px with the narrow setting, which the narrow rule now also
applies to the banner), so it lines up with the forum's cards; on phones it is the full width less
the 1rem gutter, above the bottom bar. The text may take up to 40dvh (the library cut the Spanish
text and the policy link after about six lines at 320 px); a 1px border separates it from the page
in dark; the policy link ("Read our cookie policy", also on /privacy) is always underlined, since a
phone has no hover. `forum_consent`, the categories and the library version are unchanged.

### Rules gate: a full screen before anything else (item 4)  When a signed-in member has pages to
accept (`auth.me` lists them), the `(main)` layout draws `AcceptanceGate` in place of the page: the
site mark and name, a title and one line, the text of each pending page (terms and/or rules, from
the existing `pages.get`, rendered as on their own pages) in a box that scrolls, then "I accept"
(the same `acceptTerms` action and versions as before) and "Log out". The requested page is not
drawn (Next may still prepare its segment; the backend lets that member read the same pages), and
the header, staff bar, notices, footer and phone bar are hidden and out of the Tab order while the
gate shows. Accepting redraws the current address, so the member lands on the page they asked for.
Guests and members with nothing pending get the normal page with no extra request (the check reuses
the request's `auth.me`). The old strip under the header and its styleguide entry are gone. On
phones the buttons are full width; on a short screen the whole gate scrolls and the text box keeps
at least 10rem; while the cookie banner shows, the gate keeps `--consent-space` free under the
buttons. Every `(main)` route is gated, `/account`, `/terms` and `/rules` included; `(staff)`
routes are not. Known limits: a gated member sees the header for about two round trips before the
gate on a full load; keyboard shortcuts stay on (they change the address only); on a first load
the main area starts empty instead of its skeleton, because the gate reads the request.

### Editor toolbar: four sizes from the bar's own width, group menus (item 1)  The formatting bar
picks its layout from its own width with container queries (`@min-[420px]`, `@min-[575px]` and
`@min-[900px]` on the parts, no ResizeObserver), not from the screen, so an editor in a narrow
column, or in a composer's bottom bar where the attachment button shares the row, measures the room
it really has. The row no longer scrolls sideways; it wraps instead. Large (900 px and wider) shows
all 17 commands as buttons. Medium (575 to 899) keeps B, I, Link, Media, BB code, Undo and Redo as
buttons and puts the rest in three menus: Text (underline, strikethrough, inline code, remove
formatting), Paragraph (heading, bullet list, numbered list, quote) and Insert (spoiler, code
block). Small (420 to 574) keeps B, I, Link, BB code, Undo and Redo, and Insert also holds Media.
Extra small (below 420) keeps only Undo and Redo as buttons; Text also holds B and I, Insert also
holds Link and Media, and a More menu holds the BB code source: six 40 px controls is all that fits
in about 270 px, Undo and Redo stay, the three groups take three, so the source toggle is the one
left for More. From a 350 px bar the wide half of Extra small also shows B and I as buttons and
takes them out of Text. That half is an addition to the four sizes that were asked for: a 360 px
phone's bar is 326 px (16 px page gutters and a border) and the eight controls need 346 px, and a
375 px phone's is about 341 px, so those keep the narrow layout and only phones of 390 px and wider
gain; deleting the `xsWide` slots removes it and nothing else depends on it. The order is B, I,
Text, a divider, Paragraph, a divider, Link, Media, Insert, then BB code (or More), Undo and Redo at
the right; dividers only at Medium and Large; the icons are Type, Pilcrow, Plus and Ellipsis, and
every menu button but More has a chevron that turns when it is open. Link stays a button at Medium
(and Media too), although the plan listed both inside Insert there: it also keeps Link as a button
at Small, and following both lines would show more buttons at the smaller size, so the rule is that
a smaller size never shows a button that a larger one keeps in a menu (a test holds it, and XenForo
does the same). Medium's Insert therefore holds two items. The menus use the existing dropdown menu:
toggles are checkbox items with `aria-checked`, a menu button looks pressed while a command inside
it is on and is disabled while the BB code source shows (More stays enabled), and buttons and items
are 40 px high (32 px from `md`). Focus departs from the plan's literal wording, which asks for
"focus back to the trigger" and for "no focus loss" together, and a choice cannot satisfy both:
Lexical focuses the editor on any update that changes the selection, as the direct buttons already
did, so a command chosen by mouse, touch or keyboard leaves the focus where the command puts it (the
editor with its selection kept, or the BB code field), and `editor.focus()` runs inside the press so
that a phone raises its keyboard again. Escape and a press outside give the focus back to the menu
button. A first version forced the focus back to the trigger after every choice and took it off the
BB code field when the source was chosen from More by keyboard. A keyboard user loses their place in
the bar after a choice, as with the buttons. Known limits: below about 260 px the end group wraps to
a second line; the menus are in the editor's chunk, which is already loaded on demand; the keyboard
coming back on an iPhone after a menu choice, a choice inside the composer's dialog and the light
theme have not been tried on a device.

### Create flow: the whole screen at every size (item 6)  The Create button's dialog covers the
viewport at every size: from the top-left corner, as high as the visible height (so it follows a
phone's keyboard through `--visible-height`, 100dvh without it), with no box, ring or margin, on the
page's background. Only the Create flow does this (`ComposerSheet` takes `screen`); the reply and
edit sheets and the profile wall's own composer sheet keep their look and their dimmed overlay.
Every step sits in a centred column: the chooser and the forum list are `max-w-2xl` (672 px) wide,
and the writing steps (thread, question, poll, wall post, and their loading and failed states) take
the forum's width, `--container-width` (1420 px, 1100 px with the narrow page setting; the portalled
dialog carries `data-forum-layout` so the setting reaches it). From `md` the column is the card
colour with a border on each side, over a muted screen, so it reads as a column and not as a
stretched box. The screen is opaque from its first frame to its last. `DialogContent` has a new
optional `overlay` prop (true by default, so no other dialog changes) and the Create dialog passes
false, and its open and close animations are switched off with important utilities
(`data-open:animate-none!`, `data-closed:animate-none!`), so the result does not depend on CSS
order. Before that the page showed through, dimmed and blurred, during the 100 ms fade, and a
full-viewport blur was drawn under the screen at rest; the cost is that it appears and goes at once.
The chooser is a list on a phone (icon in a bordered circle) and, from `md`, a question ("What would
you like to create?", "¿Qué quieres crear?", `forum.createFlow.prompt`) over 2 x 2 tiles in the
middle of the column's height (`md:my-auto` inside the part that scrolls, so a taller chooser still
scrolls from its top); without it the tiles sat in the top 40 % of a 672 px column with an empty
strip below. The question shows in every state, so the "nothing to post" and failed messages have it
above them. The forum list that the composer's "Posting in" chip opens has the same 672 px width as
the forum step. In the thread and wall composers the editor's frame grows down to the bottom bar,
but the editable area does not: its @-mention list is placed under the text block (`top-full`), and
a stretched block would put the list below the screen. A press on the blank part below the text puts
the caret at the end of the text (the editor, the BB code source, or the plain box before the editor
loads). A press in the text, on a control or on the mention list, a press that ends a drag
selection, and a press while a selection exists leave the caret alone. The editor has no embedded
nodes (attachments are `[ATTACH]` text), so only text can be last. The writing column stays at the
forum's width, as decided: at 1440 px the composer is 1420 px wide, Close and Post are 1400 px apart
and the muted surround is a 10 px sliver; `WRITING` in `create-flow.tsx` takes `max-w-5xl` in one
token if the owner wants it narrower. Known limits: the blank press acts on click, so a phone's open
keyboard may drop and rise once; a desktop pinch-zoom shrinks the visual viewport and with it the
screen; the look on a real phone with the keyboard open has not been seen.

### One postbit for posts, messages and the member card (item 8)  `Postbit` is the one block that a
thread post, a conversation message and the member card all draw, with the same parts in the same
order: avatar with frame, name and group badges, the viewer's actions on the member (Follow,
Message), title, level and XP bar, the member's awards, then joined, posts and reactions. From `md`
it is the 10rem column (in the card, the popover from 48rem); below `md` it is the compact header
(in the card, the sheet). The card adds only "View profile" under the block. A test renders the real
thread rows and `loadMemberCard` for one member with a cover and awards and compares the markup; the
post is drawn inside a scope that turns the name and avatar triggers into plain links, so the
comparison covers layout, parts, order and classes, not the trigger wrappers. The cover belongs to
the block: from `md` it covers the whole height of the box that holds the block and fades downward,
and below `md` it is the strip behind the header (a highlighted post hides the column cover on a
phone, where its own whole-frame cover shows). The holder says how wide it is through
`--postbit-cover-width`: the frame sets the column plus its padding so the cover ends at the
column's border, and the card sets nothing, so the cover fills the card. The first build gave the
card the phone strip, with a horizontal fade made for a wide header, so one member had two different
covers. The existing cover strength is kept, since it does not lower the contrast of the name and
badges. Awards are one row of `sm` icons, three on a phone and five from `md`, then +N; the backend
already cuts them to the site's slots, so nothing changed there. Posts and messages now show Follow
and Message in the same place as the card. This overrides the line in "One action bar for every
item" that kept them on the card only: the plan asks for 1:1, with the card adding only "View
profile", and a build that followed the older line gave the card buttons that the post lacked. A
thread page and a conversation page, and the rows they add while open, read `users.relations` once
for the authors on the page, in parallel with the authors read: one call per 50 authors and a page
is 20. A guest asks nothing and gets nothing, a refused read drops the buttons only, and yourself, a
restricted member and a member with nothing allowed draw nothing; the viewer's own rows still being
sent have none. Costs: a signed-in viewer's post column grows by about 70 px (two stacked buttons),
and the absent Message button now shows, for a whole page and without a click, which authors have
ignored the viewer or take no conversations (the contract already allows this one member at a time
through `conversations.create`; flagged for the owner). The compact header has three lines: the name
with the highest group badge (the name keeps at least 12 characters,
`minmax(min(12ch,100%),max-content)`, and the line never wraps; the other badges show from `md`),
then the title and counts beside the avatar, which spans the first two lines, then, only when there
are awards or actions, a last line with the awards at the start and Follow and Message as two 40 px
icon buttons at the end. In the first version the awards and buttons shared the name's line, and at
320 px the name had 32 px (four characters) with its badge on a second line; now it has 113 px (15
characters) in a post and 139 px in the sheet, and 153 and 169 px at 360 px, measured in a browser
with the app's font. The price is a header 88 px high instead of 60 when there are awards or
buttons; if that is too tall, drop the awards from the phone line and keep the buttons at 40 px. In
the sheet the buttons are icon-only, as in a thread on a phone. Trade-off: in the compact header the
reading and Tab order (name, actions, title, awards) is not the visual order (name, title, awards,
actions). The column, where a keyboard is likelier, matches its order, and fixing the phone's would
mean drawing the awards twice or breaking the column's order. A restricted member keeps the minimal
card, and the backend nulls the cover and awards of a restricted author, so nothing private reaches
a post. Known limits: the card's cover is as tall as the popover's scrolling box, so a card that
scrolls would cover only its first screen; the styleguide's card demo rebuilds the card body by
hand; the look on a real phone, with a bright cover in light and dark, on a highlighted post, and
the follow error inside the 144 px column have not been seen.

### Home tabs on phones: icons, Trending, no wall composer (item 5)  Below `md` the home page draws
its own tab bar (`phoneBarOf`) in place of the pinned three-tab bar, for every viewer whatever their
default tab: Latest, Trending, Following (members only) and Forums in the fixed order, with Media in
the More menu unless it is the open tab, in which case it takes a place on the bar and More goes, so
the open tab is always visible. From `md` the wide bar (`barOf`, its pinning and its More menu) is
unchanged. The server cannot know the screen, so both bars are in the page and CSS shows one; the
hidden one is out of reach of assistive technology. Each phone tab has an icon (clock, trending-up,
user-check, messages-square, images, and an ellipsis for More), all `aria-hidden`. Below 640 px
(`sm`) only the open tab shows its label and the others show their icon alone, with the label kept
as the accessible name and as a `title` (the More button has one too); from 640 to 767 px every
phone tab shows icon and label. The threshold is `sm` and not about 400 px as planned: at 400 px the
bar is about 360 px wide inside, and five Spanish cells with icon and label need about 476 px
(English about 441), so labels would wrap or be cut at every width from 400 to about 540 px. Tabs
never wrap (`whitespace-nowrap`, for every user of the tab bar), and the segmented variant, which
carries the forum list's section tabs (named by an admin, also shown in the home Forums tab),
scrolls sideways inside itself with its scrollbar hidden, as the underline variant does, so long
titles do not push a 320 px page wider; the focus ring is clipped by about 1 px there. The tab
called Hot is now Trending wherever a member or an admin reads it: the tab itself (English Trending;
Spanish Tendencias, replacing En tendencia; the wide bar shares the labels), the member's "Home page
opens on" choice, the admin's default-tab choice, the help text of the economy and credits pages,
and the page title ("Trending threads"; the Spanish title already said trending). Only labels moved:
the ranking, the `hot` kind and `?tab=hot` are unchanged. The desktop sidebar card lists threads by
reactions on the opening post over 30 days (`threadsRanked`, `mostReacted`, not the hot score), was
also titled Trending, and is now Most reacted (Spanish Con más reacciones, like the forum statistics
tab); its rows show replies and views, not the reaction count, as the statistics panel does, and its
message keys keep their old names. The wall composer is hidden below `md` with CSS (it is still read
on a phone, because the server cannot know the width); a phone writes through the + button. The
phone bar's Home is current on `/forums` and on thread pages, which the removed Forums entry used to
cover (`mobile.home` has the match paths `/forums` and `/threads`, and `isActivePath` lets the root
entry use them; the header's Home is unchanged). `/forums` itself never shows the Forums tab open,
since the tab lives at `/?tab=forums`. The guest browse test on phones now clicks the Forums tab and
then visits `/forums`. Known limits: the 320 px fit is checked by a phone end-to-end flow
(`home-tabs.e2e.ts`) and has not been seen on a real phone.

### Unread counts as numbers; Messages and Alerts as header buttons (item 7)  One `CountBadge` (in
`components/ui`) draws every unread count: 1 to 99, then 99+, nothing at 0, as a small rounded
rectangle in the accent colour, 11 px bold, with a 2 px ring of the page background, over the
top-right of its icon. It is hidden from screen readers because the control it sits on already says
"N unread" (`Alerts, 3 unread`; the phone bar's link has a screen-reader-only ", 3 unread"), so the
count is heard once. On the phone bar the number replaces the dot on Messages and Alerts and appears
on no other entry; 99+ fits a 64 px cell, 2 px inside its edge at 320 px. The phone bar's Messages
entry now uses the envelope too, so the same control is not a tray at 767 px and an envelope at 768.
Members get two header buttons from `md` up, before the avatar: Messages (envelope) and Alerts
(bell), each with its number and its own panel holding the latest rows (loaded when the panel opens;
the list code is a lazy import, so only the buttons are in every member page's first load) and the
existing footer actions (View all and New conversation; View all and Mark all as read). Counts
follow the counters poll and the server's redraw after a read (opening a conversation, mark all
read, following an alert). A guest's header gets none of this. The avatar is for the account only:
it carries no badge, loses its Alerts and Conversations tabs, which would be exact duplicates of the
buttons, and keeps Account and Bookmarks (XenForo's own pair, labelled with words), always opening
on Account. The staff panel's top bar shares the account menu and has no phone bar, so it shows the
two buttons from `sm` up; below that the section title needs the room (130 px at 320 px) and the
logo leads to the site, whose phone bar has both; its counts are drawn at page load and do not poll.
With the two buttons a member's corner ended 68 px past the content edge of a 768 px screen and the
avatar went off it, so between `md` and `lg` a member's header compacts: Create is a 40 px square +
(its label returns at `lg`), Create, Messages, Alerts and the avatar sit 4 px apart (`gap-1`, then
`lg:gap-2`), a drawn logo shows its mark only, and a picture logo is capped at 72 px wide with its
proportions kept. The server decides this from the viewer (`HeaderLogo` waits for the request's
viewer, with the guest-shaped placeholder meanwhile), not CSS after the corner arrives, so a guest's
logo, gaps and corner are as before; the cost is that the logo streams with the request. The header
navigation, for every viewer, scrolls inside itself with no visible bar when an admin's entries or a
long site name do not fit, so the page never scrolls sideways; with the five seeded entries it does
not scroll from 768 px up, and a guest whose header already overflowed now scrolls only the
navigation. The member's corner loads in its own shape (two 40 px slots with the real buttons'
visibility classes and a 64 px avatar slot); the outer fallback shown until the viewer is known is
still the old box, so one step of about 70 px remains at `md`. Spanish: the button and its panel say
"Notificaciones", like the page and the old tab, while the phone bar keeps "Alertas", whose text
comes from editable navigation entries and which "Notificaciones" would cut at 64 px
("Notificac..."). Known limits: a 160 x 24 wordmark capped at 72 px is about 11 px high; a site
whose admin removes the phone bar's Messages and Alerts entries leaves phone members no menu path to
those pages (the pages, alert links and the desktop buttons remain); the last entries of a scrolling
navigation need Tab or Shift+wheel to reach; a staff bar between 640 and 767 px with a long site
name has a title of about 110 px; the look in a browser, the change in first-load size and a real
phone have not been checked.

## Admin panel redesign

### Panel sections, landing pages and the shared page patterns (item 1)  The panel's navigation is
regrouped into eleven sections after its home, in this order, each screen in exactly one (detail
screens, `listed: false`, in brackets; no address moved, no gate changed, `registry.test.ts` holds
the old address and rule of every screen and fails on any change):
Setup: general, home page, new members, anti-spam, uploads, search engines, site identity, levels,
cookies, public navigation. Content: reaction types, word filters, tags, static pages [static page].
Forums: categories and forums, thread prefixes [forum, forum permissions]. Communication: send alert,
notices, notification defaults, email policy [new alert, notice]. Users: members, ban register,
warnings (`/admin/settings/warnings`, which moves here from Setup and keeps its address) [batch
update, the member and its eight tabs]. Groups and permissions: user groups, group promotions, group /
member / forum permissions, analyse permissions, moderators, administrators [group, promotion,
permissions of a group, of a member]. Appearance: frames, covers, thread covers, accents, name
colours, prefix colours. Economy: credit rules, credit adjustment, award definitions, award grants,
shop categories, shop items [award, shop item]. Tools: maintenance. Logs (new, split from "Tools and
logs"): moderator log, promotion history, credit ledger, shop purchases, background tasks; their
keys keep the `tools` prefix, as keys are ids. Moderation: overview, reports, approval queue,
sign-ups, IP addresses [report case, reported message, item review]. There is no screen for forum
tabs, so Forums has none.
Each section has a landing page: link cards (icon, name, one line) to its listed screens that the
viewer may open. In the registry it is a screen with `landing: true`, at `/admin/sections/<id>`
(one static route per section, a prefix no screen uses, so no slug can meet a screen's address;
`/admin/forums` or `/admin/users` would have), opening for anyone who may open one of the section's
screens. Moderation's landing is its existing overview at `/moderation`, keeping its own rule, so a
member who may open only the IP screen sees the section without a landing. `visibleSections` gives
the landing apart from the screens. The sidebar and the phone drawer (the same component) are an
accordion: the section of the current page is open and cannot be closed (its arrow is marked
`aria-disabled`); a section's name links to
its landing and the arrow next to it opens or closes it; a section with no landing for the viewer
opens from its whole heading; the home, and a section whose landing is all the viewer may open, are
plain links. Every section carries an icon (`(staff)/section-icons.ts`, apart from the registry the proxy
reads). The home keeps its five blocks; its section grid is now the same cards, each leading to the
section's landing with the section's screens as links under its line. The moderation overview shows
its screens as the same cards.
The patterns, all in `src/components/staff` with tests next to them; every screen moves onto them in
its own item:
`PageHeader({ trail, title, description?, actions? })` tops every page. `trail` comes from
`staffTrail(path)` (`(staff)/trail.ts`, from `trailOf` in the registry): home, the section's landing,
then each screen of the same section the address lies under, only those the viewer may open; a page
that names a record appends or relabels steps. From 768 px it is a breadcrumb, on a phone one
"< parent" link; passed as a promise it streams in without holding the title. Actions sit at the
top right from 640 px and under the title on a phone.
`ScreenFrame({ heading, subtitle?, trail?, actions?, label, fallback })` wraps every page: with a
trail or actions its heading is that `PageHeader`, the content streaming in below; without, the
plain heading of the screens not moved yet. The landings use it; a page with a trail has
`HeadingSkeleton trail` in its `loading.tsx`.
`ItemList({ label, heading?, description?, items, filter?, empty })` is the list screen: clean rows
(`ItemRow`: icon, title linking to the edit page, description or key, badges, toggle, actions),
an empty state with an optional "Add" action, and a "Showing N" footer. `filter` adds a box that
narrows the rows on the page (case and accents ignored, by `search` or a text title); lists the
backend pages through keep their own search. A row's `actions` hold short controls and closed
`ConfirmStep`s (an open step takes the row's whole width); `panel` holds a full line under the
row. The title keeps at least 10rem: when the controls would leave it less (a phone), they go to
a line of their own under it. `RowToggle` is the active switch: a
form that submits the screen's existing action with its hidden fields and the flipped value under
`field` (default `active`, "1" or "0"); with `confirm` the switch first opens a warning with a
confirm button (destructive with `danger`) and Cancel; a refused save keeps the step open, one
that goes through closes it and gives the focus back to the switch (`keepsAsking`). Errors show
under the row. `RowLink` is the
row's icon link ("Edit").
`EntryList`, `EditDisclosure` and `Row` stay for the screens that use them until their item moves
them.
`EditForm({ action, submit?, disabled? })` is the separate Add / Edit page: `FieldGroup` cards
(fieldsets with a legend), `Field` rows (label and help on the left, control and error on the
right from 768 px, stacked on a phone), one `Advanced` closed card for the rare options (it opens
again on every save refused with an error on one of its `fields`; no `required` control inside
it), and the save bar at the
bottom (`SaveBar` from `form-rows.tsx`, now exported). It takes the same `StaffFormState` actions
as `FormRows`.
`SortForm({ action, name, items, heading })` is the sort page: up and down arrows, one Save, sent
to the screen's existing order action under its own field name (`name` such as "position.{id}",
plus any hidden `fields` the action compares, like `before:<id>`). It hands the entries' own numbers
out again in the new order, so only the moved entries change; numbers shared by two entries are
renumbered ten apart (`positionsFor`). After a move the keyboard stays on the pressed arrow of the
moved entry (`focusKeeper`). No drag and drop.
`LinkCards` / `LinkCard` are the cards of the landings and the home.
The client components' text is in `admin.itemList`, `admin.editForm` and `admin.sortForm`; a
layout may name only namespaces something under it reads (`tests/client-messages.test.ts`), so the
item that first uses one of them adds it to the staff layout's `ClientMessages`. The styleguide's
layout now sends `admin.shell`, which the navigation reads for its arrows' names. Known limits:
the styleguide shows none of the new patterns yet; the look in a browser, on a phone and the
first-load size have not been checked; the filter box only narrows the rows already on the page.

### Reaction types on the shared patterns (item 2)  `/admin/reactions` is now a list of clean rows:
the picture or emoji (through the LITE gate), the label linking to the type's edit page, the score
as a signed badge (+1, 0, -1; green, grey, red), a "Not offered" badge, a line saying what limits
the type (a picture or an animation and its frames, the number of forums, a rule), the offer switch
(`RowToggle` with a confirm step, the same `setReactionTypeActive` and fields) and an Edit link.
"Sort" and "Add reaction" are the header's actions. Three detail screens join the registry with the
list's own gate: `/admin/reactions/new`, `/admin/reactions/sort` and `/admin/reactions/[id]`. The
new and the edit page share one set of fields (`reaction-fields.tsx`): a "Reaction" card (emoji,
label, picture, score; on the new page also position and "offered"), then two closed cards,
"Animation" (frame width, height and count, each with its help) and "Access" (rule, forums, what
excluded members see); every field goes to the same action as before. The edit page fills the
frames from the type as the backend holds it, not from the LITE-filtered copy, since its action
always sends them: an administrator who blocks reaction pictures would otherwise clear the cut on
save. The sort page is `SortForm` over `saveReactionOrder`. The type's position, typed by hand in
the old order form, is now set by the arrows; the new page keeps its position field. The old
per-row forms are gone (`row-form.tsx`), so `adminContent.reactions` is no longer sent to the
browser. Known limits: the Access card's rows are `FieldRow`s (the shared `RuleField` draws
its own), with a narrower label column than the `Field` rows of the other cards; a rule
condition's number is `required`, so one left empty in the Access card, closed again, may stop
the save out of sight.

### Appearance screens on the shared patterns (item 8)

The six appearance screens (frames, covers, thread covers, accents, name colours, prefix colours)
are a list, an add page and a page per entry each; the last two extend the list's address (`/new`,
`/<id>`), are `listed: false` in the registry and carry the list's `access`. No list address moved.
The editor that used to open under a catalog row as `?edit=<id>` is a page now, and that address
redirects to it (the redirect is made while the page streams, so it is a client-side one, not a
307). A list row is the picture or colour dot, the name linking to its page, the order (and a
frame's placement numbers), an active or inactive badge, a "waiting for a picture" badge, an edit
link and the delete step; the filter box is on. The entry page is an `EditForm`: name, picture
(replace), display order and active in the first card; a frame's placement editor is the collapsed
advanced card (it opens by itself when the backend could not measure the picture). The colour pages
have name, colour (and an accent's text colour) with the live preview on both surfaces, display
order and active, and above the form the "in use" line with the colour drawn by the public site's
own pieces. The server actions are untouched: this screen had no order action and no set-active
action, so there is no Sort page and no row switch. The order stays a number on the entry page and
the active state a checkbox in its form (the badge only shows it). Owner gap: an order action and
a set-active action for the appearance screens would allow the Sort page and the row switch the
other lists have. Known limits: the screens have not been looked at in a browser or on a phone; a
frame drawn in a row is cropped to the 40 px picture box when its placement overhangs it.

### Groups, promotions and staff on the shared patterns (item 4)  The groups list, the promotions list
and the two staff lists (moderators, administrators) are `ItemList`s under a `PageHeader` with its
trail; the group and promotion forms are `EditForm`s (cards: general, appearance or rule, and a last
one for the administrator's password). Nothing was removed: each row keeps its links (edit, the
group's permissions when the viewer may open them, the member's permissions and, for moderators, one
link per forum), the promotions screen keeps "Run now" and the link to the history, and the group
and promotion pages keep the delete step with the password. The edit pages stay at `/admin/groups/<id>`
and `/admin/promotions/<id>`. "New group" and "New promotion" open pages of their own, `/admin/groups/new` and
`/admin/promotions/new`, each a detail screen of the registry (`groupsNew`, `groupsPromotionNew`, unlisted, with
the access of its list; a header and a trail ending in the list). Neither list has a Sort page (no order
action exists for them) nor an active switch for promotions (the flag is saved only with the whole
rule, so it stays a badge on the row and a checkbox in the form). The password row is a local
`ConfirmField` (the form-field layout of `EditForm`, which `ConfirmPassword` does not have yet); the
rule row of a promotion is still `RuleField`, so its label column is narrower than its neighbours'.

### Forums on the shared patterns (item 6)  `/admin/forums` is a filterable list of the tree (the
depth as dashes before the title; edit, permissions and public-page links per row), with Sort, Add
category and Add forum in the header, and the forum list tabs as a second list below it (edit link,
delete behind its confirmation, "Add tab"). A new category or forum is `/admin/forums/new/<category|forum>`;
a tab `/admin/forums/tabs/new` and `/admin/forums/tabs/[id]`; a prefix `/admin/forums/prefixes/new` and
`/admin/forums/prefixes/[id]`; all `listed: false` with the gate of the list they belong to. The node
editor keeps its address: identity and posting limits in two groups, read only and the two approval
switches in the closed advanced card, then the pictures form and the moderators as sections of their own
(the minimum age and post count stay outside the card because their fields are required). The sort page
`/admin/forums/sort` is one form with one Save and one list per parent, because a node's number only counts
among its siblings; each list moves on its own and the form posts the unchanged `saveOrder` fields, which
returns to the tree. Prefixes keep
their order as a number in their form: the backend has no order action for them, so they have no sort
page. The prefix pages hang from the section, not from the tree whose address they share
(`prefixTrail`). Tabs have no screen of their own, as recorded in item 1.

### Economy on the shared patterns (item 9)  Credit rules, award definitions, shop categories and shop
items are lists of clean rows (`ItemList`): the name leads to the record's own page, badges show
the state (active or not; a rule's signed credits; an award's tier and "automatic"), a line says
what it does (the event, the limit and the forums of a rule; the XP, credits and holders of an
award; the effect, price and stock of an item), and every row keeps an Edit link and a delete
confirm step on the same action as before. Adding and editing are separate pages with the list's
gate, registered as detail screens: `/admin/credit-rules/new` and `/[id]`, `/admin/awards/new`
(the edit page already existed), `/admin/shop/categories/new`, `/sort` and `/[id]`,
`/admin/shop/items/new` (likewise). Their forms are `EditForm` cards; the page title of an edit
page is the record's name. Rare options sit in a closed `Advanced` card: an award's icon key and
"stackable", a category's access rule, an item's position and access rule (an award's automatic
rule has a card of its own, as it is what makes the award automatic). The shop categories are the
only list with an order action, so only they get a Sort page (`saveCategoryOrder`, with the
`before:` and `title:` fields it compares); rules, awards and items have no order action, so an
item's position stays a number in its form. None of the four has a set-active action, so there is
no row switch: the active badge stays and the checkbox stays in the form. The old inline editors
(`?edit=<id>` on the rules and categories lists) redirect to the record's page. The "Add item"
link carries the category being shown, and an item's page keeps a "back to the items" button for
that category. Credit adjustment and award grants keep their member picker and review steps and
only gain the page header and breadcrumb. Known limits: the effect fields of an item and the rule
builder are `FieldRow`s inside `Field` cards (a narrower label column); a rule condition's number
is `required`, so one left empty in a closed Advanced card may stop the save out of sight; the
look in a browser and on a phone has not been checked.

### Content and communication on the shared patterns (item 10)  Pages, tags, word filters, alerts,
notices, notification defaults and email policy all sit under a `PageHeader` with its trail. Pages,
tags, word filters, alerts sent and notices are `ItemList`s; Add and Edit are pages of their own,
`EditForm`s, each a detail screen in the registry with its list's gate: `/admin/pages/-new`,
`/admin/word-filters/new` and `/[id]`, `/admin/notices/new`, `/admin/tags/[id]`; the alert form and the
notice and page editors keep their addresses. The old `/admin/pages?slug=<slug>#new` (the link of a
suggested page) redirects to `/admin/pages/-new?slug=<slug>`. Notification defaults and the email
policy stay one form each. Nothing was removed and no action changed: every row keeps its edit link
and its delete step, rename and merge of a tag are two forms on the tag's page, a notice's dates sit
in the closed `Advanced` card, and the word filter's word is shown but fixed on its edit page (the
backend keys filters by word). None of these screens has an order action or an action that only flips
the active flag, so there is no Sort page and no row switch: active or inactive is a badge on the
row and a checkbox in the form. Limits: the backend lists tags only by name, so the tag's edit
link is `/admin/tags/<id>?name=<name>` and the page checks the id against the tag found by that name
(the registry's `[name]` pattern admits plain ASCII only, which a tag name need not be); a page
whose tag name no longer matches goes back to the list. The new page's address starts with a
hyphen, which no slug can, so a static page called `new` still has its editor at
`/admin/pages/new`. The notice form's rule row is still `RuleField`, so its label column is narrower
than its neighbours'.

### Tools, logs and moderation on the shared patterns (item 11)  Every screen of Tools, Logs and
Moderation now opens with `PageHeader` and its breadcrumb (`ScreenFrame` with `staffTrail`; the
three case pages of Moderation use `PageHeader` directly, and their "back" links are the
breadcrumb's last step). No address and no gate moved, and no screen got an edit or sort page:
none of them has records to add, edit or order, and their server actions are untouched.
Maintenance is an `ItemList` of operations, each row holding its confirm step (the spam cleanup
row holds the chosen member and its step in `panel`; the member search stays a card under the
list). The reports, approvals, sign-ups and IP lookups keep the backend's own filters and cursor
paging, so they use `ItemList` rows inside `QueueList` (`moderation/queue-list.tsx`): the filter
form in a card above, the rows, then the first-page and next links; `CursorList` stays for the
other screens. A report or approval row's title links to its case, with an eye icon as the
second link; a sign-up row keeps its tick and its decide controls, its facts sit in the row's
`panel`. The logs keep `LogTable` (their `LogShell` now carries the breadcrumb) and the tasks
screen keeps its counts and failure list. `admin.itemList` joins the staff layout's client
namespaces. The loading files draw the breadcrumb's placeholder (`LoadingPage trail`).

### Permission screens: tabs, bulk buttons and the changed counter (item 3)  The permission
matrix (groups, members, a group or member on one forum) splits its rows into two tabs, "General
permissions" (every backend category but `moderation`) and "Moderation" (Base UI tabs: arrow keys
move, Enter or Space opens, visible focus). Both panels stay mounted while hidden, so every row is
still posted and `matrixChanges` still sends only the cells that differ from their `was` field. A
tab with no rows is left out and one tab alone has no tab list: on a forum only node-scope
permissions show and none of them is a moderation one, so a forum shows the general rows alone.
Each tab and each category holding a yes/no permission has "Allow all", "Never for all" and "Clear
all (inherit)": they set every yes/no row of their tab or category, rows the filter hides included
(a line says so while it is on), and never an integer row; "No" stays a per-row choice on a forum.
The matrix keeps its cells in state (`matrix-state.ts`); `cellValue` / `cellChanged` in
`permission-entries.ts` are the one reading of a cell, used by the action and by the counter, so a
row counts as changed exactly when saving would send it (an integer with no valid number counts
too: saving it is refused). A bar under the panel's header holds the tabs and "N changes not
saved"; a changed row is tinted and says what it was. The filter box, the "Set here" mark, the
password and the save are as before. The group list is an `ItemList` (title and rank, as before);
the entries set on a forum are `ItemList` rows (chips in the row's panel, edit and analyse links);
every permission page has the page header with its breadcrumb, and a group's or member's page has
"Edit the group" or "Analyse" as its header action; the forum picker, "Add a group" and the analyse
question are `FieldGroup`s of `Field`s. Known limits: the member search (`MemberPicker`) still draws
`MemberRow`s, as four other screens share it; the forum editor stays on the forum page's address
(`?node=&group=`), where the save action sends it back; the look in a browser and on a phone has not
been checked.

### Members and bans on the shared patterns (item 5)  No address moved and no gate changed, so no
redirect is needed. The members list (`/admin/users`) and the ban register (`/admin/bans`) are
`ScreenFrame`s with a trail; the list's "Batch update members" link is its header action. Their
rows are `ItemRow`s (avatar, name linking to the member's page, state and group badges, a line of
details, "Open" and "View profile" links, the ban's lift step as a row action). Both lists page
the backend by cursor and filter in it, so the client-side filter box of `ItemList` stays off:
`users/paged-items.tsx` (`PagedItems`) puts the existing GET filter form in a card above an
`ItemList` and the "Back to the first page" / "Next" links below it, keeping the other
parameters and a named `cursorParam` when two lists share a page (the sanctions and economy
tabs); it also serves their warnings, bans, ledger, inventory and awards lists. A member's header
is a `PageHeader` (trail: home, Users, Members; the avatar and name as title; state, roles and id
under it) above the tab strip, which already scrolls sideways on a phone. The tab forms (details,
groups, super admin, profile, appearance, warn, restrict, ban, adjust credits, grant award) are
`EditForm`s with one `FieldGroup` each; `users/admin-password.tsx` is the administrator's
password in the edit form's field layout, as `ConfirmPassword` still draws the older row. Lists
inside the tabs (pictures, sessions, restrictions) are `ItemList`s. Left as they were: the batch
update's two-step form (only its header moved), the erase block (a closed danger card with its own
form), the thread-ban lookup, the read-only consent and acceptances cards, the history log table,
and the permissions tab (item 3). The Add forms of the member tabs (warn, restrict, ban, grant
award, adjust credits) stay inline under their lists on the tab, not on pages of their own: each is
an action on the member whose page is open, the member is fixed by the page, and a route per action
would pull the form away from the list it changes and be a new screen, not a move. The members list
keeps the name as the site draws it (colour, icon, member card) as the row title, with "Open"
leading to the member's page; the ban register's title leads to the member's page and a "View
profile" link leads to the public one. The "tell the member" box and message of the warn, restrict
and ban forms stay in the main group: the box is a choice made on every save. No other option is
rare enough for `Advanced`.

### Settings and navigation on the shared patterns (item 7)  Every option group of the settings is
its own page (general, home page, new members, anti-spam, uploads, search engines, site identity,
levels, cookies), at the address it always had, with the shared header (trail, title, line) and
`EditForm`: `FieldGroup` cards with the help on the left of each field from 768 px, one save bar,
and the confirmation a save redirects with above the form. The switcher between the groups is a row
of links (`TabLinks`, the underline variant) under the header that scrolls sideways on a phone and
marks the open group with `aria-current`; a row of links was chosen over a select because every
group is one tap away and the open one is always visible. Its labels are the registry's.
Warnings (`/admin/settings/warnings`) are one of the settings pages and move onto the same header
and `EditForm`. The types and the automatic actions are lists of rows (`ItemList`) with the delete step
on the row; "Add type" and "Add action" are in the header, and each record has its own page
(`/admin/settings/warnings/types/new` and `/<id>`, `/admin/settings/warnings/actions/new` and
`/<id>`), screens of the Users section with the list's gate (`admin.settings`). They show no
switcher: the sidebar keeps them under Users
and their breadcrumb says Users, so a row of Setup groups above them would contradict where the
administrator is. The switcher lists the nine Setup groups; it scrolls the open group into view on a phone.
The section titles that used to be sub-headings inside one long panel are now the legends of the
`FieldGroup`s; no setting is in `Advanced`, because every setting here is one an administrator
reaches for (several are required numbers, which `Advanced` may not hold). `RuleField` is shared
with other screens and still draws its row as before, so on the home page and anti-spam forms the
rule rows have a narrower label column than their neighbours.
Public navigation: the list shows one card of rows for each place, a top-level entry and then the
entries under it (the row says "Inside <entry>"), each row a link to the entry's own page with its
badges (built-in, off) and, for an entry that is not built in, the delete step on the row. "Add
entry" (`/admin/settings/navigation/new`) and "Sort" (`/admin/settings/navigation/sort`) are in the
header; an entry is edited at `/admin/settings/navigation/<id>`. All three have a detail screen in
the registry with the list's own gate (`admin.navigation`). The add page asks for the place, title,
target, icon, parent, who sees it and whether it shows, with the display order in `Advanced` (the
sort page makes it rare); the edit page asks for the fields the entry's own save always sent (title,
audience, permission, icon, icon side, shown), the place, target and parent being fixed at creation
as before. The sort page has one `SortForm` for each group that is ordered against itself (the
top-level entries of a place, and the entries under one heading), all through the existing order
action, which sends only the numbers that changed; a group of one has nothing to order and is left
out. The per-row "on" switch of the old list moved to the edit page: a switch on the list would need
an action of its own, as the entry's save reads a ticked box and requires the audience. The
breadcrumb of the three pages is drawn without "General" (`navigationTrail`): the registry puts it
there because the addresses share `/admin/settings`.
Known limits: the look in a browser and on a phone, and the first-load size, have not been checked;
the list's filter narrows each place's card on its own.

### Sticky site header (item 13)  The public site's header now sticks to the top of the window
(`sticky top-0 z-30 border-b bg-background`, the staff bar's own classes), at every width. Menus,
panels and popovers are portaled at `z-50` and dialogs and sheets are `z-50` too, so they open above
it and cover it; the bottom navigation (`z-40`) and the cookie banner (`z-45`) are at the other edge.
`--spacing-site-header` (56px and its border) is the one place that knows its height: on a page of
the forum, `scroll-padding-top` on the root keeps every jump (an address's anchor, `scrollIntoView`,
`j` and `k`) below it, added to each target's own `scroll-mt-*`. Two things that assumed the top of
the window follow it: the "new entries" button of an infinite list floats under the header, and
its scroll to the top of the list, and `itemAtWindowTop` (the item the reader is at), allow for it.
The staff panel is untouched.

### Coherence pass (item 12)  One pattern for each thing every staff screen does, and the local
copies gone. No address, gate, server action or screen's behaviour changed. Loading: one
`LoadingPage({ label?, children })` and the list, form and edit-form skeletons
(`EditFormSkeleton({ rows, advanced, heading })`) live in `(staff)/skeletons.tsx`; the five local
loading wrappers and the per-area skeleton files are gone. `ScreenFrame` always draws `PageHeader`
(the old plain heading is gone) and takes `nav`, a row drawn at once above the streamed content:
the settings switcher uses it, so it no longer waits for the settings to load. Paging:
`components/staff/paging.tsx` (`PagingLinks`, `listHref`, `cursorFrom`) is the one set of
first/next links; `ItemList` takes `paging` (links in its footer, the count read as "N on this
page" while more pages follow) and `action` (a button at the end of its heading); `PagedList` is a
filters card above an `ItemList`, for the lists the backend pages (bans, members, the member's
economy and sanctions, reports, approvals, sign-ups, IP lookups). Paging links drop a save's
`notice`. Header buttons: `HeaderLink`, `AddLink` (primary, plus icon) and `SortLink` (outlined,
arrows) in `page-header.tsx`, at `min-h-10` on every page; a header has one primary action, so a
second add is `AddLink secondary` (outlined, forums and warnings); add buttons read "Add X", the
pages they open "New X" and their forms submit with "Create X", in both languages; an empty list
offers the page's own add button. Form rows:
`Field` (now `components/staff/field.tsx`, re-exported by the edit form, with an optional `error`)
is the only row; `FieldRow`, `entity-list` and `entity-rows` are gone. `ConfirmPassword` draws a
`Field`, so the account's delete confirmation shares that layout. `SortRow` (from `sort-form.tsx`)
draws the forums sort page too. `Advanced` opens when the browser stops a save on a field inside it;
a switch's confirm step opens on Cancel; row icons are not clipped. Empty-state titles that carry a
description read as headings, without a closing period. Message keys nothing read are removed.
Two suites (`credits/shop.test.tsx`, `tests/lite-runtime.test.tsx`) put back what they replace:
with Bun, a module namespace taken before `mock.module` follows the mock, so it is restored from a
spread copy taken before mocking.
Known limits: the look in a browser and on a phone has not been checked; many other suites still
restore from the namespace itself, and `account/profile-permissions`, `account/profile-forms` and
`account/security/delete-account` tests leave mocks that break staff suites run after them.
