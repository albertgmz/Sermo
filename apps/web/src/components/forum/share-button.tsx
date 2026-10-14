"use client";

import { Check, Link as LinkIcon, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

// Puts the link on the clipboard; false where there is no clipboard or it refuses.
export async function copyLink(
  url: string,
  device: { clipboard?: { writeText: (text: string) => Promise<void> } },
) {
  try {
    if (!device.clipboard) return false;
    await device.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
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

// Where the device has a share sheet it opens; elsewhere a small menu offers to copy the link.
// `label` draws a word beside the icon from `sm` up.
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
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  const address = () => new URL(href, location.origin).href;

  async function copy() {
    const target = address();
    setUrl(target);
    if (await copyLink(target, navigator)) {
      setStatus("copied");
      setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 2000);
    } else {
      setStatus("manual");
    }
  }

  function change(next: boolean) {
    if (next && shareNatively(address(), navigator, () => setOpen(true))) {
      return;
    }
    setStatus("idle");
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        aria-label={t("aria.share")}
        className={cn(className, status === "copied" && "text-success")}
      >
        {status === "copied" ? <Check /> : <Share2 />}
        {label && <span className={actionLabelClass}>{label}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-0 p-1">
        <ShareMenuBody url={url} status={status} onCopy={copy} />
      </PopoverContent>
    </Popover>
  );
}
