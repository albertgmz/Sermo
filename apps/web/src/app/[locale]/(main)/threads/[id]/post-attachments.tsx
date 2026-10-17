import type { postsList } from "@sermo/core/contracts";
import { Paperclip } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { AttachmentPlayer } from "@/components/forum/attachment-player";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { fileName, mediaKind } from "@/lib/attachment-tags";
import { formatBytes } from "@/lib/format";
import { liteBlocks } from "@/lib/lite-mode";

export { fileName };

type Attachment = z.output<
  typeof postsList.output
>["items"][number]["attachments"][number];

// What a post has attached, as the backend returns it: pictures drawn (through the LITE gate for
// post pictures, so a blocked one never puts its address in the page), video and audio in the
// browser's player (the same switch: with it off they are plain rows), and every other file as a
// row to download. The ones the text placed inline (`inline`, their ids) are not listed again.
export async function PostAttachments({
  attachments: all,
  inline = [],
}: {
  attachments: Attachment[];
  inline?: number[];
}) {
  const attachments = all.filter((file) => !inline.includes(file.fileId));
  const locale = await getLocale();
  const [t, liteImages] = await Promise.all([
    getTranslations("threads.page"),
    liteBlocks("postImages"),
  ]);
  const pictures = attachments.filter(
    (file) =>
      file.contentType.startsWith("image/") && file.width && file.height,
  );
  const media = liteImages
    ? []
    : attachments.filter((file) => mediaKind(file.contentType));
  const files = attachments.filter(
    (file) => !pictures.includes(file) && !media.includes(file),
  );
  return (
    <>
      {pictures.length > 0 && (
        <ul
          aria-label={t("aria.pictures")}
          className="mt-3 flex flex-wrap gap-2"
        >
          {pictures.map((file, index) => {
            const box = {
              aspectRatio: `${file.width} / ${file.height}`,
              width: Math.min(file.width ?? 0, 320),
              maxWidth: "100%",
            };
            return (
              <li key={file.fileId} className="min-w-0 max-w-full">
                {liteImages ? (
                  <div style={box} className="max-w-full">
                    <LitePlaceholder className="size-full rounded-md border" />
                  </div>
                ) : (
                  <a
                    href={file.url}
                    aria-label={t("openPicture", {
                      position: index + 1,
                      total: pictures.length,
                    })}
                    className="block overflow-hidden rounded-md border"
                    style={box}
                  >
                    <Art
                      category="postImages"
                      src={file.thumbnailUrl ?? file.url}
                      className="size-full"
                    />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {media.length > 0 && (
        <ul aria-label={t("aria.media")} className="mt-3 flex flex-col gap-2">
          {media.map((file) => (
            <li key={file.fileId}>
              <AttachmentPlayer file={file} />
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul
          aria-label={t("aria.attachments")}
          className="mt-3 flex flex-wrap gap-2"
        >
          {files.map((file) => {
            const row = (
              <>
                <Paperclip
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{fileName(file)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(file.byteSize, locale)}
                </span>
              </>
            );
            // A picture without a size is listed like any file, but with post pictures blocked its
            // address is not handed out: the row is there and the link is not.
            const blocked = liteImages && file.contentType.startsWith("image/");
            return (
              <li key={file.fileId} className="min-w-0 max-w-full">
                {blocked ? (
                  <span className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground md:min-h-8">
                    {row}
                  </span>
                ) : (
                  <a
                    href={file.url}
                    // Video and audio are served to play in the page; the row saves them.
                    download={
                      mediaKind(file.contentType) ? fileName(file) : undefined
                    }
                    className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm hover:bg-muted md:min-h-8"
                  >
                    {row}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
