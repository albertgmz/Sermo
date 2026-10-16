"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import {
  pollDefinitionAction,
  pollSaveAction,
} from "@/app/[locale]/(main)/threads/polls-actions";
import { PollForm } from "@/components/forum/poll-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  blankDraft,
  draftFromDefinition,
  draftToJson,
  mergeFresh,
  type PollDraft,
} from "@/lib/sermo/polls";

// Writes or changes the poll of a thread where it is read. With a `pollId` the definition is
// fetched first (it holds what a reader never gets: a quiz's right answers); without one the form
// starts blank and saving adds the poll. A save redraws the page, which draws the new poll.
export function PollEditor({
  threadId,
  pollId,
  attachIn,
  onClose,
}: {
  threadId: number;
  pollId: number | null;
  attachIn: number | null;
  onClose: () => void;
}) {
  const t = useTranslations("forum.poll");
  const [draft, setDraft] = useState<PollDraft | null>(
    pollId === null ? blankDraft() : null,
  );
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string>();
  // The poll changed since the form was loaded: what is typed is not saved over it.
  const [stale, setStale] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (pollId === null) return;
    let current = true;
    void pollDefinitionAction(threadId, pollId).then((answer) => {
      if (!current) return;
      if ("definition" in answer) {
        setDraft(draftFromDefinition(answer.definition));
        setLocked(
          answer.definition.kind === "quiz" &&
            answer.definition.ballotCount > 0,
        );
        setError(undefined);
        setStale(false);
      } else setError(answer.error || t("failed"));
    });
    return () => {
      current = false;
    };
  }, [threadId, pollId, t]);

  // Takes in what changed since the form was loaded and keeps what was typed.
  function reload() {
    if (pollId === null) return;
    start(async () => {
      const answer = await pollDefinitionAction(threadId, pollId);
      if ("definition" in answer) {
        setDraft((current) =>
          current ? mergeFresh(current, answer.definition) : current,
        );
        setStale(false);
        setError(undefined);
      } else setError(answer.error || t("failed"));
    });
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const answer = await pollSaveAction(
        threadId,
        pollId,
        draftToJson(draft),
        draft.loadedAt,
      );
      if ("poll" in answer) onClose();
      else if (answer.conflict) setStale(true);
      else setError(answer.error || t("failed"));
    });
  }

  if (!draft)
    return error ? (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    ) : (
      <Skeleton className="h-48 w-full" />
    );
  return (
    <div className="space-y-3">
      <PollForm
        draft={draft}
        onChange={setDraft}
        attachIn={attachIn}
        existing={pollId !== null}
        locked={locked}
        error={error}
      />
      {stale && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{t("changed")}</p>
          <Button
            type="button"
            variant="outline"
            className="h-10 px-3"
            disabled={pending}
            onClick={reload}
          >
            {t("reload")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-10 px-4"
          disabled={pending || stale}
          onClick={save}
        >
          {pollId === null ? t("create") : t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={onClose}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
