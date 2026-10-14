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
// none. Closing the sheet without sharing rejects, and nothing is wrong then.
export function shareNatively(
  url: string,
  device: { share?: (data: { url: string }) => Promise<void> },
) {
  if (typeof device.share !== "function") return false;
  device.share({ url }).catch(() => undefined);
  return true;
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
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const address = () => new URL(href, location.origin).href;

  async function copy() {
    await navigator.clipboard.writeText(address());
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setOpen(false);
    }, 2000);
  }

  function change(next: boolean) {
    if (next && shareNatively(address(), navigator)) return;
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        aria-label={t("aria.share")}
        className={cn(className, copied && "text-success")}
      >
        {copied ? <Check /> : <Share2 />}
        {label && <span className={actionLabelClass}>{label}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto gap-0 p-1">
        <button
          type="button"
          onClick={copy}
          className={cn(
            messageActionClass,
            "justify-start px-3 text-sm",
            copied && "text-success",
          )}
        >
          {copied ? <Check /> : <LinkIcon />}
          {copied ? t("copied") : t("copy")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
