"use client";

import { Check, Lock, Pencil, Users } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import {
  pollAddAnswerAction,
  pollCloseAction,
  pollDeleteAction,
  pollVoteAction,
} from "@/app/[locale]/(main)/threads/polls-actions";
import { DeleteControl } from "@/components/forum/delete-control";
import { FormError } from "@/components/forum/form-error";
import { PollVoters } from "@/components/forum/poll-voters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type PollAnswerView,
  type PollQuestionView,
  type PollView,
  percentOf,
} from "@/lib/sermo/polls";
import { cn } from "@/lib/utils";

// The quiz player and the editor are asked for only when they are needed: a poll is read and
// voted with this block alone.
const QuizPlayer = dynamic(
  () =>
    import("@/components/forum/quiz-player").then(
      (module) => module.QuizPlayer,
    ),
  { loading: () => <Skeleton className="h-40 w-full" /> },
);
const PollEditor = dynamic(
  () =>
    import("@/components/forum/poll-editor").then(
      (module) => module.PollEditor,
    ),
  { loading: () => <Skeleton className="h-48 w-full" /> },
);

// Pictures are drawn on the server, where the data saver is decided, and handed in by file id.
export type PollPictures = Record<number, ReactNode>;

function useAnswer() {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return { error, setError, pending, start };
}

