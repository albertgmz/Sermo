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

**Post positions.** Positions count visible posts only. A hidden post keeps its number and
later posts shift down by one (see the `posts.position` comment in
`packages/core/src/db/schema.ts`). Any page is then a single index range. Hiding or restoring a
post rewrites the positions of the rest of that thread, so post bodies live in a separate
`post_bodies` table: shifting 10,500 rows that carry their bodies measured 400–870 ms, while
narrow rows shift in single-digit milliseconds. Pages are capped at `limit` rows and continue
with a `(position, id)` cursor, so a moderator's view of a thread full of deleted spam stays
bounded.

**Unread state uses post and message ids, not positions or timestamps.** Positions shift when
posts are hidden or restored, and timestamps can tie; ids only grow. Threads whose last post is
older than 30 days count as read, so a new account does not see the whole forum as unread and
old `thread_reads` rows can be purged.

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

**Sessions have a fixed 30-day lifetime** with no sliding refresh, since refreshing would mean
writing during reads. Session and API tokens are 256-bit random values; only their SHA-256 is
stored (fast lookups, and safe because the tokens have full entropy).

**Passwords: argon2id, 19 MiB, 2 iterations** (the OWASP minimum). Bun's default (64 MiB)
takes longer than the 50 ms write budget allows for login and registration. Tests use the
cheapest settings.

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

**API tokens cannot create or revoke tokens, or log out sessions.** A leaked token should not be
able to mint more credentials.

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

**What the benchmark measures:** each scenario's wall time around one request, server-side:
input validation, the service, and JSON serialization, and the HTTP adapter once it exists.
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
