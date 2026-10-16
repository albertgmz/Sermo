# Load test

k6 scripts that simulate visitors against the staging backend (`bun run staging:start`, see
DECISIONS "Staging site (item 24)"). k6 is a standalone binary and not a project dependency;
the scripts make the same REST calls the web app does (`/api/v1/...` with the session cookie), not
page loads.

Install k6 outside the repository: download the zip of an exact release from
https://github.com/grafana/k6/releases into its own empty folder, check it against the release's
`k6-<version>-checksums.txt`, and unzip it. The scripts were written and run with v2.3.0 in
`C:\Users\albert\tools\k6\k6-v2.3.0\k6.exe`.

## Run

Never aim it at a site that is not yours: it signs members in and posts replies and messages.

```sh
export PATH="$HOME/.bun/bin:$PATH"
DB=~/.cache/sermo-bench/large/sermo.db            # any seeded database; its .json meta sits next to it
K6=~/tools/k6/k6-v2.3.0/k6.exe

bun run staging:start --db "$DB"
MARK=$(bun load/write-waits.ts --db "$DB" --size)
MSYS_NO_PATHCONV=1 "$K6" run -e PROFILE=smoke -e META="$(cygpath -w "$DB.json")" \
  -e SUMMARY_OUT=.tmp-run/summary.json load/sermo.js
bun load/write-waits.ts --db "$DB" --from "$MARK"
bun run staging:stop --db "$DB"
```

| Environment | Meaning |
| --- | --- |
| `PROFILE` | `smoke` (10 VUs, 30 s), `hundreds` (300 VUs, 5.5 min), `thousands` (1,000 VUs, 9 min) |
| `PEAK_VUS` | peak VUs for `hundreds` or `thousands` (use 2000 for the top of the range) |
| `META` | the seed's meta JSON (member ids, thread ids, shared password); required |
| `API_URL` | backend, default `http://127.0.0.1:4401` |
| `WEB_URL` | the web origin sent with writes, default `http://localhost:4400` |
| `SUMMARY_OUT` | also write the whole summary data to this JSON file |

## What it does

Four scenarios (`ramping-vus`), each a share of the peak VUs:

- `guests` (55%): home (`site.get`, `feed.list`), a forum (`nodes.list`, `nodes.get`,
  `threads.list`), a thread (`threads.get`, `posts.list`), a profile, a search; a few seconds of
  reading between pages.
- `scrollers` (20%): a signed-in member scrolling `feed.list` with keyset cursors, up to nine pages.
- `pollers` (18%): a member with a conversation open: `conversations.listMessages` with
  `afterMessageId` every 3 s, `feed.newCount` every 30 s and `auth.counters` every 60 s (the
  intervals in `apps/web/src/lib/poll-intervals.ts`). Opening the conversation and every poll that
  returns messages also send `conversations.markRead`, as the web app does.
- `posters` (7%): a member replying to a thread (`posts.create`) or sending a conversation
  message (`conversations.reply`), after reading the thread, which sends `threads.markRead` with
  the position of the last post on the page. The report prints the measured share of writes among
  all requests (the read marks count as writes).

`setup()` signs in a pool of members once (6, 40 or 60, each in a conversation they belong to)
and every VU reuses one of their session cookies, since Better Auth's sign-in limit (3 per 10 s
per address) cannot be raised. Sign-ins go three at a time with a 10.5 s pause after each three,
so setup takes about 10 s (smoke), 2.5 min (hundreds) or 3.5 min (thousands) before the ramp
starts.

The thresholds are an initial report bar, not budgets: http errors under 1% (reads and writes
separately), reads p95 under 200 ms, writes p95 under 500 ms. The end report lists every
operation with its count, average, p95, p99 and maximum.

## Database write waits

`writeTx` logs `[db.write-wait] at=<time> wait=<ms> hold=<ms> commit=<ms>` to the backend log for a
write that waited for the write lock or took to commit for 100 ms or more (fast writes are not
logged). `write-waits.ts` reads the log from the byte noted before the run and reports the number
of slow writes with p95 and maximum of wait, hold and commit, the locked-database failures, and the
size of the write-ahead log afterwards. The write latency in the k6 report (`writes`,
`posts.create`, `conversations.reply`) is the client's view of the same waits.
