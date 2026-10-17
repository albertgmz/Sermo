"use client";

import { ImagePlus, LoaderCircle, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  blankAnswer,
  blankQuestion,
  type DraftAnswer,
  type DraftPicture,
  type DraftQuestion,
  listedAnswers,
  type PollDraft,
} from "@/lib/sermo/polls";
import { cn } from "@/lib/utils";

const FIELD = "h-10 md:h-8";
const SELECT =
  "h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8";
const ICON_BUTTON = "size-10 shrink-0 px-0 text-muted-foreground md:size-8";

// One picture for a question or an answer: the file is sent to the attachment route as soon as it
// is chosen and the poll names it by id, like the files of a post. No picture is drawn here (the
// form shows the file's name), so nothing in the form depends on the data saver.
function PicturePicker({
  picture,
  onChange,
  attachIn,
  disabled,
}: {
  picture: DraftPicture | null;
  onChange: (picture: DraftPicture | null) => void;
  attachIn: number | null;
  disabled: boolean;
}) {
  const t = useTranslations("forum.poll");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (attachIn === null && !picture) return null;
  async function send(file: File) {
    const body = new FormData();
    body.append("file", file, file.name);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/threads/${attachIn}/uploads`, {
        method: "POST",
        body,
      });
      const payload: { id?: number; error?: string } | null = await response
        .json()
        .catch(() => null);
      if (response.ok && typeof payload?.id === "number")
        onChange({ fileId: payload.id, name: file.name });
      else setError(payload?.error ?? t("pictureFailed"));
    } catch {
      setError(t("pictureFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      {picture ? (
        <>
          <span className="min-w-0 truncate text-muted-foreground">
            {t("picture", { name: picture.name })}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="h-10 px-3 md:h-8"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            {t("removePicture")}
          </Button>
        </>
      ) : (
        <label
          className={cn(
            "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-muted-foreground hover:text-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 md:h-8",
            (busy || disabled) && "pointer-events-none opacity-50",
          )}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ImagePlus aria-hidden="true" className="size-4" />
          )}
          {t("addPicture")}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (chosen) void send(chosen);
            }}
          />
        </label>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}

function AnswerRow({
  answer,
  index,
  quiz,
  group,
  locked,
  attachIn,
  canRemove,
  onChange,
  onRemove,
}: {
  answer: DraftAnswer;
  index: number;
  quiz: boolean;
  group: string;
  locked: boolean;
  attachIn: number | null;
  canRemove: boolean;
  onChange: (answer: DraftAnswer) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("forum.poll");
  const label = t("answerLabel", { n: index + 1 });
  return (
    <li className="space-y-1.5">
      <div className="flex items-center gap-2">
        {quiz && (
          <input
            type="radio"
            name={group}
            checked={answer.correct}
            disabled={locked}
            onChange={() => onChange({ ...answer, correct: true })}
            aria-label={t("markCorrect", { n: index + 1 })}
            className="size-5 shrink-0"
          />
        )}
        <Input
          value={answer.text}
          onChange={(event) =>
            onChange({ ...answer, text: event.target.value })
          }
          aria-label={label}
          placeholder={label}
          autoComplete="off"
          className={FIELD}
        />
        <Button
          type="button"
          variant="ghost"
          className={ICON_BUTTON}
          disabled={locked || !canRemove}
          onClick={onRemove}
          aria-label={t("removeAnswer", { n: index + 1 })}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {(answer.custom || (answer.votes ?? 0) > 0) && (
        <p className="pl-1 text-xs text-muted-foreground">
          {answer.custom ? t("addedByVoter") : ""}
          {answer.custom && (answer.votes ?? 0) > 0 ? " · " : ""}
          {(answer.votes ?? 0) > 0
            ? t("votesOnAnswer", { n: answer.votes ?? 0 })
            : ""}
        </p>
      )}
      <div className={cn(quiz && "pl-7")}>
        <PicturePicker
          picture={answer.picture}
          onChange={(picture) => onChange({ ...answer, picture })}
          attachIn={attachIn}
          disabled={false}
        />
      </div>
    </li>
  );
}

function QuestionEditor({
  question,
  index,
  quiz,
  locked,
  attachIn,
  canRemove,
  onChange,
  onRemove,
}: {
  question: DraftQuestion;
  index: number;
  quiz: boolean;
  locked: boolean;
  attachIn: number | null;
  canRemove: boolean;
  onChange: (question: DraftQuestion) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("forum.poll");
  const group = useId();
  const label = quiz
    ? t("questionLabelN", { n: index + 1 })
    : t("questionLabel");
  // One right answer: choosing one takes the mark off the others.
  const setAnswer = (at: number, answer: DraftAnswer) =>
    onChange({
      ...question,
      answers: question.answers.map((item, i) =>
        i === at ? answer : answer.correct ? { ...item, correct: false } : item,
      ),
    });
  return (
    <fieldset className="min-w-0 space-y-2.5 rounded-lg border bg-card/50 p-3">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center gap-2">
        <Input
          value={question.text}
          onChange={(event) =>
            onChange({ ...question, text: event.target.value })
          }
          aria-label={label}
          placeholder={label}
          autoComplete="off"
          className={cn(FIELD, "font-medium")}
        />
        {quiz && (
          <Button
            type="button"
            variant="ghost"
            className={ICON_BUTTON}
            disabled={locked || !canRemove}
            onClick={onRemove}
            aria-label={t("removeQuestion", { n: index + 1 })}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <PicturePicker
        picture={question.picture}
        onChange={(picture) => onChange({ ...question, picture })}
        attachIn={attachIn}
        disabled={false}
      />
      {quiz && (
        <p className="text-xs text-muted-foreground">{t("rightAnswerHelp")}</p>
      )}
      <ul className="space-y-2.5">
        {question.answers.map((answer, i) => (
          <AnswerRow
            key={answer.id ?? `new-${i}`}
            answer={answer}
            index={i}
            quiz={quiz}
            group={group}
            locked={locked}
            attachIn={attachIn}
            canRemove={question.answers.length > 2}
            onChange={(next) => setAnswer(i, next)}
            onRemove={() =>
              onChange({
                ...question,
                answers: question.answers.filter((_, at) => at !== i),
              })
            }
          />
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="h-10 px-3 md:h-8"
        disabled={locked}
        onClick={() =>
          onChange({
            ...question,
            answers: [...question.answers, blankAnswer()],
          })
        }
      >
        <Plus aria-hidden="true" />
        {t("addAnswer")}
      </Button>
      {quiz && (
        <div className="space-y-1">
          <label
            htmlFor={`${group}-why`}
            className="text-xs text-muted-foreground"
          >
            {t("explanationLabel")}
          </label>
          <Input
            id={`${group}-why`}
            value={question.explanation}
            onChange={(event) =>
              onChange({ ...question, explanation: event.target.value })
            }
            placeholder={t("explanationPlaceholder")}
            autoComplete="off"
            className={FIELD}
          />
        </div>
      )}
    </fieldset>
  );
}

// The poll or quiz a creator writes: what it asks, the answers (a quiz: one right answer each),
// and for a poll how it is voted and shown. It holds nothing of its own: the draft belongs to the
// parent, which sends it (in the new thread's form, or with Save). `existing` is set while an
// edit shows a poll that was made: its kind and anonymity are fixed, and a quiz someone has taken
// keeps its questions and right answers (`locked`).
export function PollForm({
  draft,
  onChange,
  attachIn,
  existing = false,
  locked = false,
  error,
}: {
  draft: PollDraft;
  onChange: (draft: PollDraft) => void;
  // The forum whose attachment route takes the pictures; null where files may not be attached.
  attachIn: number | null;
  existing?: boolean;
  locked?: boolean;
  error?: string;
}) {
  const t = useTranslations("forum.poll");
  const id = useId();
  const quiz = draft.kind === "quiz";
  const patch = (change: Partial<PollDraft>) =>
    onChange({ ...draft, ...change });
  const setQuestion = (at: number, question: DraftQuestion) =>
    patch({
      questions: draft.questions.map((item, i) => (i === at ? question : item)),
    });
  const answerCount = listedAnswers(draft);
  const choices = Array.from(
    { length: Math.max(answerCount, 1) },
    (_, i) => i + 1,
  );
  const kindButton = (kind: "poll" | "quiz") => (
    <button
      type="button"
      aria-pressed={draft.kind === kind}
      onClick={() =>
        patch({
          kind,
          // A poll is one question: the rest of a quiz is not carried over.
          questions:
            kind === "poll" ? draft.questions.slice(0, 1) : draft.questions,
        })
      }
      className={cn(
        "inline-flex min-h-10 items-center rounded-full px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring forced-colors:border md:min-h-8",
        draft.kind === kind
          ? "bg-primary text-primary-foreground"
          : "ring-1 ring-border hover:ring-ring",
      )}
    >
      {t(kind === "poll" ? "kindPoll" : "kindQuiz")}
    </button>
  );
  return (
    <div className="space-y-3">
      {!existing && (
        <fieldset className="flex gap-2">
          <legend className="sr-only">{t("kindLabel")}</legend>
          {kindButton("poll")}
          {kindButton("quiz")}
        </fieldset>
      )}
      {draft.questions.map((question, i) => (
        <QuestionEditor
          key={question.id ?? `q-${i}`}
          question={question}
          index={i}
          quiz={quiz}
          locked={locked}
          attachIn={attachIn}
          canRemove={draft.questions.length > 1}
          onChange={(next) => setQuestion(i, next)}
          onRemove={() =>
            patch({ questions: draft.questions.filter((_, at) => at !== i) })
          }
        />
      ))}
      {quiz && (
        <Button
          type="button"
          variant="outline"
          className="h-10 px-3 md:h-8"
          disabled={locked}
          onClick={() =>
            patch({ questions: [...draft.questions, blankQuestion()] })
          }
        >
          <Plus aria-hidden="true" />
          {t("addQuestion")}
        </Button>
      )}
      {locked && (
        <p className="text-xs text-muted-foreground">{t("lockedQuiz")}</p>
      )}
      <fieldset className="min-w-0 space-y-2.5">
        <legend className="sr-only">{t("settings")}</legend>
        {!quiz && (
          <div className="space-y-1">
            <label
              htmlFor={`${id}-max`}
              className="text-xs text-muted-foreground"
            >
              {t("maxChoices")}
            </label>
            <select
              id={`${id}-max`}
              value={Math.max(1, Math.min(draft.maxChoices, answerCount))}
              onChange={(event) =>
                patch({ maxChoices: Number(event.target.value) })
              }
              className={SELECT}
            >
              {choices.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? t("oneChoice") : t("upToChoices", { n })}
                </option>
              ))}
            </select>
          </div>
        )}
        {!quiz && (
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.allowCustom}
              onChange={(event) => patch({ allowCustom: event.target.checked })}
              className="size-5"
            />
            <span>
              {t("allowCustom")}
              <span className="block text-xs text-muted-foreground">
                {t("customHelp")}
              </span>
            </span>
          </label>
        )}
        {!quiz && (
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.allowChange}
              onChange={(event) => patch({ allowChange: event.target.checked })}
              className="size-5"
            />
            {t("allowChange")}
          </label>
        )}
        {!quiz && (
          <div className="space-y-1">
            <label
              htmlFor={`${id}-results`}
              className="text-xs text-muted-foreground"
            >
              {t("resultsLabel")}
            </label>
            <select
              id={`${id}-results`}
              value={draft.results}
              onChange={(event) =>
                patch({ results: event.target.value as PollDraft["results"] })
              }
              className={SELECT}
            >
              <option value="always">{t("resultsAlways")}</option>
              <option value="after_vote">{t("resultsAfterVote")}</option>
              <option value="after_close">{t("resultsAfterClose")}</option>
            </select>
          </div>
        )}
        {!existing && !quiz && (
          <label className="flex min-h-10 items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.anonymous}
              onChange={(event) => patch({ anonymous: event.target.checked })}
              className="mt-2.5 size-5"
            />
            <span className="pt-2">
              {t("anonymous")}
              <span className="block text-xs text-muted-foreground">
                {t("anonymousHelp")}
              </span>
            </span>
          </label>
        )}
        <div className="space-y-1">
          <label
            htmlFor={`${id}-close`}
            className="text-xs text-muted-foreground"
          >
            {t("closesAt")}
          </label>
          <Input
            id={`${id}-close`}
            type="datetime-local"
            value={draft.closesAt}
            onChange={(event) => patch({ closesAt: event.target.value })}
            className={FIELD}
          />
        </div>
      </fieldset>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
