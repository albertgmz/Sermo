"use client";

import { Check, Link as LinkIcon, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { shareAddress } from "@/lib/referral/link";
import { currentViewer } from "@/lib/session-epoch";
import { cn } from "@/lib/utils";

// Hands the link to the device's share sheet where there is one and says so; false where there is
// none or it failed at once. Closing the sheet (an AbortError) is nothing wrong; any other failure
// calls `fallback`, which opens the menu to copy the link instead.
export function shareNatively(
  url: string,
  device: { share?: (data: { url: string }) => Promise<void> },
  fallback: () => void,
) {
  if (typeof device.share !== "function") return false;
  try {
    device.share({ url }).catch((error: unknown) => {
      if ((error as { name?: string } | null)?.name !== "AbortError") {
        fallback();
      }
    });
  } catch {
    return false;
  }
  return true;
}

// The menu's content: the button to copy and, where copying failed, the link in a field already
// selected so it can be copied by hand.
export function ShareMenuBody({
  url,
  status,
  onCopy,
}: {
  url: string;
  status: "idle" | "copied" | "manual";
  onCopy: () => void;
}) {
  const t = useTranslations("forum.shareButton");
  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          messageActionClass,
          "justify-start px-3 text-sm",
          status === "copied" && "text-success",
        )}
      >
        {status === "copied" ? <Check /> : <LinkIcon />}
        {status === "copied" ? t("copied") : t("copy")}
      </button>
      {status === "manual" && (
        <div className="space-y-1 p-2">
          <p role="status" className="text-xs text-muted-foreground">
            {t("manual")}
          </p>
          <input
            readOnly
            value={url}
            aria-label={t("manual")}
            onFocus={(event) => event.currentTarget.select()}
            ref={(field) => field?.select()}
            className="h-10 w-64 max-w-full rounded-md border bg-background px-2 text-base md:h-8 md:text-sm"
          />
        </div>
      )}
    </>
  );
}

// A signed-in member's copy of the link carries their id, so those who register through it are
// credited to them.
export const linkTo = (href: string) =>
  shareAddress(href, location.origin, currentViewer());

const loadPopup = () => import("@/components/forum/share-popup");

// Where the device has a share sheet it opens; elsewhere a small menu offers to copy the link. The
// menu's code (Base UI) is fetched when the button is first reached for; until then the button is
// a plain one. The share sheet is asked for here, in the press itself: a browser allows it only
// there. `label` draws a word beside the icon from `sm` up.
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
    <LazyPopup
      load={loadPopup}
      popup={{ href, label, className }}
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="popover-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={t("aria.share")}
          className={className}
          {...lazy}
          onClick={(event) => {
            if (
              shareNatively(linkTo(href), navigator, () => lazy.onClick(event))
            )
              return;
            lazy.onClick(event);
          }}
        >
          <Share2 />
          {label && <span className={actionLabelClass}>{label}</span>}
        </button>
      )}
    />
  );
}
