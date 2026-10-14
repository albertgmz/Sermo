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
posts. Needs owner review.

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
cannot warn themselves. Content moderation is not ranked. Owner review.

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
email value for those types has no effect. Owner review: independent channels would need notice
rows for members with in-app off.

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
stopped at zero, spending first would dodge them. Owner review.

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
content they did not remove. Reply rules are bounded by their limits. Owner review.

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
query (or a per-member timer) on the one path that must stay a memory lookup. Owner review.

**An item that was bought keeps its effect, kind and duration**, and an item or award that was
ever bought or granted can only be deactivated, not deleted: members hold what they paid for, and
the purchase log and grant history keep their references.

**Gifts are decided at purchase.** The purchase stores buyer and recipient separately; the charge
goes to the buyer and the item to the recipient's inventory. An item already in an inventory
cannot be given away.

**No hierarchy condition on `credits.adjust` and `award.grant`.** Giving credits or an award is
not a sanction, and with the condition the only administrator could not credit themselves or a
colleague. The cost is that a moderator given `credits.adjust` could debit an administrator.
Owner review.

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
reads of permissions and promotions go through `readWithCurrentActor`. Known limit: reports,
`moderation.setState` and `moderation.bulk`, word filters, settings, awards and the forum
moderation writes (lock, move, merge, split, delete) still decide with the actor resolved for the
request; the window is one request. A moderator who lost sight of the node gets NotFound from the
thread-ban operations, as before the transaction.

**Positions returned while a merge renumbers are decoded.** A merge stores a final position `p`
as `-(p+1)` until it flips; `thread.lastPost.position`, `posts.get`, the post listings and search
return the decoded value. Known limit: `posts.list` still pages on the stored column, so posts
already renumbered are missing from its pages until the merge ends (or is retried after a
failure), `threads.markRead` looks up by the stored value, and during the streams phase a post
not yet processed shows its position from before the merge.

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
required and checked on the server; acceptance is not recorded. **Owner review.**

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
follow the entry's active flag. **Owner review.**

**A frame's placement is measured at upload** (`modules/images/frame-geometry.ts`) and stored
with the file; `catalogImages.create` uses it unless a placement is given, and the administrator
can adjust it afterwards. The rule was recovered from the 93 frames the frontend shipped and its
hand-generated table: it reproduces 45 of them within half a percent and 86 within about two.
It proposes; it does not replace looking at the preview. **Owner review.**

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
week's most reacted-to posts. A reader merges the rankings of the forums the viewer can see,
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

**Referrals: a member names their referrer once, in their first seven days**
(`users.setReferrer`). The frontend counted referrals in leaderboards and standings but had no
way to create one; this is the smallest real behaviour behind those numbers. **Owner review.**

**Reputation and vouches are not built.** The frontend displayed both and nothing could ever
change them (new members got 0; only the demo data had values). Reputation is shown as the
existing reaction score; vouches are dropped from the screens. This departs from assumption A5,
which asked for both to be built with the frontend's behaviour as the specification: there is no
behaviour to specify. **Owner review.**

**A birthday publishes its day and month only.** The year is stored for the member and never
returned to others.

**An award's picture is a backdrop, its icon a glyph.** The round award icon (next to a name, on a
profile, in the panel) always draws the glyph of the award's icon key in the colours of its tier.
The picture is a wide banner drawn behind the award's card on `/awards` and behind the heading of
its own page. For a while the icon showed the picture when the award had one, which cropped the
middle of a 16:9 banner into a circle and pushed the emblem of every starter award to its right
edge. One picture cannot serve both shapes; a square picture for the icon would be a second file.

**Messages and alerts open as panels on phones too.** The inbox and bell icons of the header open
the same drop-down panel at every width (the latest items, a link to the full page, and the
panel's action), as forum software commonly does. Below `md` they used to be plain links to
`/conversations` and `/notifications`; the bottom bar still links to those pages, so both ways
remain. The panel is capped at the width of the screen less a small margin. Search stays a link
on phones: its panel is a form, which the search page already is.

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
member could rename themselves freely through that endpoint. **Owner review.**

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
the existing "has bought item" criterion does that without new code. **Owner review.**

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
referred lose their `referred_by`/`referred_at` (a referred member can then name a referrer again
inside the first seven days) and the erased member's own count becomes 0. The month standings keep
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
matched by address alone); the cursor carries the position. **Owner review.** The rosters read each
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
`actorPassword` gets a validation error naming the field. An API key or token is not asked and is
refused if it sends one (it cannot confirm). Actors built by hand (the starter loader, the dev
fixture, jobs, tests) never carry the marker and are not asked; a new caller that resolves
sessions from cookies and should be held to the rule must set it. The promotion writes are
included because a promotion grants groups to members. Group names stay readable without it.
**Owner review:** API keys are exempt, so a stolen key can change groups and permissions without
the password; the alternative is to forbid these writes to keys altogether. The exemption is only
as good as the difficulty of getting a key, so a key can no longer be had with a cookie alone: see
"API keys are credentials" below. `DELETE` routes read
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
posts, naming a referrer) are not covered: they are the members' own, and an erased account is
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

**API keys are credentials.** A key acts without the password rule, so walking around the rule
by minting one from a stolen browser session had to be closed. `POST /api/auth/api-key/create`
from a session now needs the member's current password in the body (`{ "name": "...", "password":
"..." }`): a missing one is a 400 (`PASSWORD_REQUIRED`), a wrong one a 403 (`INVALID_PASSWORD`),
and the answers are counted with the same limits as `actorPassword` (five wrong per session,
twenty per member in fifteen minutes; a further answer, right ones included, is a 429). A call made
in-process with a `userId` and no session (loaders, tests) is not asked. A member's own change of
password, a reset by link, an administrator setting the password and an administrator signing the
member out of every session each revoke all the member's API keys; revoking one session by id does
not. What a key can and cannot do:

- A key acts with the permissions of its member, on every operation that does not ask for a session.
  That includes the group, permission and promotion writes that otherwise take `actorPassword`
  (the key is not asked, and refused if it sends one: the Owner review item above).
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
in the commit that is merged. The `version` fields of the packages are not maintained and nothing
reads the file yet: it is the number a person or a release note names.

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
