"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { pollVoteAction } from "@/app/[locale]/(main)/threads/polls-actions";
import { FormError } from "@/components/forum/form-error";
import type { PollPictures } from "@/components/forum/poll-block";
import { Button } from "@/components/ui/button";
import type { PollQuestionView, PollView } from "@/lib/sermo/polls";
import { cn } from "@/lib/utils";

// A question that was answered: what the member chose, the right answer and why, in one place. Only
// questions the backend has marked answered carry a right answer, so nothing here can show one early.
function Feedback({ question }: { question: PollQuestionView }) {
  const t = useTranslations("forum.poll");
  const chosen = question.answers.find((answer) => answer.chosen);
  const right = question.answers.find((answer) => answer.correct);
  const wasRight = chosen?.id === right?.id;
  return (
    <div
      role="status"
      className={cn(
        "space-y-1 rounded-lg border p-3 text-sm",
        wasRight ? "border-primary" : "border-destructive",
      )}
    >
      <p
        className={cn(
          "inline-flex items-center gap-1.5 font-semibold",
          wasRight ? "text-primary-ink" : "text-destructive",
        )}
      >
        {wasRight ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <X aria-hidden="true" className="size-4" />
        )}
        {t(wasRight ? "right" : "wrong")}
      </p>
      {!wasRight && right && (
        <p>{t("rightAnswerIs", { answer: right.text })}</p>
      )}
      {question.explanation && (
        <p className="text-muted-foreground">{question.explanation}</p>
      )}
    </div>
  );
}

// A quiz taken one question at a time: the question and its answers, then what was right and why,
// then the next question; at the end the score. What was answered is kept by the backend, so a
// member who comes back starts at the first question they have not answered, or at their score.
export function QuizPlayer({
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
  const total = poll.questions.length;
  const firstOpen = poll.questions.findIndex((question) => !question.answered);
  const [index, setIndex] = useState(firstOpen === -1 ? total : firstOpen);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const question = poll.questions[index];

  // A quiz nobody may answer shows its size and why, never its questions' answers.
  if (!poll.mine.voted && !poll.permissions.canVote)
    return (
      <div className="mt-2 space-y-1">
        <p className="text-sm text-muted-foreground">
          {t("quizSize", { n: total })}
        </p>
        {poll.closed ? (
          <p className="text-sm text-muted-foreground">{t("quizClosed")}</p>
        ) : signedIn ? (
          <p className="text-sm text-muted-foreground">{t("cannotVote")}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/login?next=${encodeURIComponent(`/threads/${threadId}`)}`}
              className="font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
            >
              {t("signIn")}
            </Link>{" "}
            {t("toTakeQuiz")}
          </p>
        )}
      </div>
    );

  if (!question)
    return (
      <div className="mt-2 space-y-3">
        <p className="text-lg font-semibold">
          {t("score", { correct: poll.mine.correct, total })}
        </p>
        {!poll.mine.completed && (
          <p className="text-sm text-muted-foreground">{t("quizOpenLeft")}</p>
        )}
        <ol className="space-y-3">
          {poll.questions.map((item, i) => (
            <li key={item.id} className="space-y-1.5">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                {t("questionOf", { n: i + 1, total })} {item.text}
              </p>
              {item.answered && <Feedback question={item} />}
            </li>
          ))}
        </ol>
        {poll.permissions.canVote && firstOpen !== -1 && (
          <Button
            type="button"
            className="h-10 px-4"
            onClick={() => setIndex(firstOpen)}
          >
            {t("continueQuiz")}
          </Button>
        )}
      </div>
    );

  const answered = question.answered;
  // Nothing more can be answered (closed, or the right to answer is gone): the questions answered
  // keep their feedback, the others say why they cannot be answered.
  const locked = !answered && !poll.permissions.canVote;

  function send() {
    if (picked === null || !question) return;
    start(async () => {
      const answer = await pollVoteAction(threadId, poll.id, question.id, [
        picked,
      ]);
      if ("poll" in answer) {
        onPoll(answer.poll);
        setError(undefined);
      } else setError(answer.error || t("failed"));
    });
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("questionOf", { n: index + 1, total })}
      </p>
      <h2 className="text-base font-semibold [overflow-wrap:anywhere]">
        {question.text}
      </h2>
      {question.image && pictures[question.image.fileId]}
      <ul className="space-y-2">
        {question.answers.map((answer) => {
          const mark = answered
            ? answer.correct
              ? "border-primary"
              : answer.chosen
                ? "border-destructive"
                : ""
            : "";
          return (
            <li key={answer.id} className="space-y-1.5">
              {answer.image && pictures[answer.image.fileId]}
              <label
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2",
                  answered
                    ? "cursor-default"
                    : "cursor-pointer hover:border-ring",
                  mark,
                )}
              >
                <input
                  type="radio"
                  name={`quiz-${poll.id}-${question.id}`}
                  disabled={answered || pending || locked}
                  checked={answered ? answer.chosen : picked === answer.id}
                  onChange={() => setPicked(answer.id)}
                  className="size-5 shrink-0"
                />
                <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                  {answer.text}
                </span>
                {answered && answer.correct && (
                  <Check
                    aria-label={t("rightAnswer")}
                    className="size-4 shrink-0 text-primary-ink"
                  />
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {answered ? (
        <>
          <Feedback question={question} />
          <Button
            type="button"
            className="h-10 px-4"
            onClick={() => {
              setPicked(null);
              setIndex(index + 1);
            }}
          >
            {index + 1 < total ? t("nextQuestion") : t("seeScore")}
          </Button>
        </>
      ) : locked ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t(poll.closed ? "quizClosed" : "cannotVote")}
          </p>
          <Button
            type="button"
            className="h-10 px-4"
            onClick={() => setIndex(total)}
          >
            {t("seeScore")}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          className="h-10 px-4"
          disabled={pending || picked === null}
          onClick={send}
        >
          {t("answer")}
        </Button>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
