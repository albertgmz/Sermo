"use client";

import { Check, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function ShareButton({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  const t = useTranslations("forum.shareButton");
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(new URL(href, location.origin).href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t("aria.copied") : t("aria.copy")}
      className={cn(className, copied && "text-success")}
    >
      {copied ? <Check /> : <Share2 />}
    </button>
  );
}
