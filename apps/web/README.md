# Sermo web app

The forum's web interface: a Next.js 16 app (App Router, React 19, Tailwind CSS 4) that reads and
writes everything through the Sermo API. It keeps no data of its own. The interface is in English
and Spanish ([next-intl](https://next-intl.dev)).

## Running it

The API must be reachable (see "Local development" in the [root README](../../README.md#local-development)).
Copy `.env.example` to `.env` and set:

| Variable | Purpose |
| --- | --- |
| `SERMO_API_URL` | Internal address of the API, used by the server and by the rewrites of `/api/*`, `/mcp` and the backend's public paths (feeds, sitemaps, `robots.txt`; the list is in `next.config.ts`). Default `http://127.0.0.1:8787`. |
| `SERMO_PUBLIC_URL` | Public origin of the web app, sent to the API as the `Origin` of every write. |

Then, from this folder:

```sh
bun run dev        # development server on http://localhost:3000
bun run build      # service worker, then the production build
bun run start      # serve the build
```

A fresh site is empty. From the repository root, `bun run starter:load --admin <username>` fills it
with the starter configuration: pictures, colours, forums, awards, the shop, the site identity,
credit rules and static pages (see [scripts/starter/README.md](../../scripts/starter/README.md)).

## Checks

```sh
bun run typecheck
bun run test       # each test file in its own module registry (--isolate)
bun run js-budget  # the JavaScript sent per page stays within js-budgets.json
bun run e2e        # Playwright
bun run lint       # Biome
```

`bun run check:web` at the repository root runs the typecheck, the tests, the build and the budgets
together. `bun run build` rewrites `.next`: do not run it in a checkout that a running `next start`
serves from.

## Layout

| Path | What it is |
| --- | --- |
| `src/lib/sermo/` | The only code that talks to the API (calls, session, errors, view shapes). |
| `src/app/[locale]/(main)` | The site: the forum list on `/`, What's new on `/whats-new`, forums, threads, members, conversations, the account pages. |
| `src/app/[locale]/(auth)` | Sign-in, registration, password reset and email verification. |
| `src/app/[locale]/(staff)` | The administration (`/admin`) and moderation (`/moderation`) panel. |
| `src/app/[locale]/(developer)` | The public API reference at `/developer`. |
| `src/app/*` outside `[locale]` | The upload routes, the push subscription route, the manifest, icons, Open Graph pictures, `opensearch.xml`, the language switch and sign-out, at their public addresses. |
| `src/proxy.ts` | Picks each visitor's language and rewrites to it. |
| `src/components` | `ui` (primitives), `forum` (reusable pieces), `layout` (shell), `staff` (panel), `widgets`, `icons`, `brand`. |
| `src/worker` | The service worker, bundled into `public/sw.js` by `scripts/build-sw.ts`. |
| `messages/<locale>/` | All interface text, one file per zone (`en` is the source of the types). |
| `tests/` | Static and cross-cutting suites; most tests sit next to their code. |
| `e2e/` | The Playwright suite. |

The `[locale]` segment is hidden: no address carries a language. The proxy picks `en` or `es` from
the `forum_locale` cookie, then the site's default language, then `es`. `Accept-Language` does not
pick the language. Every string goes in both `messages/en` and `messages/es`;
`tests/messages-parity.test.ts` fails otherwise. `revalidatePath` takes the `/[locale]/...` form
of a path.

`/ui` is the styleguide: every reusable component with fixed sample data. The Data saver (code name
LITE; a visitor preference that stops pictures from loading) is guarded by the suites in `tests/`
and `src/lib/lite-*.test.ts`. Light and dark themes are guarded by `tests/theme-contrast.test.ts`
and `tests/fixed-colours.test.ts`.
