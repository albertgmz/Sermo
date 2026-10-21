"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

// A network with no address to open (a Discord name) is shown as a button that copies the handle.
export function CopyHandle({
  handle,
  label,
  copiedLabel,
  className,
  children,
}: {
  handle: string;
  label: string;
  copiedLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!(await copyText(handle, navigator))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
      className={cn(className, copied && "text-success")}
    >
      {copied ? <Check className="size-5" /> : children}
    </button>
  );
}
