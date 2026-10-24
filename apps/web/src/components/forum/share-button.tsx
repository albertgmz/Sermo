"use client";

import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { actionLabelClass } from "@/components/forum/message-action";
import { linkTo, shareLink } from "@/components/forum/share-link";

// One press shares the item's link (`shareLink`): copied at once on a computer, with the floating
// notice saying so; the share sheet on a phone. Where the clipboard refuses, the browser's own
// prompt holds the link, selected, to copy by hand. A button, not a link: the item's permalink is
// its number beside it; like XenForo's share gadget it carries the address it shares in
// `data-href`. `label` draws a word beside the icon from `sm` up.
export function ShareButton({
  href,
  label,
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("forum.shareButton");
  return (
    <button
      type="button"
      data-href={href}
      aria-label={t("aria.share")}
      className={className}
      onClick={() =>
        shareLink(
          linkTo(href),
          {
            share: navigator.share?.bind(navigator),
            clipboard: navigator.clipboard,
            touch: matchMedia("(pointer: coarse)").matches,
          },
          (url) => prompt(t("manual"), url),
        )
      }
    >
      <Share2 />
      {label && <span className={actionLabelClass}>{label}</span>}
    </button>
  );
}
