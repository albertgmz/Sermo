import { formatBytes } from "@/lib/format";

// A smaller copy of a picture and its width in pixels.
export type PictureWidth = { url: string; width: number };

export type TaggedAttachment = {
  fileId: number;
  url: string;
  thumbnailUrl: string | null;
  widths: PictureWidth[];
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
// carries the file's id twice, as an attribute and as its fallback text, and for XenForo's
// `[ATTACH type="full" width="300px" alt="…"]` the width and the alt text too. Anything else, in
// any attribute order, is not a placeholder.
const SPAN = /<span ([^<>]*)>(\d{1,12})<\/span>/g;
const ATTRIBUTE = / ?([a-z-]+)="([^"]*)"/y;
const OPTIONAL = new Set(["data-attach-width", "data-attach-alt"]);
// The widths the renderer writes (`300px`, `50%`).
const WIDTH = /^(?:[1-9]\d{0,3}px|(?:[1-9]\d?|100)%)$/;

// `alt` is as the renderer escaped it, ready to go into an attribute.
type Placeholder = {
  id: number;
  size: "thumb" | "full";
  width?: string;
  alt?: string;
};

function placeholderOf(attributes: string, text: string): Placeholder | null {
  const found = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  while (ATTRIBUTE.lastIndex < attributes.length) {
    const match = ATTRIBUTE.exec(attributes);
    if (!match || found.has(match[1])) return null;
    found.set(match[1], match[2]);
  }
  const id = found.get("data-attach-id");
  const size = found.get("data-attach-size");
  const optional = [...found.keys()].filter((key) => OPTIONAL.has(key)).length;
  if (found.size !== 3 + optional || found.get("class") !== "bb-attach")
    return null;
  if (id !== text || (size !== "thumb" && size !== "full")) return null;
  const width = found.get("data-attach-width");
  if (width !== undefined && !WIDTH.test(width)) return null;
  return { id: Number(id), size, width, alt: found.get("data-attach-alt") };
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

// The candidates of a picture for `srcset`, narrowest first: its smaller copies, then the picture
// itself. Null for a picture without copies, which its `src` alone draws.
export function widthCandidates(picture: {
  url: string;
  width: number | null;
  widths: readonly PictureWidth[];
}): string | null {
  if (!picture.width || !picture.widths.length) return null;
  return [...picture.widths, { url: picture.url, width: picture.width }]
    .map((copy) => `${copy.url} ${copy.width}w`)
    .join(", ");
}

// A full picture in a text is as wide as itself or the column, whichever is less. A browser that
// knows `auto` measures the box (the picture is lazy and has its size); one that does not takes
// the window as the column, so a phone gets a copy and a wide screen the picture.
function fullSources(file: TaggedAttachment) {
  const candidates = widthCandidates(file);
  if (!candidates || !file.width) return "";
  return ` srcset="${escapeHtml(candidates)}" sizes="auto, (max-width: ${file.width}px) 100vw, ${file.width}px"`;
}

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
  { size: how, width, alt }: Placeholder,
  context: InlineContext,
  inLink: boolean,
) {
  const name = escapeHtml(fileName(file));
  // The width the member gave the picture, which the column still caps (`max-w-full`).
  const style = width ? ` style="width:${width}"` : "";
  const media = mediaKind(file.contentType);
  if (!file.contentType.startsWith("image/")) {
    // A link inside a link is no link: inside one, the file is just its name.
    if (inLink) return name;
    const url = escapeHtml(file.url);
    // Video and audio are served to play in the page; their row saves them.
    const download = media ? ` download="${name}"` : "";
    // With post pictures blocked no player names its address for the browser to fetch: the file
    // is a plain row. Spans, not blocks: the place can be inside a paragraph.
    if (media && !context.liteImages) {
      const player =
        media === "video"
          ? `<video controls preload="metadata" playsinline src="${url}" aria-label="${name}" class="${MEDIA_CLASS.video}"></video>`
          : `<audio controls preload="metadata" src="${url}" aria-label="${name}" class="${MEDIA_CLASS.audio}"></audio>`;
      return (
        `<span class="my-1 ${MEDIA_CLASS.box}">${player}` +
        `<a href="${url}"${download} class="${MEDIA_CLASS.row}">` +
        `<span class="truncate">${name}</span>` +
        `<span class="shrink-0 text-xs text-muted-foreground tabular-nums">${escapeHtml(formatBytes(file.byteSize, context.locale))}</span></a></span>`
      );
    }
    return (
      `<a href="${url}"${download} class="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border bg-muted/40 px-3 align-middle text-sm font-normal! text-foreground! no-underline! hover:bg-muted md:min-h-8">` +
      `<span class="truncate">${name}</span>` +
      `<span class="shrink-0 text-xs text-muted-foreground tabular-nums">${escapeHtml(formatBytes(file.byteSize, context.locale))}</span></a>`
    );
  }
  if (context.liteImages) {
    return `<span role="img" aria-label="${escapeHtml(context.liteAria)}" data-slot="lite-placeholder" class="pointer-events-none inline-flex items-center justify-center rounded-md border bg-muted px-3 py-2 font-mono text-(length:--text-tiny) text-muted-foreground">${escapeHtml(context.liteLabel)}</span>`;
  }
  if (how === "full") {
    return `<img src="${escapeHtml(file.url)}"${fullSources(file)} alt="${alt ?? name}"${size(file, Number.POSITIVE_INFINITY)}${style} loading="lazy" class="my-1 inline-block h-auto max-w-full rounded-md align-bottom">`;
  }
  const thumb = `<img src="${escapeHtml(file.thumbnailUrl ?? file.url)}" alt="${alt ?? name}"${size(file, THUMB_WIDTH)}${style} loading="lazy" class="block h-auto max-w-full">`;
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
        ? drawn(file, placeholder, context, open > 0)
        : `<span class="inline-block rounded-sm border border-dashed px-1.5 text-xs text-muted-foreground">${escapeHtml(context.missingLabel)}</span>`;
    },
  );
}
