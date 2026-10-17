import { Paperclip } from "lucide-react";
import { getLocale } from "next-intl/server";
import {
  fileName,
  MEDIA_CLASS,
  mediaKind,
  type TaggedAttachment,
} from "@/lib/attachment-tags";
import { formatBytes } from "@/lib/format";
import { liteBlocks } from "@/lib/lite-mode";

// A video or audio attachment in the browser's own player, with its row to download it under the
// player. It goes by the post pictures' LITE switch: with it off the page names no media address
// for the browser to fetch, so this draws nothing and the caller lists the file as a plain row.
export async function AttachmentPlayer({ file }: { file: TaggedAttachment }) {
  const kind = mediaKind(file.contentType);
  if (!kind || (await liteBlocks("postImages"))) return null;
  const [locale, name] = [await getLocale(), fileName(file)];
  return (
    <div className={MEDIA_CLASS.box}>
      {kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: a member's uploaded file comes with no captions
        <video
          controls
          preload="metadata"
          playsInline
          src={file.url}
          aria-label={name}
          className={MEDIA_CLASS.video}
        />
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: a member's uploaded file comes with no captions
        <audio
          controls
          preload="metadata"
          src={file.url}
          aria-label={name}
          className={MEDIA_CLASS.audio}
        />
      )}
      <a href={file.url} download={name} className={MEDIA_CLASS.row}>
        <Paperclip
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatBytes(file.byteSize, locale)}
        </span>
      </a>
    </div>
  );
}
