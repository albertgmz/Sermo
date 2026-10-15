"use client";

import { Flag, Pencil, Reply, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createContext, useMemo, useState } from "react";
import type { ActionFormState } from "@/components/forum/action-form";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { DeleteControl } from "@/components/forum/delete-control";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";
import { QuoteButton } from "@/components/forum/quote-button";
import { ReportForm } from "@/components/forum/report-form";
import { ShareButton } from "@/components/forum/share-button";
import { HashLink } from "@/components/layout/hash-link";
import { cn } from "@/lib/utils";

type FormAction = (
  previous: ActionFormState,
  formData: FormData,
) => Promise<ActionFormState>;

type Panel = "edit" | "delete" | "report";

// What a panel calls to close itself: the cancel button of a form in the `edit` panel.
export const ClosePanel = createContext<() => void>(() => undefined);

// A bar button that opens its panel under the bar.
function PanelButton({
  icon,
  label,
  open,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      className={messageActionClass}
      onClick={onClick}
    >
      {icon}
      <span className={actionLabelClass}>{label}</span>
    </button>
  );
}

// The footer of every item that can be answered or acted on (a post, a message, a wall post or a
// comment), the same on each. A soft rule parts it from the body. Above the bar: the summary of
// who reacted. In the bar: what the viewer does with the item on the left (react, quote, reply)
// and what they do to it on the right (share, edit, delete, report, then moderator tools). Every
// control is optional and draws only when given; the backend decides which the viewer gets.
// Below buttons are icons with a label from `sm` up, 40 px wide so the bar fits a phone.
//
// Props
//   summary     The reactions summary (`Reactions` with `part="summary"`).
//   react       The reaction button (`Reactions` with `part="button"`).
//   start       More controls on the left, after reply.
//   quote       A post to quote into the reply editor: the post id, the event and the loader.
//   reply       Where the reply editor is.
//   share       The permalink of the item.
//   bookmark    The item and whether the viewer bookmarked it; only for signed-in viewers.
//   edit        Either a page to edit on, or a `panel` that opens under the bar.
//   remove      Deleting: the action, whether to ask for a reason, and a line saying what it does.
//   report      Reporting: the action that files it.
//   moderation  Moderator tools that exist for the item (approve, restore), after the rest.
//   compact     The smaller bar of a comment.
export function ContentActions({
  summary,
  react,
  start,
  quote,
  reply,
  share,
  bookmark,
  edit,
  remove,
  report,
  moderation,
  compact = false,
  className,
}: {
  summary?: React.ReactNode;
  react?: React.ReactNode;
  start?: React.ReactNode;
  quote?: {
    postId: number;
    event: string;
    load: (
      postId: number,
    ) => Promise<{ author: string; authorId: number; source: string } | null>;
  };
  reply?: { href: string };
  share?: string;
  bookmark?: { contentType: "post"; contentId: number; bookmarked: boolean };
  edit?: { href: string } | { panel: React.ReactNode };
  remove?: { action: FormAction; withReason?: boolean; warning?: string };
  report?: { action: FormAction };
  moderation?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("forum.contentActions");
  const [open, setOpen] = useState<Panel | null>(null);
  const toggle = (panel: Panel) =>
    setOpen((current) => (current === panel ? null : panel));
  const close = () => setOpen(null);
  // The bookmark button is told how old its markup is by its props object (`lib/item-state`), which
  // must therefore be the server's: this bar re-renders whenever a panel opens or closes, and a
  // button element built again each time would look like markup drawn just now and show the
  // server's old value in place of the member's bookmark. Built again only when the server sends
  // a new `bookmark`.
  const bookmarkButton = useMemo(
    () =>
      bookmark && (
        <BookmarkButton
          {...bookmark}
          className={messageActionClass}
          labelClassName={actionLabelClass}
        />
      ),
    [bookmark],
  );

  return (
    <div
      data-slot="content-actions"
      className={cn(
        "border-t border-dashed",
        compact ? "mt-1.5 pt-0.5" : "mt-3 pt-1",
        className,
      )}
    >
      {summary && <div className="-mx-2 flex">{summary}</div>}
      <div className="-mx-2 flex flex-wrap items-center justify-between gap-x-1">
        <div className="flex flex-wrap items-center">
          {react}
          {quote && (
            <QuoteButton
              postId={quote.postId}
              event={quote.event}
              load={quote.load}
              label={t("quote")}
            />
          )}
          {reply && (
            <HashLink
              href={reply.href}
              aria-label={t("reply")}
              className={messageActionClass}
            >
              <Reply />
              <span className={actionLabelClass}>{t("reply")}</span>
            </HashLink>
          )}
          {start}
        </div>
        <div className="ml-auto flex flex-wrap items-center">
          {bookmarkButton}
          {share && (
            <ShareButton
              href={share}
              label={t("share")}
              className={messageActionClass}
            />
          )}
          {edit &&
            ("href" in edit ? (
              <Link
                href={edit.href}
                aria-label={t("edit")}
                className={messageActionClass}
              >
                <Pencil />
                <span className={actionLabelClass}>{t("edit")}</span>
              </Link>
            ) : (
              <PanelButton
                icon={<Pencil />}
                label={t("edit")}
                open={open === "edit"}
                onClick={() => toggle("edit")}
              />
            ))}
          {remove && (
            <PanelButton
              icon={<Trash2 />}
              label={t("delete")}
              open={open === "delete"}
              onClick={() => toggle("delete")}
            />
          )}
          {report && (
            <PanelButton
              icon={<Flag />}
              label={t("report")}
              open={open === "report"}
              onClick={() => toggle("report")}
            />
          )}
          {moderation}
        </div>
      </div>
      {edit && "panel" in edit && open === "edit" && (
        <div className="mt-2">
          <ClosePanel value={close}>{edit.panel}</ClosePanel>
        </div>
      )}
      {remove && open === "delete" && (
        <div className="mt-2">
          <DeleteControl
            open
            onOpenChange={close}
            action={remove.action}
            label={t("delete")}
            confirm={t("confirmDelete")}
            cancel={t("cancel")}
            reasonLabel={remove.withReason ? t("deleteReason") : undefined}
            warning={remove.warning}
          />
        </div>
      )}
      {report && open === "report" && (
        <div className="mt-2">
          <ReportForm action={report.action} onCancel={close} />
        </div>
      )}
    </div>
  );
}
