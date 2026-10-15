# Starter content

`bun run starter:load --admin <username>` fills a fresh site with the configuration the first
frontend shipped: pictures, colours, forums, awards, the shop, site identity, credit rules and
static pages. It is configuration, not demo data: no members, threads, posts or conversations.

Everything goes through core's operations, in process, as the named administrator: the same
operations the administration panel calls over REST. Nothing is written to a table or to the
files directory directly.

## Running it

On a fresh database, create the first administrator (set `SERMO_ADMIN_USERNAME`,
`SERMO_ADMIN_EMAIL` and `SERMO_ADMIN_PASSWORD` for the server's first start, or run
`bun run dev:fixture`, which creates `nova`), then:

```sh
export SERMO_DB_PATH=./data/sermo.db SERMO_FILES_DIR=./data/files
export BETTER_AUTH_SECRET=... BETTER_AUTH_URL=http://localhost:3000
bun run starter:load --admin nova
```

The environment is the one the server and `dev:fixture` read. `--admin` must name an existing
member with administration rights; otherwise the loader says so and stops.

It prints one line per thing: `created`, `already there`, or `skipped` with the reason, and a
total. The exit code is non-zero if anything failed; the rest is still tried.

## Safe to run again

Each thing is matched by a stable key before it is created, so a second run creates nothing and a
run that died half-way finishes when run again:

| Kind | Matched by |
| --- | --- |
| Colours | kind and colour value |
| Frames, profile covers, thread covers | kind and entry name |
| Forum tabs, thread prefixes | title, label |
| Categories and forums | title and parent |
| Groups (the paid ranks) | title |
| Shop categories, shop items | name; name and category |
| Awards | name |
| Credit rules, reaction types | title |
| Pages | slug |

A picture missing on an entry that exists (the run stopped between the entry and its picture) is
uploaded on the next run. Settings (level titles and step, signature and title limits, standing
weights) are set only while they still hold the backend's default; one an administrator changed is
reported as skipped and left alone. The site logo and icon are set only while none is set.

Matching is by name or value, so an entry an administrator renamed or recoloured is created again,
and a picture or permission an administrator removed from a loaded entry is put back (the loader
cannot tell that from an interrupted run).

A forum or category is matched by its title and its parent: if an administrator moved one under
another parent or renamed it, a rerun does not find it and creates it again (an empty duplicate).
Rerunning is therefore safe on a site nobody has reorganised; on a live site, check the forum
tree afterwards, or do not rerun the loader.

Nothing already in the database is changed or overwritten, so a rerun does not damage a site that
is already in use, apart from the re-creations described above.

## What it loads, and from where

`data/*.json` holds the texts and numbers, `assets/` the pictures, `pages/` the page texts.

| Kind | Source |
| --- | --- |
| Accent, name and prefix colours | `data/palettes.json` |
| 93 avatar frames, each with its explicit placement | `data/frames.json`, `assets/frames` |
| 10 profile covers, 8 thread covers | `data/covers.json`, `assets/covers`, `assets/thread-covers` |
| 3 forum tabs, 7 categories, 20 forums, 2 sub-forums, their icon and cover; 8 thread prefixes | `data/forums.json`, `assets/forums` |
| 3 groups for the paid ranks (Ember, Blaze, Inferno) with name colour, badge and perks | `data/shop.json` |
| 7 shop categories and 126 items (frames, name colours, name icons, thread covers, boosts, perks, ranks) with prices, effects and pictures | `data/shop.json`, `assets/shop` |
| 17 awards with tier, XP, criteria where one exists, and picture | `data/awards.json`, `assets/awards` |
| Logo and icon | `assets/site` |
| Level titles and step, signature and title limits, standing weights, 4 credit rules, reaction types | `data/settings.json` |
| Static pages (terms, privacy, legal, contact, upgrade-faq) | `pages/*.bbcode`: BB code, the file name is the slug, the first `[HEADING=1]` line the title |

Vector pictures (awards, shop, logo, icon) are drawn once to a 512 px PNG with a transparent
background before they are uploaded, because uploads are raster only. A frame is uploaded as it
is and keeps the placement of its row in `data/frames.json`, not a measured one.

An award whose old condition has no equivalent in the backend is loaded as a manual award; the
loader says which when it creates it.

## Changing any of it afterwards

All of it is ordinary data. In the administration panel: appearance (colours, frames, covers),
forums (nodes, tabs, prefixes, pictures), groups, awards, shop, credit rules, reaction types,
pages and the site settings (name, logo, icon, level titles, limits). Changing it there does not
make the loader undo it: a later run only creates what is missing.
