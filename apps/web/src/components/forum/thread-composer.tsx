"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import {
  createThreadAction,
  forumComposeAccessAction,
} from "@/app/[locale]/(main)/forums/actions";
import { ComposerForm, ComposerPage } from "@/components/forum/composer";
import type { ThreadKind } from "@/components/forum/create-kinds";
import { ForumChoicePanel } from "@/components/forum/forum-choice-panel";
import { type ForumChoice, forumTitle } from "@/components/forum/forum-choices";
import { PollField } from "@/components/forum/poll-field";
import { PrefixTag } from "@/components/forum/prefix-tag";
import {
  clearThreadDraft,
  readThreadDraft,
  type ThreadDraft,
  writeThreadDraft,
} from "@/components/forum/thread-draft";
import { ThreadTagsField } from "@/components/forum/thread-tags-field";
import { useKeptForm } from "@/components/forum/use-kept-form";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// A thread can be sent once it has a title and a first post.
export function threadReady(title: string, body: string) {
  return title.trim() !== "" && body.trim() !== "";
}

// A thread is sent from the composer, never from the choice of forum that stands in its place.
export function sendUnlessPicking(
  picking: boolean,
  event: { preventDefault: () => void },
  send: () => void,
) {
  if (picking) event.preventDefault();
  else send();
}

// Where the composer is visited. The forum is changed in place, so the address follows without a
// navigation, which would start the page, and the draft, over.
export function composeAddress(forumId: number) {
  return `/forums/${forumId}/new`;
}

