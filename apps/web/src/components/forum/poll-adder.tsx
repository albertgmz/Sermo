"use client";

import { ChartBar } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useInlinePanel } from "@/components/forum/inline-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PollEditor = dynamic(
  () =>
    import("@/components/forum/poll-editor").then(
      (module) => module.PollEditor,
    ),
  { loading: () => <Skeleton className="h-48 w-full" /> },
);

// Adds a poll or quiz to a thread that has none, for whoever `threads.get` says may
// (`poll.canAdd`). The form is asked for when the button is pressed and opens in place
// (`useInlinePanel`).
export function PollAdder({
  threadId,
  attachIn,
}: {
  threadId: number;
  attachIn: number | null;
}) {
  const t = useTranslations("forum.poll");
  const panel = useInlinePanel();
  if (!panel.open)
    return (
      <Button
        ref={panel.button}
        type="button"
        variant="ghost"
        className="h-10 px-3 text-muted-foreground md:h-8"
        onClick={panel.show}
      >
        <ChartBar aria-hidden="true" />
        {t("add")}
      </Button>
    );
  return (
    <section
      {...panel.panel}
      aria-label={t("sectionLabel")}
      className="mt-4 rounded-lg border bg-card p-3 md:p-4"
    >
      <PollEditor
        threadId={threadId}
        pollId={null}
        attachIn={attachIn}
        onClose={panel.close}
      />
    </section>
  );
}
