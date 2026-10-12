import type { postsList } from "@sermo/core/contracts";
import { Paperclip } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { liteBlocks } from "@/lib/lite-mode";

type Attachment = z.output<
  typeof postsList.output
>["items"][number]["attachments"][number];

// The attachments carry no name of their own: the last part of the address is the best there is.
export function fileName(url: string, fileId: number) {
  const last = url.split("?")[0].split("/").at(-1);
  try {
    return last ? decodeURIComponent(last) : `#${fileId}`;
  } catch {
    return last || `#${fileId}`;
  }
}

function formatBytes(
  format: Awaited<ReturnType<typeof getFormatter>>,
  bytes: number,
) {
  const [unit, size] =
    bytes < 1024
      ? (["byte", bytes] as const)
      : bytes < 1024 * 1024
        ? (["kilobyte", bytes / 1024] as const)
        : (["megabyte", bytes / (1024 * 1024)] as const);
  return format.number(size, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  });
}

// What a post has attached, as the backend returns it: pictures drawn (through the LITE gate for
// post pictures, so a blocked one never puts its address in the page) and every other file as a
// row to download.
export async function PostAttachments({
  attachments,
}: {
  attachments: Attachment[];
}) {
  const [t, format, liteImages] = await Promise.all([
    getTranslations("threads.page"),
    getFormatter(),
    liteBlocks("postImages"),
  ]);
  const pictures = attachments.filter(
    (file) =>
      file.contentType.startsWith("image/") && file.width && file.height,
  );
  const files = attachments.filter((file) => !pictures.includes(file));
  return (
    <>
      {pictures.length > 0 && (
        <ul
          aria-label={t("aria.pictures")}
          className="mt-3 flex flex-wrap gap-2"
        >
          {pictures.map((file) => {
            const box = {
              aspectRatio: `${file.width} / ${file.height}`,
              width: `min(100%, ${Math.min(file.width ?? 0, 320)}px)`,
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
                    aria-label={t("openPicture")}
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
      {files.length > 0 && (
        <ul
          aria-label={t("aria.attachments")}
          className="mt-3 flex flex-wrap gap-2"
        >
          {files.map((file) => (
            <li key={file.fileId} className="min-w-0 max-w-full">
              <a
                href={file.url}
                className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm hover:bg-muted md:min-h-8"
              >
                <Paperclip
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate">
                  {fileName(file.url, file.fileId)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(format, file.byteSize)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
