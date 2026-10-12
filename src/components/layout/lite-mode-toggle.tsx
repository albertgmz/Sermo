"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { setLiteMode } from "@/app/(main)/actions";
import { PendingButton } from "@/components/forum/pending-button";

export function LiteModeToggle({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <form action={setLiteMode}>
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <input
        type="hidden"
        name="returnTo"
        value={pathname + (search ? `?${search}` : "")}
      />
      <PendingButton
        variant="outline"
        className="h-10 px-3"
        aria-pressed={enabled}
        aria-label={`Turn ${enabled ? "off" : "on"} LITE mode`}
      >
        LITE mode: {enabled ? "On" : "Off"}
      </PendingButton>
    </form>
  );
}
