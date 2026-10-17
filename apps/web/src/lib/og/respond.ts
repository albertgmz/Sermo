import "server-only";

import { seoNode, seoProfile, seoThread } from "@sermo/core/contracts";
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

// The site's icon (a PNG) as the card draws it, read from the backend: null when the site has
// none, undefined when it cannot be read in time. Either way the drawn mark takes its place.
async function iconOf(brand: CardBrand): Promise<string | null | undefined> {
  if (!brand.icon) return null;
  try {
    const response = await fetch(new URL(brand.icon.url, apiUrl()), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/png")) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function draw(
  content: CardContent,
  version: string | null,
): Promise<Response> {
  const brand = brandOf(await getSite());
  const icon = await iconOf(brand);
  const png = await drawCard(content, brand, icon ?? null);
  // A card drawn without the icon it should have is not kept for long.
  const kept = icon !== undefined && version === cardKey(content, brand);
  return new Response(png, {
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

// The SEO reads that say what a thread, forum or member page is, asked as a guest: a card is drawn
// only for a page the backend would index, the same pages that name one.
const READS = {
  threads: (id: number) => callWith({}, seoThread, { threadId: id }),
  forums: (id: number) => callWith({}, seoNode, { nodeId: id }),
  members: (id: number) => callWith({}, seoProfile, { userId: id }),
};

// The card of a thread, forum or member. Missing, private (closed to guests), hidden or moderated
// content, and a page kept out of the index, have none: a 404.
export async function pageCard(
  kind: string,
  rawId: string,
  version: string | null,
): Promise<Response> {
  const id = parseId(rawId);
  if (!isCardKind(kind) || id === null) return missing();
  let seo: Awaited<ReturnType<(typeof READS)[CardKind]>>;
  try {
    seo = await READS[kind](id);
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    // Not found, not for a guest to see, or no record's id: no card. A throttled or failing
    // backend is not an answer about the page.
    if (error.status >= 400 && error.status < 500 && error.status !== 429)
      return missing();
    return new Response(null, { status: 503, headers: NONE });
  }
  if (seo.robots !== "index,follow") return missing();
  const content = cardOf(kind, seo);
  if (!content) return missing();
  return draw(content, version);
}
