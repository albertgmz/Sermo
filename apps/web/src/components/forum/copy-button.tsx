"use client";

// CopyButton: puts a text on the clipboard and says so for two seconds. Where the device has no
// clipboard or refuses, it says to copy by hand: keep the text itself on screen, selectable, next
// to the button.
//
// Props
//   value      The text to copy.
//   className  Optional classes of the button.

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { copyLink } from "@/components/forum/share-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const t = useTranslations("forum.copyButton");
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);

  async function copy() {
    clearTimeout(reset.current);
    if (!(await copyLink(value, navigator))) {
      setStatus("failed");
      return;
    }
    setStatus("copied");
    reset.current = setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        variant="outline"
        onClick={copy}
        className={cn(
          "min-h-10 px-4",
          status === "copied" && "text-success",
          className,
        )}
      >
        {status === "copied" ? <Check /> : <Copy />}
        {status === "copied" ? t("copied") : t("copy")}
      </Button>
      <output
        aria-live="polite"
        className="text-xs text-muted-foreground empty:hidden"
      >
        {status === "failed" ? t("failed") : null}
      </output>
    </div>
  );
}
