"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartBar, CircleHelp, MessagesSquare, PenLine, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useRef, useState } from "react";
import { forumComposeAccessAction } from "@/app/[locale]/(main)/forums/actions";
import { postToWall } from "@/app/[locale]/(main)/members/actions";
import { WallPostForm } from "@/app/[locale]/(main)/members/post-composer";
import { loadCreateAction } from "@/components/forum/create-actions";
import {
  type CreateData,
  type CreateKind,
  createOptions,
  isThreadKind,
  type ThreadKind,
} from "@/components/forum/create-kinds";
import { ForumChoicePanel } from "@/components/forum/forum-choice-panel";
import { ThreadComposer } from "@/components/forum/thread-composer";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ICONS = {
  discussion: MessagesSquare,
  question: CircleHelp,
  poll: ChartBar,
  wall: PenLine,
} as const;

type Step = "kind" | "forum" | "compose";

// What a thread's composer is first drawn with: what the member may add in the forum they chose.
type Access = { forumId: number; attach: boolean; poll: boolean };

// The answer of the one read the flow makes. A refusal throws, so that a read that fails after an
// earlier one worked leaves what was loaded in place.
async function loadCreate(): Promise<CreateData> {
  const loaded = await loadCreateAction();
  if (!loaded.ok) throw new Error("create");
  return loaded.data;
}

// The field of the composer that is shown, which takes focus when it comes up.
const FIELDS = 'input[name="title"], textarea, [contenteditable]';

function ChooserHeader({ title, close }: { title: string; close: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b p-2">
      <DialogTitle className="px-2 text-base font-semibold">
        {title}
      </DialogTitle>
      <DialogClose
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={close}
            className="size-10"
          />
        }
      >
        <X />
      </DialogClose>
    </div>
  );
}

// The first step: what the member may write, or the reason there is nothing to choose yet.
export function CreateChooser({
  data,
  failed,
  onPick,
  onRetry,
}: {
  // What the one read answered; none while it is on its way or when it was refused.
  data: CreateData | undefined;
  failed: boolean;
  onPick: (kind: CreateKind) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("forum.createFlow");
  const options = data ? createOptions(data) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChooserHeader title={t("title")} close={t("aria.close")} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {data ? (
          options.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("nothing")}
            </p>
          ) : (
            <ul className="space-y-1">
              {options.map((option) => {
                const Icon = ICONS[option];
                return (
                  <li key={option}>
                    <button
                      type="button"
                      data-create-option={option}
                      onClick={() => onPick(option)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-5 shrink-0 text-primary-ink"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                          {t(`kinds.${option}.title`)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t(`kinds.${option}.description`)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : failed ? (
          <div className="space-y-3 px-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">{t("failed")}</p>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={onRetry}
            >
              {t("retry")}
            </Button>
          </div>
        ) : (
          <div role="status" aria-label={t("loading")} className="space-y-1">
            {[1, 2, 3, 4].map((row) => (
              <Skeleton key={row} className="h-14 w-full" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// What the Create button's dialog holds, in three steps that all draw in the dialog itself: what to
// write (the options this member has), the forum for a thread (the shared list, with its search
// and folding categories), and the composer. A wall post and a thread are two modes of the shared
// composer; both stay drawn, hidden, once they were opened, so going back to the choice loses
// nothing. Each opening of the dialog starts at the choice.
export function CreateFlow({
  visit,
  rootRef,
  onSent,
}: {
  // Counts the times the dialog was opened.
  visit: number;
  rootRef: RefObject<HTMLDivElement | null>;
  // A post was taken and the page navigated.
  onSent: () => void;
}) {
  const t = useTranslations("forum.createFlow");
  const query = useQuery({
    queryKey: ["create"],
    queryFn: loadCreate,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const [step, setStep] = useState<Step>("kind");
  const [kind, setKind] = useState<CreateKind>("discussion");
  const [threadKind, setThreadKind] = useState<ThreadKind>("discussion");
  const [forumId, setForumId] = useState<number | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [wallOpened, setWallOpened] = useState(false);
  const asked = useRef(0);

  // Each opening starts at the choice, and asks again what the member may do (a long visit to the
  // page can outlast a change of permissions or a new forum).
  const refetch = useRef(query.refetch);
  refetch.current = query.refetch;
  useEffect(() => {
    setStep("kind");
    if (visit > 1) void refetch.current();
  }, [visit]);

  // The composer shown takes focus: the title of a thread, the text of a wall post.
  const threadOn = step === "compose" && isThreadKind(kind);
  const wallOn = step === "compose" && kind === "wall";
  const ready = threadOn ? access !== null : wallOn && wallOpened;
  useEffect(() => {
    if (!ready) return;
    const mode = wallOn ? "wall" : "thread";
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-create-mode="${mode}"]`)
      ?.querySelector<HTMLElement>(FIELDS)
      ?.focus();
  }, [ready, wallOn, rootRef]);

  function pick(next: CreateKind) {
    setKind(next);
    if (next === "wall") {
      setWallOpened(true);
      setStep("compose");
      return;
    }
    setThreadKind(next);
    setStep(forumId === null ? "forum" : "compose");
  }

  function chooseForum(id: number) {
    setForumId(id);
    setStep("compose");
    const turn = ++asked.current;
    forumComposeAccessAction(id).then(
      (allowed) => {
        if (turn === asked.current) setAccess({ forumId: id, ...allowed });
      },
      () => {
        if (turn === asked.current) {
          setAccess({ forumId: id, attach: false, poll: false });
        }
      },
    );
  }

  const wall = data
    ? postToWall.bind(null, data.memberId, `/members/${data.memberId}`)
    : null;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {step === "kind" && (
        <CreateChooser
          data={data}
          failed={query.isError}
          onPick={pick}
          onRetry={() => void query.refetch()}
        />
      )}
      {step === "forum" && data && (
        <ForumChoicePanel
          forums={data.forums}
          current={-1}
          onChoose={chooseForum}
          onBack={() => setStep("kind")}
        />
      )}
      {data && forumId !== null && access && (
        <div
          data-create-mode="thread"
          className={cn(
            "min-h-0 flex-1 flex-col",
            threadOn ? "flex" : "hidden",
          )}
        >
          <ThreadComposer
            frame="dialog"
            kind={threadKind}
            forumId={access.forumId}
            forums={data.forums}
            prefixes={data.prefixes}
            canAttach={access.attach}
            canPoll={access.poll}
            canTag={data.canTag}
            memberId={data.memberId}
            onSent={onSent}
          />
        </div>
      )}
      {threadOn && access === null && (
        <div role="status" aria-label={t("loading")} className="space-y-3 p-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {data && wall && wallOpened && (
        <div
          data-create-mode="wall"
          className={cn("min-h-0 flex-1 flex-col", wallOn ? "flex" : "hidden")}
        >
          <WallPostForm
            action={wall}
            placeholder={t("wallPlaceholder")}
            name={t("wallName")}
            onSent={onSent}
          />
        </div>
      )}
    </div>
  );
}
