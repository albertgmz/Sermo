"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useInlinePanel } from "@/components/forum/inline-panel";
import { Skeleton } from "@/components/ui/skeleton";

const PollEditor = dynamic(
  () =>
    import("@/components/forum/poll-editor").then(
      (module) => module.PollEditor,
    ),
  { loading: () => <Skeleton className="h-48 w-full" /> },
);

// Adds a poll or quiz to a thread that has none, for whoever `threads.get` says may
// (`poll.canAdd`). The thread's "•••" menu opens it under the thread's action row; the form is
// asked for then and takes the focus, and `onClose` closes it (Cancel, Escape: `useInlinePanel`).
export function PollAdder({
  threadId,
  attachIn,
  onClose,
}: {
  threadId: number;
  attachIn: number | null;
  onClose: () => void;
}) {
  const t = useTranslations("forum.poll");
  const panel = useInlinePanel(onClose);
  return (
    <section
      {...panel}
      aria-label={t("sectionLabel")}
      className="rounded-lg border bg-card p-3 md:p-4"
    >
      <PollEditor
        threadId={threadId}
        pollId={null}
        attachIn={attachIn}
        onClose={onClose}
      />
    </section>
  );
}