// The poll or quiz of a thread: the question, its answers with the results where the viewer may
// see them, voting (or the quiz, one question at a time), closing, editing and deleting for whoever
// may. Counts are drawn only where the backend sent them; a hidden result is never a zero.
export function PollBlock({
  poll: first,
  threadId,
  pictures,
  signedIn,
  attachIn,
}: {
  poll: PollView;
  threadId: number;
  pictures: PollPictures;
  signedIn: boolean;
  attachIn: number | null;
}) {
  const t = useTranslations("forum.poll");
  const format = useFormatter();
  const [poll, setPoll] = useState(first);
  const [editing, setEditing] = useState(false);
  const closing = useAnswer();
  const quiz = poll.kind === "quiz";
  const { permissions } = poll;

  function toggleClosed() {
    closing.start(async () => {
      const answer = await pollCloseAction(threadId, poll.id, !poll.closed);
      if ("poll" in answer) {
        setPoll(answer.poll);
        closing.setError(undefined);
      } else closing.setError(answer.error || t("failed"));
    });
  }

  return (
    <section
      aria-label={t(quiz ? "quizLabel" : "pollLabel")}
      className="mt-4 rounded-lg border bg-card p-3 md:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold tracking-wide text-primary-ink uppercase">
          {t(quiz ? "kindQuiz" : "kindPoll")}
        </span>
        {poll.anonymous && <span>{t("anonymousNote")}</span>}
        {poll.closed ? (
          <span className="inline-flex items-center gap-1">
            <Lock aria-hidden="true" className="size-3.5" />
            {t("closed")}
          </span>
        ) : (
          poll.closesAt && (
            <span>
              {t("closesOn", {
                date: format.dateTime(new Date(poll.closesAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </span>
          )
        )}
      </div>

      {editing ? (
        <div className="mt-3">
          <PollEditor
            threadId={threadId}
            pollId={poll.id}
            attachIn={attachIn}
            onClose={() => setEditing(false)}
          />
        </div>
      ) : quiz ? (
        <QuizPlayer
          poll={poll}
          threadId={threadId}
          pictures={pictures}
          signedIn={signedIn}
          onPoll={setPoll}
        />
      ) : (
        <PollQuestion
          poll={poll}
          threadId={threadId}
          pictures={pictures}
          signedIn={signedIn}
          onPoll={setPoll}
        />
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
          {poll.voterCount !== null && (
            <p
              data-nosnippet
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Users aria-hidden="true" className="size-3.5" />
              {t(quiz ? "takers" : "voters", { n: poll.voterCount })}
            </p>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {permissions.canEdit && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-3 text-muted-foreground md:h-8"
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden="true" />
                {t("edit")}
              </Button>
            )}
            {permissions.canClose && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-3 text-muted-foreground md:h-8"
                disabled={closing.pending}
                onClick={toggleClosed}
              >
                {poll.closed ? t("reopen") : t("close")}
              </Button>
            )}
            {permissions.canDelete && (
              <DeleteControl
                action={pollDeleteAction.bind(null, threadId, poll.id)}
                label={t("delete")}
                confirm={t("deleteConfirm")}
                cancel={t("cancel")}
                reasonLabel={t("deleteReason")}
                warning={t("deleteWarning")}
              />
            )}
          </div>
          {closing.error && <FormError>{closing.error}</FormError>}
        </div>
      )}
    </section>
  );
}

function AnswerRow({
  answer,
  poll,
  threadId,
  picture,
  mode,
  checked,
  group,
  onPick,
}: {
  answer: PollAnswerView;
  poll: PollView;
  threadId: number;
  picture: ReactNode;
  mode: "radio" | "checkbox" | null;
  checked: boolean;
  group: string;
  onPick: () => void;
}) {
  const t = useTranslations("forum.poll");
  const total = poll.voterCount ?? 0;
  const shown = answer.votes !== null;
  const percent = percentOf(answer.votes ?? 0, total);
  const bar = (
    <>
      {shown && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-primary/15"
          style={{ width: `${percent}%` }}
        />
      )}
    </>
  );
  const rest = (
    <>
      {!mode && answer.chosen && (
        <Check
          aria-label={t("yourVote")}
          className="relative size-4 shrink-0 text-primary-ink"
        />
      )}
      <span className="relative min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
        {answer.text}
        {answer.custom && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {t("addedByVoter")}
          </span>
        )}
      </span>
      {shown && (
        <span className="relative shrink-0 text-xs text-muted-foreground tabular-nums">
          {t("share", { percent, n: answer.votes ?? 0 })}
        </span>
      )}
    </>
  );
  const box =
    "relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg border px-3 py-2";
  return (
    <li className="space-y-1.5">
      {picture}
      {mode ? (
        <label className={cn(box, "cursor-pointer hover:border-ring")}>
          {bar}
          <input
            type={mode}
            name={group}
            checked={checked}
            onChange={onPick}
            className="relative size-5 shrink-0"
          />
          {rest}
        </label>
      ) : (
        <div className={box}>
          {bar}
          {rest}
        </div>
      )}
      {poll.permissions.canViewVoters &&
        answer.votes !== null &&
        answer.votes > 0 && (
          <PollVoters
            threadId={threadId}
            pollId={poll.id}
            answerId={answer.id}
          />
        )}
    </li>
  );
}

function PollQuestion({
  poll,
  threadId,
  pictures,
  signedIn,
  onPoll,
}: {
  poll: PollView;
  threadId: number;
  pictures: PollPictures;
  signedIn: boolean;
  onPoll: (poll: PollView) => void;
}) {
  const t = useTranslations("forum.poll");
  const question = poll.questions[0] as PollQuestionView;
  const voting = poll.permissions.canVote;
  const multiple = poll.maxChoices > 1;
  const [picked, setPicked] = useState<number[]>(
    question.answers.filter((answer) => answer.chosen).map((a) => a.id),
  );
  const [text, setText] = useState("");
  const vote = useAnswer();
  const add = useAnswer();

  function pick(id: number) {
    setPicked((current) => {
      if (!multiple) return [id];
      if (current.includes(id)) return current.filter((item) => item !== id);
      // Past the limit the oldest choice makes room.
      return [...current, id].slice(-poll.maxChoices);
    });
  }

  function send() {
    vote.start(async () => {
      const answer = await pollVoteAction(
        threadId,
        poll.id,
        question.id,
        picked,
      );
      if ("poll" in answer) {
        onPoll(answer.poll);
        vote.setError(undefined);
      } else vote.setError(answer.error || t("failed"));
    });
  }

  function addAnswer() {
    add.start(async () => {
      const answer = await pollAddAnswerAction(threadId, poll.id, text);
      if ("poll" in answer) {
        onPoll(answer.poll);
        setText("");
        add.setError(undefined);
      } else add.setError(answer.error || t("failed"));
    });
  }

  const same =
    picked.length === question.answers.filter((a) => a.chosen).length &&
    question.answers.every((a) => a.chosen === picked.includes(a.id));
  let note: string | null = null;
  if (!voting) {
    if (poll.closed) note = null;
    else if (poll.mine.voted && !poll.allowChange) note = t("votedFinal");
    else if (!signedIn) note = "signIn";
    else note = t("cannotVote");
  }
  const group = `poll-${poll.id}`;

  return (
    <div className="mt-2 space-y-3">
      <h2 className="text-base font-semibold [overflow-wrap:anywhere]">
        {question.text}
      </h2>
      {question.image && pictures[question.image.fileId]}
      <ul data-nosnippet aria-label={t("answersLabel")} className="space-y-2">
        {question.answers.map((answer) => (
          <AnswerRow
            key={answer.id}
            answer={answer}
            poll={poll}
            threadId={threadId}
            picture={answer.image ? pictures[answer.image.fileId] : null}
            mode={voting ? (multiple ? "checkbox" : "radio") : null}
            checked={picked.includes(answer.id)}
            group={group}
            onPick={() => pick(answer.id)}
          />
        ))}
      </ul>
      {voting && (
        <div className="space-y-1">
          {multiple && (
            <p className="text-xs text-muted-foreground">
              {t("pickUpTo", { n: poll.maxChoices })}
            </p>
          )}
          <Button
            type="button"
            className="h-10 px-4"
            disabled={vote.pending || picked.length === 0 || same}
            onClick={send}
          >
            {poll.mine.voted ? t("changeVote") : t("vote")}
          </Button>
          {vote.error && <FormError>{vote.error}</FormError>}
        </div>
      )}
      {note === "signIn" ? (
        <p className="text-sm text-muted-foreground">
          <Link
            href={`/login?next=${encodeURIComponent(`/threads/${threadId}`)}`}
            className="font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
          >
            {t("signIn")}
          </Link>{" "}
          {t("toVote")}
        </p>
      ) : (
        note && <p className="text-sm text-muted-foreground">{note}</p>
      )}
      {!poll.resultsShown && (
        <p className="text-sm text-muted-foreground">
          {t(
            poll.results === "after_close"
              ? "resultsAfterCloseNote"
              : "resultsAfterVoteNote",
          )}
        </p>
      )}
      {poll.permissions.canAddAnswer && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("customPlaceholder")}
              aria-label={t("customLabel")}
              autoComplete="off"
              className="h-10 md:h-8"
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 px-3 md:h-8"
              disabled={add.pending || text.trim() === ""}
              onClick={addAnswer}
            >
              {t("addAnswerButton")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("customRules")}</p>
          {add.error && <FormError>{add.error}</FormError>}
        </div>
      )}
    </div>
  );
}
