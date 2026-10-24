"use client";

import { Ellipsis, Pencil, Shield } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type {
  ThreadMenuPopupProps,
  ThreadPanel,
} from "@/app/[locale]/(main)/threads/[id]/thread-menu-popup";
import { PollAdder } from "@/components/forum/poll-adder";
import { ThreadTagsEditor } from "@/components/forum/thread-tags-editor";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

// The menu's code (Base UI) is fetched when its button is first reached for, the edit dialog's
// when it is first chosen.
const loadMenu = () =>
  import("@/app/[locale]/(main)/threads/[id]/thread-menu-popup");
const EditThreadPopup = dynamic(
  () => import("@/app/[locale]/(main)/threads/[id]/edit-thread-popup"),
);

const outline = buttonVariants({ variant: "outline" });
// Without scripts the menu cannot open: its button steps aside for the plain link to the edit page
// and the moderation panel's own button.
const moreClass = cn(outline, "size-10 px-0 unscripted:hidden");

// Where the focus goes when the open panel changes: back to the "•••" button when a panel or the
// edit dialog closes, into the first field of the tags or the poll form when one opens. The dialog
// takes it itself, and the moderation panel is a list of tools under the row.
export function focusAfter(
  was: ThreadPanel | null,
  now: ThreadPanel | null,
): "trigger" | "field" | null {
  if (now === "tags" || now === "poll") return "field";
  if (now === null && was !== null) return "trigger";
  return null;
}

const FIELD = "input:not([type=hidden]), textarea, select";

// Focuses the first field of `box`, now or once it arrives (the poll's form is fetched when the
// panel opens). Returns what stops waiting.
function focusFirstField(box: HTMLElement) {
  const take = () => {
    const field = box.querySelector<HTMLElement>(FIELD);
    field?.focus();
    return field !== null;
  };
  if (take()) return () => {};
  const watcher = new MutationObserver(() => {
    if (take()) watcher.disconnect();
  });
  watcher.observe(box, { childList: true, subtree: true });
  return () => watcher.disconnect();
}

// The thread's action row, as XenForo's: `start` (the pager, from a wide screen up) on the left,
// the member's buttons on the right (`watch`, `bookmark`, drawn by the server) and a "•••" menu
// with what they may change: "Edit thread" opens its dialog, the tags, the poll and the moderator
// tools open their panel under the row (choosing one again closes it). The moderation panel is
// open from the start while posts are being picked for a split (`selecting`). Without scripts,
// "Edit thread" is a link to the full edit page (`edit`) and the moderation panel a disclosure
// with its own button. Drawn by `ThreadTools`.
export function ThreadToolbar({
  threadId,
  start,
  watch,
  bookmark,
  edit,
  tags,
  poll,
  moderation,
  selecting,
}: {
  threadId: number;
  start: React.ReactNode;
  watch: React.ReactNode;
  bookmark: React.ReactNode;
  // The full edit page, for whoever may edit the title and prefix.
  edit: string | null;
  // The tags to edit, for whoever may edit them.
  tags: readonly string[] | null;
  // A poll may be added: the forum its pictures go to.
  poll: { attachIn: number | null } | null;
  moderation: React.ReactNode;
  selecting: boolean;
}) {
  const t = useTranslations("threads.tools");
  const tEdit = useTranslations("forum.inPlaceEdit");
  const tTags = useTranslations("forum.threadTags");
  const tPoll = useTranslations("forum.poll");
  const tModeration = useTranslations("threads.moderation");
  const [panel, setPanel] = useState<ThreadPanel | null>(
    selecting && moderation ? "moderate" : null,
  );
  const close = () => setPanel(null);
  const more = useRef<HTMLDivElement>(null);
  const panels = useRef<HTMLDivElement>(null);
  const was = useRef(panel);
  useEffect(() => {
    const target = focusAfter(was.current, panel);
    was.current = panel;
    if (target === "trigger") more.current?.querySelector("button")?.focus();
    if (target === "field" && panels.current)
      return focusFirstField(panels.current);
  }, [panel]);
  const entries: ThreadMenuPopupProps["entries"] = [];
  if (edit) entries.push({ id: "edit", label: tEdit("editThread") });
  if (tags)
    entries.push({
      id: "tags",
      label: tTags(tags.length > 0 ? "edit" : "add"),
    });
  if (poll) entries.push({ id: "poll", label: tPoll("add") });
  if (moderation) entries.push({ id: "moderate", label: tModeration("menu") });
  const menu: ThreadMenuPopupProps = {
    label: t("more"),
    className: moreClass,
    entries,
    onSelect: (id) =>
      setPanel((open) => (open === id && id !== "edit" ? null : id)),
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {start}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {watch}
          {bookmark}
          {edit && (
            <a
              href={edit}
              className={cn(outline, "hidden h-10 px-3 unscripted:inline-flex")}
            >
              <Pencil aria-hidden="true" />
              {tEdit("editThread")}
            </a>
          )}
          {entries.length > 0 && (
            <div ref={more} className="contents">
              <LazyPopup
                load={loadMenu}
                popup={menu}
                opening="menu"
                trigger={(lazy) => (
                  <button
                    type="button"
                    data-slot="dropdown-menu-trigger"
                    aria-haspopup="menu"
                    aria-expanded="false"
                    aria-label={t("more")}
                    className={moreClass}
                    {...lazy}
                  >
                    <Ellipsis />
                  </button>
                )}
              />
            </div>
          )}
        </div>
      </div>
      <div ref={panels}>
        {panel === "tags" && tags && (
          <div className="mt-3">
            <ThreadTagsEditor threadId={threadId} tags={tags} onClose={close} />
          </div>
        )}
        {panel === "poll" && poll && (
          <div className="mt-3">
            <PollAdder
              threadId={threadId}
              attachIn={poll.attachIn}
              onClose={close}
            />
          </div>
        )}
      </div>
      {moderation && (
        <details
          open={panel === "moderate"}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setPanel((now) =>
              open ? "moderate" : now === "moderate" ? null : now,
            );
          }}
          className="mt-3 [&:not([open])]:mt-0 unscripted:[&:not([open])]:mt-2"
        >
          <summary
            className={cn(
              outline,
              "hidden h-10 cursor-pointer list-none px-3 unscripted:flex unscripted:w-fit [&::-webkit-details-marker]:hidden",
            )}
          >
            <Shield aria-hidden="true" />
            {tModeration("menu")}
          </summary>
          <div className="unscripted:mt-2">{moderation}</div>
        </details>
      )}
      {panel === "edit" && (
        <EditThreadPopup
          threadId={threadId}
          label={tEdit("editThread")}
          onClose={close}
        />
      )}
    </div>
  );
}
