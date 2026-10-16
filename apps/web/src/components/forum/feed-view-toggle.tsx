"use client";

import { LayoutList, Rows3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setFeedView } from "@/app/[locale]/(main)/_feed/view-actions";
import type { FeedView } from "@/lib/feed-view";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "cards", icon: Rows3 },
  { value: "compact", icon: LayoutList },
] as const;

// Cards or compact rows for the feed. The server keeps the choice (the member's account, a cookie
// for a guest) and draws the page again; the pressed button shows at once and goes back if the
// choice could not be kept.
export function FeedViewToggle({
  view,
  className,
}: {
  view: FeedView;
  className?: string;
}) {
  const t = useTranslations("forum.feedViewToggle");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState(view);
  const [failed, setFailed] = useState(false);
  const choose = (next: FeedView) => {
    if (next === chosen || pending) return;
    const before = chosen;
    setChosen(next);
    setFailed(false);
    start(async () => {
      const answer = await setFeedView(next).catch(() => null);
      if (answer?.ok) router.refresh();
      else {
        setChosen(before);
        setFailed(true);
      }
    });
  };
  return (
    <fieldset
      className={cn(
        "m-0 inline-flex min-w-0 rounded-md border bg-card p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{t("aria.label")}</legend>
      {OPTIONS.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={chosen === value}
          aria-label={t(`options.${value}`)}
          title={failed ? t("failed") : t(`options.${value}`)}
          onClick={() => choose(value)}
          className="inline-flex h-10 min-w-10 items-center justify-center rounded-sm px-2 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:text-primary-ink md:h-7 md:min-w-8 [&_svg]:size-4"
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
      <span role="status" className="sr-only">
        {failed ? t("failed") : ""}
      </span>
    </fieldset>
  );
}
