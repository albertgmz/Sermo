"use client";

import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PostComposerProps } from "@/app/[locale]/(main)/members/post-composer";
import {
  POST_ATTACH,
  POST_LINE,
  POST_PILL,
} from "@/app/[locale]/(main)/members/post-composer-line";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

// The wall composer as the pages draw it. Its code (the sheet, the editor shell, the attachments)
// is not part of the page's first load: until the member reaches for it the page holds the closed
// line, the same line the composer draws (`post-composer-line`), so nothing moves when it arrives.
// The first pointer over the line, touch or focus fetches the code; the press that opens it swaps
// the real composer in, mounted open. Its own file button is in the sheet: the member presses it
// there, a press the browser accepts for the file chooser.
const loadComposer = () =>
  import("@/app/[locale]/(main)/members/post-composer");

export function LazyPostComposer(props: PostComposerProps) {
  const t = useTranslations("members.postComposer");
  return (
    <LazyPopup
      load={loadComposer}
      popup={props}
      trigger={(lazy) => (
        <div className={cn(POST_LINE, props.className)}>
          <div className="mr-1">{props.avatar}</div>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded="false"
            className={POST_PILL}
            {...lazy}
          >
            {props.placeholder}
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-label={t("aria.attach")}
            title={t("aria.attach")}
            className={POST_ATTACH}
            {...lazy}
          >
            <ImagePlus />
          </button>
        </div>
      )}
    />
  );
}
