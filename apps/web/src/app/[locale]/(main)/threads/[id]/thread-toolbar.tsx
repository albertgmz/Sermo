"use client";

import { Ellipsis } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
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

const moreClass = cn(buttonVariants({ variant: "outline" }), "size-10 px-0");

// The thread's action row, as XenForo's: `start` (the pager, from a wide screen up) on the left,
// the member's buttons on the right (`watch`, `bookmark`, drawn by the server) and a "•••" menu
// with what they may change: "Edit thread" opens its dialog, the tags, the poll and the moderator
// tools open their panel under the row (choosing one again closes it). The moderation panel is
// open from the start while posts are being picked for a split (`selecting`). Drawn by
// `ThreadTools`.
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
  // The member may edit the title and prefix.
  edit: boolean;
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
          {entries.length > 0 && (
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
          )}
        </div>
      </div>
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
      {panel === "moderate" && <div className="mt-3">{moderation}</div>}
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
