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
