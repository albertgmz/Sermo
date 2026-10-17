import "server-only";

import { seoNode, seoProfile, seoThread } from "@sermo/core/contracts";
import { cacheLife } from "next/cache";
import { apiUrl } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { getSite } from "@/lib/sermo/site";
import { callWith } from "@/lib/sermo/transport";
import {
  brandOf,
  CARD_TYPE,
  type CardBrand,
  type CardContent,
  type CardKind,
  cardKey,
  cardOf,
  isCardKind,
  siteContent,
} from "./card";
import { drawCard } from "./card-image";

// A card asked for by the address a page named (its key matches what it shows) is kept for a
// year; one asked for by an old or made-up key is drawn as things are now and kept a few minutes.
const KEPT = "public, max-age=31536000, immutable";
const FRESH = "public, max-age=300";
// No card is no card for anyone, and a card may exist a moment later.
const NONE = { "cache-control": "no-store" };

const missing = () => new Response(null, { status: 404, headers: NONE });

// The site's icon is read whole into the card; a bigger file than this is not read at all.
const ICON_MAX_BYTES = 512 * 1024;

// The site's icon (a PNG) as the card draws it, read from the backend: null when the site has
// none or it is too big to draw, undefined when it cannot be read now. Either way the drawn mark
// takes its place.
async function iconOf(brand: CardBrand): Promise<string | null | undefined> {
  if (!brand.icon) return null;
  try {
    const response = await fetch(new URL(brand.icon.url, apiUrl()), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/png") || !response.body)
      return undefined;
    if (Number(response.headers.get("content-length")) > ICON_MAX_BYTES) {
      await response.body.cancel();
      return null;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (
      let read = await reader.read();
      !read.done;
      read = await reader.read()
    ) {
      size += read.value.byteLength;
      if (size > ICON_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(read.value);
    }
    return `data:image/png;base64,${Buffer.concat(chunks).toString("base64")}`;
  } catch {
    return undefined;
  }
}

// The cards drawn last, by key. Any `v` in the address draws the card as things are now, so a key
// made up to get past the caches in front of the app costs a lookup here, not a new drawing. Only
// a card drawn whole (its icon read) is kept.
const DRAWN = new Map<string, ArrayBuffer>();
const DRAWN_MAX = 32;

async function draw(
  content: CardContent,
  version: string | null,
): Promise<Response> {
  const brand = brandOf(await getSite());
  const key = cardKey(content, brand);
  let png = DRAWN.get(key);
  let whole = png !== undefined;
  if (!png) {
    const icon = await iconOf(brand);
    png = await drawCard(content, brand, icon ?? null);
    whole = icon !== undefined;
    if (whole) {
      DRAWN.set(key, png);
      if (DRAWN.size > DRAWN_MAX) DRAWN.delete(DRAWN.keys().next().value ?? "");
    }
  }
  // A card drawn without the icon it should have is not kept for long.
  const kept = whole && version === key;
  return new Response(png.slice(0), {
    headers: {
      "content-type": CARD_TYPE,
      "cache-control": kept ? KEPT : FRESH,
    },
  });
}

// The site's own card, for the pages that have none of their own.
export async function siteCard(version: string | null): Promise<Response> {
  return draw(siteContent(await getSite()), version);
}

// The SEO reads that say what a thread, forum or member page is, asked as a guest (no cookie, no
// address of the visitor): a card is drawn only for a page the backend would index, the same pages
// that name one.
const READS = {
  threads: (id: number) => callWith({}, seoThread, { threadId: id }),
  forums: (id: number) => callWith({}, seoNode, { nodeId: id }),
  members: (id: number) => callWith({}, seoProfile, { userId: id }),
};

type GuestRead =
  | { seo: Awaited<ReturnType<(typeof READS)[CardKind]>> }
  | { status: 404 | 503 };

// Shared for a minute by every request for the card, whatever its `v`: a page that changes, or
// stops being open to guests, shows in its card within that minute. A failing backend is asked
// again after a few seconds.
async function guestRead(kind: CardKind, id: number): Promise<GuestRead> {
  "use cache";
  try {
    const seo = await READS[kind](id);
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return { seo };
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    // Not found, not for a guest to see, or no record's id: no card. A throttled or failing
    // backend is not an answer about the page.
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      cacheLife({ stale: 60, revalidate: 60, expire: 300 });
      return { status: 404 };
    }
    cacheLife({ stale: 30, revalidate: 5, expire: 60 });
    return { status: 503 };
  }
}

// The card of a thread, forum or member. Missing, private (closed to guests), hidden or moderated
// content, and a page kept out of the index, have none: a 404.
export async function pageCard(
  kind: string,
  rawId: string,
  version: string | null,
): Promise<Response> {
  const id = parseId(rawId);
  if (!isCardKind(kind) || id === null) return missing();
  const read = await guestRead(kind, id);
  if ("status" in read)
    return read.status === 404
      ? missing()
      : new Response(null, { status: 503, headers: NONE });
  if (read.seo.robots !== "index,follow") return missing();
  const content = cardOf(kind, read.seo);
  if (!content) return missing();
  return draw(content, version);
}