// Starting a thread, written like a post: close and Post at the top, the forum it goes to as a
// chip that opens the forum choice, the title as a line of its own, the prefix as chips, then the
// text in the shared composer. The forum, the title, the prefix and the text are all kept when the
// forum is changed, when the post is refused and while the choice of forum is open. The title, the
// prefix and the text are also kept in the tab (`thread-draft`) when the composer is closed or the
// page is reloaded, until the thread is sent.
export function ThreadComposer({
  forumId,
  forums,
  prefixes,
  canAttach,
  canTag,
  canPoll,
  memberId,
  frame = "page",
  kind = "discussion",
  onSent,
}: {
  forumId: number;
  // The forums the member may start a thread in, under the categories that hold them.
  forums: ForumChoice[];
  prefixes: PrefixView[];
  canAttach: boolean;
  // The member may put tags on a thread (tag.apply): the field for them is shown.
  canTag: boolean;
  // The member may start a poll or quiz with the thread (poll.create in the forum): the section is shown.
  canPoll: boolean;
  // Whose draft is kept in the tab; none is kept without one.
  memberId: number | null;
  // `page`: the address `/forums/<id>/new`, which follows the forum. `dialog`: inside the Create
  // button's dialog, on whatever page the member is on, which no address follows.
  frame?: "page" | "dialog";
  // What the member asked to write. A question is a discussion worded as one (the backend has no
  // thread type for it); a poll opens the poll section.
  kind?: ThreadKind;
  // The thread was taken (the action redirected), for a composer that is not drawn anew by it.
  onSent?: () => void;
}) {
  const t = useTranslations("forum.threadComposer");
  const [forum, setForum] = useState(forumId);
  const [attach, setAttach] = useState(canAttach);
  const [poll, setPoll] = useState(canPoll);
  const [picking, setPicking] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prefixId, setPrefixId] = useState("");
  // A kept prefix that has since been removed is not one.
  const prefix = prefixes.some((item) => String(item.id) === prefixId)
    ? prefixId
    : "";
  const form = useRef<HTMLFormElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const wasPicking = useRef(false);
  // The forum the post goes to when it is sent, read then and not when the form was drawn.
  const target = useRef(forumId);
  const asked = useRef(0);
  const {
    state,
    pending,
    onSubmit: send,
  } = useKeptForm(
    (previous, data) => createThreadAction(target.current, previous, data),
    onSent,
  );

  // A poll asked for after the composer is drawn opens the section; one that was there stays.
  const [seen, setSeen] = useState(kind);
  const [pollKey, setPollKey] = useState(0);
  if (seen !== kind) {
    setSeen(kind);
    if (kind === "poll") setPollKey((key) => key + 1);
  }

  // What is kept in the tab, written from what the member changes and from nothing else: a
  // thread that was sent can never come back as a draft because the page was shown again. While
  // one is on its way changes are not written, and a refusal writes the draft again.
  const draft = useRef<ThreadDraft>({ title: "", body: "", prefixId: "" });
  const sending = useRef(false);
  sending.current = pending;
  const keep = useCallback(
    (change: Partial<ThreadDraft>) => {
      draft.current = { ...draft.current, ...change };
      if (!sending.current) writeThreadDraft(memberId, draft.current);
    },
    [memberId],
  );
  const changeBody = useCallback(
    (text: string) => {
      setBody(text);
      keep({ body: text });
    },
    [keep],
  );

  // The draft kept by an earlier visit comes back once the page is on the screen: storage is not
  // read while drawing, which would differ from what the server drew. The text goes into the plain
  // field the composer starts with, which the editor takes it from when it is entered.
  useEffect(() => {
    const kept = readThreadDraft(memberId);
    if (kept) {
      draft.current = kept;
      setTitle(kept.title);
      setPrefixId(kept.prefixId);
      setBody(kept.body);
      const box = form.current?.querySelector<HTMLTextAreaElement>(
        'textarea[name="body"]',
      );
      if (box) box.value = kept.body;
    }
  }, [memberId]);

  useEffect(() => {
    if (state.error) writeThreadDraft(memberId, draft.current);
  }, [state, memberId]);

  // The choice of forum takes the screen; the chip that opened it gets the focus back.
  useEffect(() => {
    if (wasPicking.current && !picking) chip.current?.focus();
    wasPicking.current = picking;
  }, [picking]);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) =>
    sendUnlessPicking(picking, event, () => {
      clearThreadDraft(memberId);
      send(event);
    });

  function choose(id: number) {
    setPicking(false);
    if (id === target.current) return;
    target.current = id;
    setForum(id);
    if (frame === "page") {
      window.history.replaceState(null, "", composeAddress(id));
    }
    // Whether files and a poll may be added is a permission of the forum.
    const turn = ++asked.current;
    forumComposeAccessAction(id).then(
      (allowed) => {
        if (turn !== asked.current) return;
        setAttach(allowed.attach);
        setPoll(allowed.poll);
      },
      () => {},
    );
  }

  const top = (
    <div className="space-y-3 px-3 pt-3">
      <button
        type="button"
        ref={chip}
        onClick={() => setPicking(true)}
        className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border bg-card px-3 text-sm outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="shrink-0 text-muted-foreground">{t("postingIn")}</span>
        <span className="min-w-0 truncate font-semibold">
          {forumTitle(forums, forum)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>
      <input
        name="title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          keep({ title: event.target.value });
        }}
        onKeyDown={(event) => {
          // Enter ends the title and goes on to the text; it does not send the thread.
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          form.current
            ?.querySelector<HTMLElement>("textarea, [contenteditable]")
            ?.focus();
        }}
        aria-label={t("titleLabel")}
        placeholder={t(
          kind === "question" ? "questionTitlePlaceholder" : "titlePlaceholder",
        )}
        autoComplete="off"
        className="block w-full min-w-0 bg-transparent py-1 text-xl font-semibold outline-none placeholder:text-muted-foreground md:text-2xl"
      />
      {prefixes.length > 0 && (
        <fieldset className="flex min-w-0 flex-wrap gap-2">
          <legend className="sr-only">{t("prefixLabel")}</legend>
          <input type="hidden" name="prefixId" value={prefix} />
          {prefixes.map((item) => {
            const chosen = String(item.id) === prefix;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={chosen}
                onClick={() => {
                  const next = chosen ? "" : String(item.id);
                  setPrefixId(next);
                  keep({ prefixId: next });
                }}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8",
                  chosen
                    ? "ring-2 ring-ring"
                    : "ring-1 ring-border hover:ring-ring",
                )}
              >
                <PrefixTag prefix={item} />
              </button>
            );
          })}
        </fieldset>
      )}
      {canTag && <ThreadTagsField />}
      {poll && (
        <PollField
          key={pollKey}
          startOpen={kind === "poll"}
          attachIn={attach ? forum : null}
        />
      )}
      {kind === "poll" && !poll && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("noPollHere")}
        </p>
      )}
    </div>
  );

  const composer = (
    <ComposerForm
      formRef={form}
      onSubmit={onSubmit}
      frame={
        frame === "dialog"
          ? { kind: "dialog", heading: t("heading") }
          : { kind: "page", closeHref: `/forums/${forum}` }
      }
      submitLabel={t("post")}
      pending={pending}
      canSubmit={threadReady(title, body)}
      top={top}
      placeholder={t(
        kind === "question" ? "questionBodyPlaceholder" : "bodyPlaceholder",
      )}
      minHeight={200}
      findMembers={findRecipients}
      onBodyChange={changeBody}
      error={state.error}
      attach={attach}
      attachNodeId={forum}
      cover={
        picking ? (
          <ForumChoicePanel
            forums={forums}
            current={forum}
            onChoose={choose}
            onBack={() => setPicking(false)}
          />
        ) : undefined
      }
    />
  );
  return frame === "dialog" ? (
    composer
  ) : (
    <ComposerPage>{composer}</ComposerPage>
  );
}
