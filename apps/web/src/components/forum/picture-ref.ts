import type { PictureEntry } from "@/components/forum/picture-types";

// A picture is addressed by where it is attached and which file it is: `post-<postId>-<fileId>` or
// `wall-<wallPostId>-<fileId>`. That is all the address of the viewer carries, so a link opens the
// same picture whatever the list holds, and the details are asked for when the viewer opens.
export type PictureKind = "post" | "wall";
export type PictureRef = {
  kind: PictureKind;
  contentId: number;
  fileId: number;
};

export const PICTURE_PARAM = "picture";

export function formatRef(ref: PictureRef) {
  return `${ref.kind}-${ref.contentId}-${ref.fileId}`;
}

// The reference an address holds, or null for anything that is not one.
export function parseRef(value: string | null | undefined): PictureRef | null {
  const match = /^(post|wall)-([1-9]\d{0,14})-([1-9]\d{0,14})$/.exec(
    value ?? "",
  );
  if (!match) return null;
  return {
    kind: match[1] as PictureKind,
    contentId: Number(match[2]),
    fileId: Number(match[3]),
  };
}

// The address (path, search and hash) with the picture set, or taken away for null. Everything
// else in the address, the tab and the number of pages loaded included, stays as it is.
export function withPicture(href: string, ref: PictureRef | null) {
  const url = new URL(href, "http://picture.invalid");
  if (ref) url.searchParams.set(PICTURE_PARAM, formatRef(ref));
  else url.searchParams.delete(PICTURE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

// What the list holds after `added` came in: new pictures only, newest attachment first. The same
// array comes back when nothing is new, so a page drawn again does not render the viewer again.
export function mergeEntries(held: PictureEntry[], added: PictureEntry[]) {
  const known = new Set(held.map((entry) => entry.id));
  const fresh = added.filter((entry) => !known.has(entry.id));
  if (fresh.length === 0) return held;
  return [...held, ...fresh].sort((a, b) => b.id - a.id);
}

// The pictures either side of one in the list (the list runs newest first, so `next` is older).
export function neighbours(entries: PictureEntry[], ref: PictureRef) {
  const key = formatRef(ref);
  const index = entries.findIndex((entry) => formatRef(entry.ref) === key);
  if (index < 0) return { index: -1, previous: null, next: null };
  return {
    index,
    previous: entries[index - 1] ?? null,
    next: entries[index + 1] ?? null,
  };
}
