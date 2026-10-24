"use client";

import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { actionLabelClass } from "@/components/forum/message-action";
import { linkTo, shareLink } from "@/components/forum/share-link";
import { isPlainClick } from "@/components/ui/lazy-popup-intent";

// One press shares the item's link (`shareLink`): copied at once on a computer, with the floating
// notice saying so; the share sheet on a phone. Where the clipboard refuses, the browser's own
// prompt holds the link, selected, to copy by hand. It is a link to the item, as XenForo's share
// gadget is: without JavaScript, and for a new tab or the browser's own "copy link", it is the
// permalink. `label` draws a word beside the icon from `sm` up.
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
    <a
      href={href}
      aria-label={t("aria.share")}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        shareLink(
          linkTo(href),
          {
            share: navigator.share?.bind(navigator),
            clipboard: navigator.clipboard,
            touch: matchMedia("(pointer: coarse)").matches,
          },
          (url) => prompt(t("manual"), url),
        );
      }}
    >
      <Share2 />
      {label && <span className={actionLabelClass}>{label}</span>}
    </a>
  );
}
