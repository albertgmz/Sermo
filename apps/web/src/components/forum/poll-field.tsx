"use client";

import { ChartBar, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { blankDraft, draftToJson, type PollDraft } from "@/lib/sermo/polls";

// The form is asked for only when the member opens the section, so it is no part of the first
// load of the page that holds the composer.
const PollForm = dynamic(
  () =>
    import("@/components/forum/poll-form").then((module) => module.PollForm),
  { loading: () => <Skeleton className="h-48 w-full" /> },
);

// The poll or quiz of a new thread: a button that opens the form, and the draft as one JSON field
// (`name="poll"`) that the thread's action reads. Closed, or with nothing asked, the field is
// absent and the thread has no poll. Plugs into `ThreadComposer`, behind `canPoll`, like the tags.
export function PollField({ attachIn }: { attachIn: number | null }) {
  const t = useTranslations("forum.poll");
  const [draft, setDraft] = useState<PollDraft | null>(null);
  if (!draft) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-10 px-3 text-muted-foreground md:h-8"
        onClick={() => setDraft(blankDraft())}
      >
        <ChartBar aria-hidden="true" />
        {t("add")}
      </Button>
    );
  }
  return (
    <section aria-label={t("sectionLabel")} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("sectionTitle")}</h2>
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3 md:h-8"
          onClick={() => setDraft(null)}
        >
          <X aria-hidden="true" />
          {t("remove")}
        </Button>
      </div>
      <input type="hidden" name="poll" value={draftToJson(draft)} />
      <PollForm draft={draft} onChange={setDraft} attachIn={attachIn} />
    </section>
  );
}
