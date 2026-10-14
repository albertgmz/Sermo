# Sermo web app

The forum's web interface: a Next.js 16 app (App Router, React 19, Tailwind CSS 4) that reads and
writes everything through the Sermo API. It keeps no data of its own.

## Running it

The API must be reachable. Copy `.env.example` and set:

- `SERMO_API_URL`: internal address of the API, used by the server and by the `/api` rewrite.
- `SERMO_PUBLIC_URL`: public origin of the web app, sent to the API as the `Origin` of every write.

Then, from this folder:

```bash
bun run dev        # development server
bun run build      # production build
bun run start      # serve the build
```

A fresh site is empty. From the repository root, `bun run starter:load --admin <username>` fills it
with the starter configuration: pictures, colours, forums, awards, the shop, the site identity,
credit rules and static pages (see `scripts/starter/README.md`).

## Checks

```bash
bun run typecheck
bun run test
bun run lint       # from the repository root
```

## Layout

- `src/lib/sermo/`: the only code that talks to the API (calls, session, errors, view shapes).
- `src/app/[locale]/(main)`: the site, `src/app/[locale]/(auth)`: sign-in pages,
  `src/app/[locale]/(staff)`: the administration and moderation panel. The `[locale]` segment is
  hidden: the proxy picks the language of each visitor and rewrites to it. The four upload routes
  and the icon sit outside it, at their public addresses.
- `src/components`: `ui` (primitives), `forum` (reusable pieces), `layout` (shell), `staff` (panel).
- `/ui` is the styleguide: every reusable component with fixed sample data.
- `messages/<locale>/`: all interface text, one file per zone (`en` is the source of the types).
- LITE mode (a visitor preference that stops pictures from loading) is guarded by the suites in
  `tests/` and `src/lib/lite-*.test.ts`.
