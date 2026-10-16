import { formatBytes } from "@/lib/format";

export type TaggedAttachment = {
  fileId: number;
  url: string;
  thumbnailUrl: string | null;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  filename: string | null;
};

// The name the file was uploaded with. Files that came without one (older uploads) have the last
// part of the address, which is the best there is.
export function fileName({
  filename,
  url,
  fileId,
}: Pick<TaggedAttachment, "filename" | "url" | "fileId">) {
  if (filename) return filename;
  const last = url.split("?")[0].split("/").at(-1);
  try {
    return last ? decodeURIComponent(last) : `#${fileId}`;
  } catch {
    return last || `#${fileId}`;
  }
}

// Video and audio play in the browser's own player; the backend stores only types browsers play.
export function mediaKind(contentType: string): "video" | "audio" | null {
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return null;
}

// The look of a played file, the same in the list under a text and in its place in the text: the
// player as wide as the column (up to the width of an embedded player) and under it the file's
// row, which downloads it. Nothing starts on its own; only the length and size are fetched.
export const MEDIA_CLASS = {
  box: "block w-full max-w-140 overflow-hidden rounded-md border bg-muted/40",
  video: "block max-h-[70vh] w-full bg-muted",
  audio: "block w-full p-2",
  row: "flex min-h-10 items-center gap-2 border-t px-3 text-sm font-normal! text-foreground! no-underline! hover:bg-muted md:min-h-8",
};

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
  // What stands where a tag names an attachment the item does not have.
  missingLabel: string;
};

function drawn(
  file: TaggedAttachment,
  how: Placeholder["size"],
  context: InlineContext,
  inLink: boolean,
) {
  const name = escapeHtml(fileName(file));
  const media = mediaKind(file.contentType);
  if (!file.contentType.startsWith("image/")) {
    // A link inside a link is no link: inside one, the file is just its name.
    if (inLink) return name;
    // Spans, not blocks: the place can be inside a paragraph.
    if (media) {
      const url = escapeHtml(file.url);
      return (
        `<span class="my-1 ${MEDIA_CLASS.box}">` +
        `<${media} controls preload="metadata"${media === "video" ? " playsinline" : ""} src="${url}" aria-label="${name}" class="${MEDIA_CLASS[media]}"></${media}>` +
        `<a href="${url}" download="${name}" class="${MEDIA_CLASS.row}">` +
        `<span class="truncate">${name}</span>` +
        `<span class="shrink-0 text-xs text-muted-foreground tabular-nums">${escapeHtml(formatBytes(file.byteSize, context.locale))}</span></a></span>`
      );
    }
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
  const thumb = `<img src="${escapeHtml(file.thumbnailUrl ?? file.url)}" alt="${name}"${size(file, THUMB_WIDTH)} loading="lazy" class="block h-auto max-w-full">`;
  if (inLink) return thumb;
  return (
    `<a href="${escapeHtml(file.url)}" class="my-1 inline-block max-w-full overflow-hidden rounded-md border align-bottom">` +
    `${thumb}</a>`
  );
}

const ANCHOR = /^<a\b/;
const TAG = new RegExp(String.raw`<a\b[^>]*>|</a>|${SPAN.source}`, "g");

// Puts each attachment the text places in the spot of its placeholder. A tag for an attachment the
// item does not have shows a small label instead of the bare id. Inside a link the attachment
// comes without a link of its own.
export function placeAttachments(
  html: string,
  attachments: readonly TaggedAttachment[],
  context: InlineContext,
): string {
  const own = new Map(attachments.map((file) => [file.fileId, file]));
  let open = 0;
  return html.replace(
    TAG,
    (whole, attributes: string | undefined, text: string | undefined) => {
      if (attributes === undefined || text === undefined) {
        if (ANCHOR.test(whole)) open += 1;
        else open = Math.max(0, open - 1);
        return whole;
      }
      const placeholder = placeholderOf(attributes, text);
      if (!placeholder) return whole;
      const file = own.get(placeholder.id);
      return file
        ? drawn(file, placeholder.size, context, open > 0)
        : `<span class="inline-block rounded-sm border border-dashed px-1.5 text-xs text-muted-foreground">${escapeHtml(context.missingLabel)}</span>`;
    },
  );
}
