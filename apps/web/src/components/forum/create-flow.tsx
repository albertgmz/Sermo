"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartBar, CircleHelp, MessagesSquare, PenLine, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { forumComposeAccessAction } from "@/app/[locale]/(main)/forums/actions";
import { postToWall } from "@/app/[locale]/(main)/members/actions";
import { WallPostForm } from "@/app/[locale]/(main)/members/post-composer";
import { loadCreateAction } from "@/components/forum/create-actions";
import {
  type CreateData,
  type CreateKind,
  type CreateStep,
  createOptions,
  focusComposer,
  focusFirstOption,
  isThreadKind,
  onNewThreadPage,
  stepAfterPick,
  type ThreadKind,
} from "@/components/forum/create-kinds";
import { ForumChoicePanel } from "@/components/forum/forum-choice-panel";
import { ThreadComposer } from "@/components/forum/thread-composer";
import {
  draftMovedOn,
  readThreadDraft,
  type ThreadDraft,
} from "@/components/forum/thread-draft";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const ICONS = {
  discussion: MessagesSquare,
  question: CircleHelp,
  poll: ChartBar,
  wall: PenLine,
} as const;

// What a thread's composer is first drawn with: what the member may add in the forum they chose.
// How long what the flow read stays good: a reopening within it asks nothing.
const REFRESH_MS = 60_000;

type Access = {
  forumId: number;
  attach: boolean;
  poll: boolean;
  prefixes: PrefixView[];
  requirePrefix: boolean;
};

// The dialog is the whole screen; each step is a column in its middle: as wide as the forum's own
// for writing, narrower for a choice. On a phone the column is the screen; from `md` it is a
// surface of its own, edged on both sides, over the screen's background.
const COLUMN = "mx-auto min-h-0 w-full flex-1 flex-col md:border-x md:bg-card";
const CHOICE = cn(COLUMN, "max-w-2xl");
const WRITING = cn(COLUMN, "max-w-(--container-width)");
export const STEP_COLUMN = { choice: CHOICE, writing: WRITING };

// The answer of the one read the flow makes. A refusal throws, so that a read that fails after an
// earlier one worked leaves what was loaded in place.
async function loadCreate(): Promise<CreateData> {
  const loaded = await loadCreateAction();
  if (!loaded.ok) throw new Error("create");
  return loaded.data;
}

// A wall post goes to the member's own wall, which the form never names: the id comes from the read.
export function wallPostAction(memberId: number) {
  return postToWall.bind(null, memberId, `/members/${memberId}`);
}

// The options and their loading shape: one list, the same grid.
const TILES = "space-y-1 md:grid md:grid-cols-2 md:gap-3 md:space-y-0";

