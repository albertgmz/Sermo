"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  announce,
  closeOnEscape,
  holdNotice,
} from "@/components/forum/notice-store";
import { Button } from "@/components/ui/button";

// The visible card of a notice said in place, floating under the header. It is drawn only while a
// notice is shown, and its code comes with the first one (`PageNotice` loads it), not with the
// page. The words are read out by the page's live region; here they are only drawn. The wrapper
// takes no taps, only the card does, so nothing outside the card is covered for the few seconds it
// stays; the pointer on it or focus in it keeps it, and its button and Escape close it.
export function NoticeBox({
  text,
  closeLabel,
}: {
  text: string;
  closeLabel: string;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-4 top-[calc(var(--spacing-site-header)+0.5rem)] z-50 mx-auto max-w-md">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer and focus only keep the notice on screen; the close button and Escape are the actions */}
      <div
        className="pointer-events-auto flex items-start gap-2 rounded-lg border border-success/30 bg-[color-mix(in_oklab,var(--success)_10%,var(--background))] py-3 pr-2 pl-4 text-sm text-pretty shadow-md"
        onMouseEnter={() => holdNotice("hover", true)}
        onMouseLeave={() => holdNotice("hover", false)}
        onFocus={() => holdNotice("focus", true)}
        onBlur={() => holdNotice("focus", false)}
      >
        <Check
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-success"
        />
        <span aria-hidden="true" className="min-w-0 flex-1 self-center">
          {text}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-2 size-11 shrink-0"
          aria-label={closeLabel}
          onClick={() => announce(null)}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export default function NoticeCard({ text }: { text: string }) {
  const t = useTranslations("layout.noticeBanner");
  useEffect(() => closeOnEscape(document), []);
  return <NoticeBox text={text} closeLabel={t("dismiss")} />;
}
