import { formatBytes } from "@/lib/format";

export type TaggedAttachment = {
  fileId: number;
  url: string;
  thumbnailUrl: string | null;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
};

// The attachments carry no name of their own: the last part of the address is the best there is.
export function fileName(url: string, fileId: number) {
  const last = url.split("?")[0].split("/").at(-1);
  try {
    return last ? decodeURIComponent(last) : `#${fileId}`;
  } catch {
    return last || `#${fileId}`;
  }
}

// What the renderer leaves for `[ATTACH]id[/ATTACH]` and `[ATTACH=full]id[/ATTACH]`: a span that
// carries the file's id twice, as an attribute and as its fallback text. Anything else, in any
// attribute order, is not a placeholder.
const SPAN = /<span ([^<>]*)>(\d{1,12})<\/span>/g;
const ATTRIBUTE = /^([a-z-]+)="([^"]*)"$/;

type Placeholder = { id: number; size: "thumb" | "full" };

function placeholderOf(attributes: string, text: string): Placeholder | null {
  const found = new Map<string, string>();
  for (const attribute of attributes.split(" ")) {
    const match = ATTRIBUTE.exec(attribute);
    if (!match) return null;
    found.set(match[1], match[2]);
  }
  const id = found.get("data-attach-id");
  const size = found.get("data-attach-size");
  if (found.size !== 3 || found.get("class") !== "bb-attach") return null;
  if (id !== text || (size !== "thumb" && size !== "full")) return null;
  return { id: Number(id), size };
}

// The ids of the attachments the text places inline, among those the item has.
export function inlineAttachmentIds(
  html: string,
  attachments: readonly { fileId: number }[],
): number[] {
  const own = new Set(attachments.map((file) => file.fileId));
  const used = new Set<number>();
  for (const match of html.matchAll(SPAN)) {
    const placeholder = placeholderOf(match[1], match[2]);
    if (placeholder && own.has(placeholder.id)) used.add(placeholder.id);
  }
  return [...used];
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const THUMB_WIDTH = 320;

function size(file: TaggedAttachment, wide: number) {
  if (!file.width || !file.height) return "";
  const width = Math.min(file.width, wide);
  const height = Math.round((file.height * width) / file.width);
  return ` width="${width}" height="${height}"`;
}

export type InlineContext = {
  locale: string;
  // Post pictures are blocked (LITE mode): no address of a picture goes into the page.
  liteImages: boolean;
  liteLabel: string;
  liteAria: string;
};

function drawn(
  file: TaggedAttachment,
  how: Placeholder["size"],
  context: InlineContext,
) {
  const name = escapeHtml(fileName(file.url, file.fileId));
  if (!file.contentType.startsWith("image/")) {
    return (
      `<a href="${escapeHtml(file.url)}" class="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border bg-muted/40 px-3 align-middle text-sm font-normal! text-foreground! no-underline! hover:bg-muted md:min-h-8">` +
      `<span class="truncate">${name}</span>` +
      `<span class="shrink-0 text-xs text-muted-foreground tabular-nums">${escapeHtml(formatBytes(file.byteSize, context.locale))}</span></a>`
    );
  }
  if (context.liteImages) {
    return `<span role="img" aria-label="${escapeHtml(context.liteAria)}" data-slot="lite-placeholder" class="pointer-events-none inline-flex items-center justify-center rounded-md border bg-muted px-3 py-2 font-mono text-(length:--text-tiny) text-muted-foreground">${escapeHtml(context.liteLabel)}</span>`;
  }
  if (how === "full") {
    return `<img src="${escapeHtml(file.url)}" alt="${name}"${size(file, Number.POSITIVE_INFINITY)} loading="lazy" class="my-1 inline-block h-auto max-w-full rounded-md align-bottom">`;
  }
  return (
    `<a href="${escapeHtml(file.url)}" class="my-1 inline-block max-w-full overflow-hidden rounded-md border align-bottom">` +
    `<img src="${escapeHtml(file.thumbnailUrl ?? file.url)}" alt="${name}"${size(file, THUMB_WIDTH)} loading="lazy" class="block h-auto max-w-full"></a>`
  );
}

// Puts each attachment the text places in the spot of its placeholder. A placeholder whose id is
// not among the item's own attachments is left as the renderer wrote it (its id as text).
export function placeAttachments(
  html: string,
  attachments: readonly TaggedAttachment[],
  context: InlineContext,
): string {
  if (attachments.length === 0) return html;
  const own = new Map(attachments.map((file) => [file.fileId, file]));
  return html.replace(SPAN, (whole, attributes: string, text: string) => {
    const placeholder = placeholderOf(attributes, text);
    const file = placeholder && own.get(placeholder.id);
    return placeholder && file ? drawn(file, placeholder.size, context) : whole;
  });
}
