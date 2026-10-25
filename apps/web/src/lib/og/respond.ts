import "server-only";

import { seoNode, seoProfile, seoThread } from "@sermo/core/contracts";
import { cacheLife } from "next/cache";
import { apiUrl } from "@/lib/sermo/config";
import { adultReasonOfDigest, SermoError } from "@/lib/sermo/errors";
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
// year; one asked for by an old or made-up key, or drawn from a read that may be out of date, is
// drawn as things are now and kept a few minutes.
const KEPT = "public, max-age=31536000, immutable";
const FRESH = "public, max-age=300";
// No card is no card for anyone, and a card may exist a moment later.
const NONE = { "cache-control": "no-store" };

const missing = () => new Response(null, { status: 404, headers: NONE });

// How old the backend's answer about a page may be for its card to be kept for a year. An answer
// older than this may describe a thread hidden, moderated or renamed since; it is drawn, but kept
// only a few minutes.
export const READ_FRESH_MS = 10_000;

// The cache header of a drawn card: a year only when the address names exactly what is drawn, the
// card is whole (its icon was read) and what it says was read from the backend moments ago. While
// the site's +18 mode is on a page's card is never kept for a year (`markable`): the page may be
// marked +18 at any moment, and a cache in front of the app must not go on showing it after that.
export function cacheControlOf(card: {
  version: string | null;
  key: string;
  whole: boolean;
  readAge: number;
  markable?: boolean;
}): string {
  return card.whole &&
    card.version === card.key &&
    card.readAge <= READ_FRESH_MS &&
    !card.markable
    ? KEPT
    : FRESH;
}

// The site's icon is read whole into the card and drawn there: a bigger file than this is not
// read at all, and a picture larger than this on a side is not drawn (the backend stores the icon
// at 512 x 512).
const ICON_MAX_BYTES = 512 * 1024;
const ICON_MAX_SIDE = 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Whether the bytes are a PNG of a size the card may draw: the signature, then the width and the
// height from the header chunk that follows it.
function drawablePng(bytes: Buffer) {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte))
    return false;
  const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  return width <= ICON_MAX_SIDE && height <= ICON_MAX_SIDE;
}

// The site's icon (a PNG) as the card draws it, read from the backend: null when the site has
// none, or it is too big or not a PNG the card can draw; undefined when it cannot be read now.
// Either way the drawn mark takes its place.
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
    const bytes = Buffer.concat(chunks);
    if (!drawablePng(bytes)) return null;
    return `data:image/png;base64,${bytes.toString("base64")}`;
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
  readAge: number,
): Promise<Response> {
  const site = await getSite();
  const brand = brandOf(site);
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
  return new Response(png.slice(0), {
    headers: {
      "content-type": CARD_TYPE,
      "cache-control": cacheControlOf({
        version,
        key,
        whole,
        readAge,
        markable: site.adultMode && content.kind !== "site",
      }),
    },
  });
}

// The site's own card, for the pages that have none of their own. What it shows (the site's name,
// description, accent and icon) is public and never hidden, so the age of the site's read does not
// matter to how long it is kept.
export async function siteCard(version: string | null): Promise<Response> {
  return draw(siteContent(await getSite()), version, 0);
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
  | { seo: Awaited<ReturnType<(typeof READS)[CardKind]>>; readAt: number }
  | { status: 404 | 503 | "adult" };

// Shared for a few seconds by every request for the card, whatever its `v`, so a made-up key
// cannot make the app ask the backend on every request. An answer is used for 20 seconds at the
// most: after 10 the next request refreshes it in the background and is still answered from it,
// after 20 it waits for a new read. `readAt` says when the answer was read, so a card drawn from
// an answer older than READ_FRESH_MS is not kept for long. A failing backend is asked again
// after a few seconds.
async function guestRead(kind: CardKind, id: number): Promise<GuestRead> {
  "use cache";
  try {
    const seo = await READS[kind](id);
    cacheLife({ stale: 30, revalidate: 10, expire: 20 });
    return { seo, readAt: Date.now() };
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    // Marked +18 while the mode is on: a card says nothing of it.
    if (adultReasonOfDigest(error.digest)) {
      cacheLife({ stale: 30, revalidate: 10, expire: 20 });
      return { status: "adult" };
    }
    // Not found, not for a guest to see, or no record's id: no card. A throttled or failing
    // backend is not an answer about the page.
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      cacheLife({ stale: 30, revalidate: 10, expire: 20 });
      return { status: 404 };
    }
    cacheLife({ stale: 30, revalidate: 5, expire: 10 });
    return { status: 503 };
  }
}

// The card of a thread, forum or member. Missing, private (closed to guests), hidden or moderated
// content, and a page kept out of the index, have none: a 404. Content marked +18 (while the
// site's +18 mode is on) gets the site's own card, which says nothing of it.
export async function pageCard(
  kind: string,
  rawId: string,
  version: string | null,
): Promise<Response> {
  const id = parseId(rawId);
  if (!isCardKind(kind) || id === null) return missing();
  const read = await guestRead(kind, id);
  if ("status" in read && read.status === "adult")
    return draw(siteContent(await getSite()), version, 0);
  if ("status" in read)
    return read.status === 404
      ? missing()
      : new Response(null, { status: 503, headers: NONE });
  if (read.seo.robots !== "index,follow") return missing();
  const content = cardOf(kind, read.seo);
  if (!content) return missing();
  return draw(content, version, Date.now() - read.readAt);
}