function ChooserHeader({ title, close }: { title: string; close: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b p-2">
      <span aria-hidden="true" className="px-2 text-base font-semibold">
        {title}
      </span>
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

// The first step: what the member may write, or the reason there is nothing to choose yet. A list
// on a phone; from `md` a question and tiles two by two, in the middle of the screen's height.
export function CreateChooser({
  data,
  failed,
  threads = true,
  onPick,
  onRetry,
}: {
  // What the one read answered; none while it is on its way or when it was refused.
  data: CreateData | undefined;
  failed: boolean;
  // False on the page that is a thread composer itself.
  threads?: boolean;
  onPick: (kind: CreateKind) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("forum.createFlow");
  const options = data ? createOptions(data, threads) : [];
  return (
    <div className={cn(CHOICE, "flex")}>
      <ChooserHeader title={t("title")} close={t("aria.close")} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2 md:p-6">
        {/* Auto margins centre it and, unlike centring the column, keep its top in reach when it
            is taller than the screen. */}
        <div data-chooser-body="" className="md:my-auto">
          <h2 className="mb-5 hidden text-center text-xl font-semibold md:block">
            {t("prompt")}
          </h2>
          {data ? (
            options.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {t("nothing")}
              </p>
            ) : (
              <ul className={TILES}>
                {options.map((option) => {
                  const Icon = ICONS[option];
                  return (
                    <li key={option}>
                      <button
                        type="button"
                        data-create-option={option}
                        onClick={() => onPick(option)}
                        className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-full md:min-h-36 md:flex-col md:items-start md:border md:p-4 md:hover:border-ring"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background">
                          <Icon
                            aria-hidden="true"
                            className="size-5 text-primary-ink"
                          />
                        </span>
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
            <div role="status" aria-label={t("loading")} className={TILES}>
              {[1, 2, 3, 4].map((row) => (
                <Skeleton key={row} className="h-14 w-full md:h-36" />
              ))}
            </div>
          )}
        </div>
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
}: {
  // Counts the times the dialog was opened.
  visit: number;
}) {
  const t = useTranslations("forum.createFlow");
  const pathname = usePathname();
  const query = useQuery({
    queryKey: ["create"],
    queryFn: loadCreate,
    staleTime: REFRESH_MS,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const [step, setStep] = useState<CreateStep>("kind");
  const [kind, setKind] = useState<CreateKind>("discussion");
  const [threadKind, setThreadKind] = useState<ThreadKind>("discussion");
  const [forumId, setForumId] = useState<number | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [accessFailed, setAccessFailed] = useState(false);
  const [wallOpened, setWallOpened] = useState(false);
  // Counts the times a poll was chosen, so that choosing it again opens a section that was removed.
  const [pollAsk, setPollAsk] = useState(0);
  const asked = useRef(0);
  // The draft the thread composer holds, to tell when the one kept in the tab has moved on.
  const seenDraft = useRef<ThreadDraft | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Each opening starts at the choice, and asks again what the member may do when what it knows is
  // old (a long visit to the page can outlast a change of permissions or a new forum).
  const refetch = useRef(query.refetch);
  refetch.current = query.refetch;
  const updatedAt = useRef(query.dataUpdatedAt);
  updatedAt.current = query.dataUpdatedAt;
  useEffect(() => {
    setStep("kind");
    if (visit > 1 && Date.now() - updatedAt.current > REFRESH_MS) {
      void refetch.current();
    }
  }, [visit]);

  // The first option takes focus once the choice is drawn: the options are not there when the
  // dialog opens the first time, and on later openings the step changes after it has.
  const choosing = step === "kind" && data !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `visit` is what makes it run again.
  useEffect(() => {
    if (!choosing) return;
    focusFirstOption(rootRef.current);
  }, [choosing, visit]);

  // The composer shown takes focus: the title of a thread, the text of a wall post.
  const threadOn = step === "compose" && isThreadKind(kind);
  const wallOn = step === "compose" && kind === "wall";
  const ready = threadOn ? access !== null : wallOn && wallOpened;
  useEffect(() => {
    if (!ready) return;
    focusComposer(rootRef.current, wallOn ? "wall" : "thread");
  }, [ready, wallOn]);

  // The thread composer is drawn anew for a forum: what the member may add there is asked first, and
  // a read that fails is said so, with a retry, rather than taken for a refusal.
  function startThread(id: number) {
    setForumId(id);
    setAccess(null);
    setAccessFailed(false);
    seenDraft.current = null;
    const turn = ++asked.current;
    forumComposeAccessAction(id).then(
      (allowed) => {
        if (turn !== asked.current) return;
        if (allowed) setAccess({ forumId: id, ...allowed });
        else setAccessFailed(true);
      },
      () => {
        if (turn === asked.current) setAccessFailed(true);
      },
    );
  }

  function pick(next: CreateKind) {
    setKind(next);
    if (next === "wall") setWallOpened(true);
    else {
      setThreadKind(next);
      if (next === "poll") setPollAsk((count) => count + 1);
      // The composer was left hidden while the draft kept in the tab may have been changed (or sent)
      // on the page of its own; it must not write its older copy over it.
      if (
        forumId !== null &&
        access !== null &&
        data &&
        draftMovedOn(
          readThreadDraft(data.memberId),
          seenDraft.current,
          sending.current,
        )
      ) {
        startThread(forumId);
      }
    }
    setStep(stepAfterPick(next, forumId));
  }

  const chooseForum = (id: number) => {
    setStep("compose");
    startThread(id);
  };
  const keepDraft = useCallback((draft: ThreadDraft) => {
    seenDraft.current = draft;
  }, []);
  const sending = useRef(false);
  const keepPending = useCallback((pending: boolean) => {
    sending.current = pending;
  }, []);

  const wall = data ? wallPostAction(data.memberId) : null;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DialogTitle className="sr-only">{t("title")}</DialogTitle>
      {step === "kind" && (
        <CreateChooser
          data={data}
          failed={query.isError}
          threads={!onNewThreadPage(pathname)}
          onPick={pick}
          onRetry={() => void query.refetch()}
        />
      )}
      {step === "forum" && data && (
        <div className={cn(CHOICE, "flex")}>
          <ForumChoicePanel
            forums={data.forums}
            current={null}
            onChoose={chooseForum}
            onBack={() => setStep("kind")}
          />
        </div>
      )}
      {data && forumId !== null && access && (
        <div
          data-create-mode="thread"
          className={cn(WRITING, threadOn ? "flex" : "hidden")}
        >
          <ThreadComposer
            frame="dialog"
            kind={threadKind}
            forumId={access.forumId}
            forums={data.forums}
            prefixes={access.prefixes}
            requirePrefix={access.requirePrefix}
            canAttach={access.attach}
            canPoll={access.poll}
            canTag={data.canTag}
            memberId={data.memberId}
            watchDefault={data.watchOnCreate}
            onDraft={keepDraft}
            onPending={keepPending}
            pollAsk={pollAsk}
            onForum={setForumId}
          />
        </div>
      )}
      {threadOn && access === null && (
        <div className={cn(WRITING, "flex")}>
          {accessFailed ? (
            <div className="space-y-3 px-2 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("accessFailed")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => forumId !== null && startThread(forumId)}
              >
                {t("retry")}
              </Button>
            </div>
          ) : (
            <div
              role="status"
              aria-label={t("loading")}
              className="space-y-3 p-3"
            >
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </div>
      )}
      {data && wall && wallOpened && (
        <div
          data-create-mode="wall"
          className={cn(WRITING, wallOn ? "flex" : "hidden")}
        >
          <WallPostForm
            action={wall}
            placeholder={t("wallPlaceholder")}
            name={t("wallName")}
            titled={false}
            grow
          />
        </div>
      )}
    </div>
  );
}
