"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { pollVotersAction } from "@/app/[locale]/(main)/threads/polls-actions";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";

type Voter = { id: number; username: string };

// Who picked an answer of a poll whose voters are public: asked for when the member opens it, and
// by pages of fifty after that. The backend decides who may ask; a refusal is shown as it came.
export function PollVoters({
  threadId,
  pollId,
  answerId,
}: {
  threadId: number;
  pollId: number;
  answerId: number;
}) {
  const t = useTranslations("forum.poll");
  const [open, setOpen] = useState(false);
  const [voters, setVoters] = useState<Voter[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function load(cursor: string | null) {
    start(async () => {
      const answer = await pollVotersAction(threadId, pollId, answerId, cursor);
      if ("error" in answer) {
        setError(answer.error || t("failed"));
        return;
      }
      setError(undefined);
      setVoters((current) => [...current, ...answer.items]);
      setNext(answer.nextCursor);
    });
  }

  if (!open)
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-10 px-3 text-xs text-muted-foreground md:h-8"
        onClick={() => {
          setOpen(true);
          load(null);
        }}
      >
        {t("showVoters")}
      </Button>
    );
  return (
    <div className="space-y-1 pl-1">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {voters.map((voter) => (
          <li key={voter.id}>
            <Link
              href={`/members/${voter.id}`}
              className="text-primary-ink underline-offset-4 hover:underline"
            >
              {voter.username}
            </Link>
          </li>
        ))}
      </ul>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        {next && (
          <Button
            type="button"
            variant="ghost"
            className="h-10 px-3 text-xs md:h-8"
            disabled={pending}
            onClick={() => load(next)}
          >
            {t("moreVoters")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3 text-xs text-muted-foreground md:h-8"
          onClick={() => {
            setOpen(false);
            setVoters([]);
            setNext(null);
          }}
        >
          {t("hideVoters")}
        </Button>
      </div>
    </div>
  );
}
