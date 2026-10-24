"use client";

import { ChevronDown, Eye, PenLine, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  createThreadAction,
  forumComposeAccessAction,
} from "@/app/[locale]/(main)/forums/actions";
import { previewAction } from "@/app/[locale]/(main)/forums/preview";
import { ComposerForm, ComposerPage } from "@/components/forum/composer";
import { rowButtonClass } from "@/components/forum/composer-buttons";
import type { ThreadKind } from "@/components/forum/create-kinds";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { FormError } from "@/components/forum/form-error";
import { ForumChoicePanel } from "@/components/forum/forum-choice-panel";
import { type ForumChoice, forumTitle } from "@/components/forum/forum-choices";
import { findMentions } from "@/components/forum/mention-find";
import { PollField } from "@/components/forum/poll-field";
import {
  clearThreadDraft,
  readThreadDraft,
  type ThreadDraft,
  writeThreadDraft,
} from "@/components/forum/thread-draft";
import { TitleField } from "@/components/forum/thread-fields";
import { ThreadTagsField } from "@/components/forum/thread-tags-field";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// How the member watches the threads they start (their preference), which the composer's watch
// options start from, as XenForo's do.
export type WatchMode = "none" | "watch" | "watch_email";

// A thread can be sent once it has a title and a first post, and a prefix where the forum asks
// for one.
export function threadReady(
  title: string,
  body: string,
  prefixMissing = false,
) {
  return title.trim() !== "" && body.trim() !== "" && !prefixMissing;
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

// What the Preview button says and whether it is off. It toggles: while the preview is shown it
// goes back to the text. Off while a preview is on its way, and before there is any text to show;
// off is `aria-disabled`, never `disabled`, which would drop the keyboard focus it holds.
export function previewControl(state: {
  shown: boolean;
  pending: boolean;
  body: string;
}) {
  return {
    label: state.shown ? ("backToEditing" as const) : ("preview" as const),
    off: state.pending || (!state.shown && state.body.trim() === ""),
  };
}

// What a forum offers as prefixes, as the composer knows it: still being asked for (after a change
// of forum), asked for and answered, or asked for and not answered.
export type Offer = {
  status: "ready" | "loading" | "failed";
  prefixes: PrefixView[];
  requirePrefix: boolean;
};

export const OFFER_LOADING: Offer = {
  status: "loading",
  prefixes: [],
  requirePrefix: false,
};

// The offer once the forum's access was asked for; null is a read that failed, which leaves the
// forum without a picker until it is asked for again.
export function offerFrom(
  read: { prefixes: PrefixView[]; requirePrefix: boolean } | null,
): Offer {
  return read
    ? {
        status: "ready",
        prefixes: read.prefixes,
        requirePrefix: read.requirePrefix,
      }
    : { status: "failed", prefixes: [], requirePrefix: false };
}

// Post waits while the prefixes are unknown, and for a prefix where the forum asks for one.
export function prefixBlocks(offer: Offer, chosen: string) {
  return offer.status !== "ready" || (offer.requirePrefix && chosen === "");
}

// Where the composer is visited. The forum is changed in place, so the address follows without a
// navigation, which would start the page, and the draft, over.
export function composeAddress(forumId: number) {
  return `/forums/${forumId}/new`;
}

// The address a change of forum moves to: on its page the address follows the forum; in a dialog
// the page behind it is somewhere else and keeps its address.
export function addressAfterForumChange(
  frame: "page" | "dialog",
  forumId: number,
) {
  return frame === "page" ? composeAddress(forumId) : null;
}

// Starting a thread, laid out as XenForo's "Post thread" page in the shared composer: the forum it
// goes to as a chip that opens the forum choice, the title row (`TitleField`: the prefix menu joined
// to the left of a large bordered title box), the text in the editor's box, then the poll and the
// tags, and Attach files and Post thread in the bottom row. The forum, the title, the prefix and
// the text are all kept when the forum is changed, when the post is refused and while the choice
// of forum is open. The title, the
// prefix and the text are also kept in the tab (`thread-draft`) when the composer is closed or the
// page is reloaded, until the thread is sent.
export function ThreadComposer({
  forumId,
  forums,
  prefixes: firstPrefixes,
  requirePrefix: firstRequired,
  canAttach,
  canTag,
  canPoll,
  memberId,
  frame = "page",
  kind = "discussion",
  onDraft,
  onPending,
  onForum,
  pollAsk = 0,
  watchDefault = "watch",
}: {
  forumId: number;
  // The forums the member may start a thread in, under the categories that hold them.
  forums: ForumChoice[];
  // The prefixes the first forum offers, and whether it asks for one; the composer asks again when
  // the forum is changed.
  prefixes: PrefixView[];
  requirePrefix: boolean;
  canAttach: boolean;
  // The member may put tags on a thread (tag.apply): the field for them is shown.
  canTag: boolean;
  // The member may start a poll or quiz with the thread (poll.create in the forum): the section is shown.
  canPoll: boolean;
  // Whose draft is kept in the tab; none is kept without one.
  memberId: number | null;
  // `page`: the address `/forums/<id>/new`, which follows the forum. `dialog`: inside the Create
  // button's dialog, on whatever page the member is on, which no address follows; it is the whole
  // screen, and the text takes what the rest of the composer leaves of it.
  frame?: "page" | "dialog";
  // What the member asked to write. A question is a discussion worded as one (the backend has no
  // thread type for it); a poll opens the poll section.
  kind?: ThreadKind;
  // The draft as the composer holds it, each time it changes and when one is restored, for a
  // caller that must know whether what is kept in the tab has moved on since.
  onDraft?: (draft: ThreadDraft) => void;
  // Whether a send is on its way, for a caller that must not draw the composer anew meanwhile.
  onPending?: (pending: boolean) => void;
  // The forum the member changed to, for a caller that draws the composer again.
  onForum?: (id: number) => void;
  // Counts the times a poll was asked for; each opens the poll section if it was closed.
  pollAsk?: number;
  // The member's preference for the threads they start: where the watch options start.
  watchDefault?: WatchMode;
}) {
  const t = useTranslations("forum.threadComposer");
  const tFields = useTranslations("forum.threadFields");
  const [forum, setForum] = useState(forumId);
  const [attach, setAttach] = useState(canAttach);
  const [poll, setPoll] = useState(canPoll);
  const [picking, setPicking] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prefixId, setPrefixId] = useState("");
  const [watching, setWatching] = useState(watchDefault !== "none");
  const [emailed, setEmailed] = useState(watchDefault === "watch_email");
  // The text as the backend renders it, shown in the text's place until the same button goes
  // back; a refusal is said under the text, which stays.
  const [preview, setPreview] = useState<React.ReactNode | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const previewBox = useRef<HTMLElement>(null);
  const backToText = useRef(false);
  const optionsId = useId();
  const [offered, setOffered] = useState<Offer>({
    status: "ready",
    prefixes: firstPrefixes,
    requirePrefix: firstRequired,
  });
  const { prefixes, requirePrefix } = offered;
  // A kept prefix that has since been removed, or that the forum does not offer, is not one.
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
  } = useKeptForm((previous, data) =>
    createThreadAction(target.current, previous, data),
  );

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
      if (!sending.current) onDraft?.(draft.current);
    },
    [memberId, onDraft],
  );
  const changeBody = useCallback(
    (text: string) => {
      setBody(text);
      setPreviewError(null);
      keep({ body: text });
    },
    [keep],
  );

  // The draft kept by an earlier visit comes back once the page is on the screen: storage is not
  // read while drawing, which would differ from what the server drew. The text goes into the plain
  // field the composer starts with, which the editor takes it from when it is entered.
  // Restored once per composer drawn, whatever the caller does with the draft afterwards.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `onDraft` is read once, here.
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
      onDraft?.(kept);
    }
  }, [memberId]);

  // An answer ends the send: a refusal writes the draft back, and tells the caller what the tab holds.
  useEffect(() => {
    onPending?.(false);
    if (state.error) writeThreadDraft(memberId, draft.current);
    if (state.error) onDraft?.(draft.current);
  }, [state, memberId, onDraft, onPending]);

  // The choice of forum takes the screen; the chip that opened it gets the focus back.
  useEffect(() => {
    if (wasPicking.current && !picking) chip.current?.focus();
    wasPicking.current = picking;
  }, [picking]);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) =>
    sendUnlessPicking(picking, event, () => {
      onPending?.(true);
      clearThreadDraft(memberId);
      send(event);
    });

  // The preview is read where it appears; going back puts the caret in the text again.
  useEffect(() => {
    if (preview) previewBox.current?.focus();
    else if (backToText.current) {
      backToText.current = false;
      form.current
        ?.querySelector<HTMLElement>("textarea, [contenteditable]")
        ?.focus();
    }
  }, [preview]);

  function closePreview(focusText: boolean) {
    backToText.current = focusText;
    setPreview(null);
    setPreviewError(null);
  }

  function togglePreview() {
    const control = previewControl({
      shown: preview !== null,
      pending: previewing,
      body,
    });
    if (control.off) return;
    if (preview) {
      closePreview(true);
      return;
    }
    setPreviewError(null);
    startPreview(async () => {
      const answer = await previewAction(
        { type: "thread", nodeId: target.current },
        body,
      );
      if ("preview" in answer) setPreview(answer.preview);
      else setPreviewError(answer.error);
    });
  }

  function choose(id: number) {
    setPicking(false);
    if (id === target.current) return;
    // A preview is the forum's rendering: another forum draws it again when asked.
    closePreview(false);
    target.current = id;
    setForum(id);
    onForum?.(id);
    const address = addressAfterForumChange(frame, id);
    if (address) window.history.replaceState(null, "", address);
    loadForum(id);
  }

  // Whether files and a poll may be added is a permission of the forum, and the prefixes are the
  // ones it offers: those of the forum left are not, so Post waits for the answer. A forum that
  // could not be read leaves the files and the poll as they were (that is no refusal), but not the
  // prefixes: it has no picker and Post stays off until the member asks again.
  function loadForum(id: number) {
    setOffered(OFFER_LOADING);
    const turn = ++asked.current;
    forumComposeAccessAction(id).then(
      (allowed) => {
        if (turn !== asked.current) return;
        if (allowed) {
          setAttach(allowed.attach);
          setPoll(allowed.poll);
        }
        setOffered(offerFrom(allowed));
      },
      () => {
        if (turn === asked.current) setOffered(offerFrom(null));
      },
    );
  }

  const top = (
    <div className="space-y-3 px-3 pt-3 pb-3 md:px-4 md:pt-4">
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
      <TitleField
        look="large"
        prefixes={prefixes}
        prefix={prefix}
        onPrefix={(next) => {
          setPrefixId(next);
          keep({ prefixId: next });
        }}
        none={tFields("noPrefix")}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          keep({ title: event.target.value });
        }}
        onKeyDown={(event) => {
          // Enter ends the title and goes on to the text; it does not send the thread.
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          // While the preview stands in for the text, the text comes back first.
          if (preview) {
            closePreview(true);
            return;
          }
          form.current
            ?.querySelector<HTMLElement>("textarea, [contenteditable]")
            ?.focus();
        }}
        aria-label={t("titleLabel")}
        placeholder={t(
          kind === "question" ? "questionTitlePlaceholder" : "titlePlaceholder",
        )}
      />
      {prefixes.length > 0 && (
        <input type="hidden" name="prefixId" value={prefix} />
      )}
      {requirePrefix && !prefix && (
        <p className="text-xs text-muted-foreground">{t("prefixRequired")}</p>
      )}
      {offered.status === "failed" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          {t("prefixesFailed")}
          <button
            type="button"
            onClick={() => loadForum(target.current)}
            className="min-h-10 rounded-md px-2 font-medium text-primary-ink underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
          >
            {t("prefixesRetry")}
          </button>
        </div>
      )}
    </div>
  );

  // Under the text, as XenForo's page has them: the poll, the tags, then the options.
  const below = (
    <div className="space-y-4 px-3 pt-3 pb-4 md:px-4">
      {previewError && <FormError>{previewError}</FormError>}
      {poll && (
        <PollField
          wanted={kind === "poll"}
          asked={pollAsk}
          attachIn={attach ? forum : null}
        />
      )}
      {kind === "poll" && !poll && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("noPollHere")}
        </p>
      )}
      {canTag && <ThreadTagsField />}
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs text-muted-foreground">
          {t("options")}
        </legend>
        {/* The form offers the choice: the action sends it, unticked boxes included. */}
        <input type="hidden" name="watchChoice" value="1" />
        <div className="flex min-h-10 items-center gap-2 md:min-h-8">
          <Checkbox
            id={`${optionsId}-watch`}
            name="watch"
            checked={watching}
            onCheckedChange={setWatching}
          />
          <Label htmlFor={`${optionsId}-watch`} className="font-normal">
            {t("watch")}
          </Label>
        </div>
        <div className="flex min-h-10 items-center gap-2 pl-6 md:min-h-8">
          <Checkbox
            id={`${optionsId}-email`}
            name="watchEmail"
            checked={watching && emailed}
            disabled={!watching}
            onCheckedChange={setEmailed}
          />
          <Label
            htmlFor={`${optionsId}-email`}
            className="font-normal peer-data-disabled:opacity-50"
          >
            {t("watchEmail")}
          </Label>
        </div>
      </fieldset>
    </div>
  );

  // XenForo's Preview: the text as it will be posted, in its place, until "Back to editing".
  const control = previewControl({
    shown: preview !== null,
    pending: previewing,
    body,
  });
  const previewButton = (
    <Button
      type="button"
      variant="outline"
      className={cn(rowButtonClass, "aria-disabled:opacity-50")}
      aria-disabled={control.off || undefined}
      aria-busy={previewing || undefined}
      onClick={togglePreview}
    >
      {preview ? <PenLine aria-hidden="true" /> : <Eye aria-hidden="true" />}
      {t(control.label)}
    </Button>
  );
  const shown = preview && (
    <section
      ref={previewBox}
      tabIndex={-1}
      aria-label={t("preview")}
      className="px-3 py-2.5 outline-none md:px-5 md:py-3"
    >
      <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
        {t("preview")}
      </h2>
      {preview}
    </section>
  );

  const composer = (
    <ComposerForm
      formRef={form}
      onSubmit={onSubmit}
      frame={
        frame === "dialog"
          ? { kind: "dialog", grow: true }
          : { kind: "page", closeHref: `/forums/${forum}` }
      }
      submitLabel={t("post")}
      submitIcon={SquarePen}
      pending={pending}
      canSubmit={threadReady(title, body, prefixBlocks(offered, prefix))}
      top={top}
      below={below}
      boxed
      textCover={shown}
      beforeSubmit={previewButton}
      placeholder={t(
        kind === "question" ? "questionBodyPlaceholder" : "bodyPlaceholder",
      )}
      minHeight={200}
      findMembers={findMentions}
      onBodyChange={changeBody}
      bar={Toolbar}
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
