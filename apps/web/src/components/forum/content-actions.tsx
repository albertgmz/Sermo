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

// What the wall bar's "•••" menu (`ContentMenu`, given as `menu`) reads from the bar: which of its
// panels the viewer may open from it, and how to open one.
export const MenuPanels = createContext<{
  open: (panel: "edit" | "delete") => void;
  edit: boolean;
  remove: boolean;
}>({ open: () => undefined, edit: false, remove: false });

// A bar button that opens its panel under the bar.
function PanelButton({
  icon,
  label,
  open,
  onClick,
  labelClassName = actionLabelClass,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onClick: () => void;
  labelClassName?: string;
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
      <span className={labelClassName}>{label}</span>
    </button>
  );
}

// The footer of every item that can be answered or acted on (a post, a message, a wall post or a
// comment). In the default layout a soft rule parts it from the body; above the bar is the summary
// of who reacted; in the bar, what the viewer does with the item is on the left (react, quote,
// reply) and what they do to it on the right (share, edit, delete, report, then moderator tools).
// `layout` (below) gives a thread post and a wall item XenForo's arrangement instead. Every
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
//   leading     The first thing on the left: a comment's date.
//   menu        The wall bar's "•••" menu (`ContentMenu`), which reads the panels it may open from
//               `MenuPanels`. The caller brings it, so the pages without wall items do not load it.
//   layout      `split` is a thread post's footer as XenForo draws it: what the viewer does to the
//               item on the left (report first, then edit, delete and the moderator tools), how
//               they answer it on the right (react, "+ Quote", reply), the summary under the bar
//               and no rule above it (the post's header row carries one). Share and bookmark are
//               not drawn: the post's header row has them. When nothing but report is on the
//               left (an ordinary member's bar), the words show on a phone too: they fit 360 px
//               on one line; with edit, delete or moderator tools the bar keeps to icons there.
//               `wall` is a wall post's or comment's footer as XenForo draws it: laid out as
//               `split`: report (its word on a phone too, as `split` decides), share as an
//               icon and a "•••" menu that holds edit and delete (choosing one opens its
//               panel; an edit page is a link beside it instead), then the moderator tools; on
//               the right, react and `start`.
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
  leading,
  layout = "default",
  menu,
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
  leading?: React.ReactNode;
  layout?: "default" | "split" | "wall";
  menu?: React.ReactNode;
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

  const wall = layout === "wall";
  const split = layout === "split" || wall;
  // An ordinary member's bar shows report's word on a phone too; with edit, delete (the wall's
  // "•••") or moderator tools beside it, the bar keeps to icons there, so it stays one line.
  const labelClass =
    split && !edit && !remove && !moderation ? "inline" : actionLabelClass;
  const editLink = edit && "href" in edit && (
    <Link
      href={edit.href}
      aria-label={t("edit")}
      className={messageActionClass}
    >
      <Pencil />
      <span className={actionLabelClass}>{t("edit")}</span>
    </Link>
  );
  const answers = (
    <>
      {react}
      {quote && (
        <QuoteButton
          postId={quote.postId}
          event={quote.event}
          load={quote.load}
          label={t("quote")}
          text={split ? t("addQuote") : undefined}
          labelClassName={labelClass}
        />
      )}
      {reply && (
        <HashLink
          href={reply.href}
          aria-label={t("reply")}
          className={messageActionClass}
        >
          <Reply />
          <span className={labelClass}>{t("reply")}</span>
        </HashLink>
      )}
      {start}
    </>
  );
  const reportButton = report && (
    <PanelButton
      icon={<Flag />}
      label={t("report")}
      open={open === "report"}
      onClick={() => toggle("report")}
      labelClassName={labelClass}
    />
  );
  const tools = wall ? (
    <>
      {reportButton}
      {share && <ShareButton href={share} className={messageActionClass} />}
      {editLink}
      <MenuPanels
        value={{
          open: setOpen,
          edit: !!edit && "panel" in edit,
          remove: !!remove,
        }}
      >
        {menu}
      </MenuPanels>
      {moderation}
    </>
  ) : (
    <>
      {split ? (
        reportButton
      ) : (
        <>
          {bookmarkButton}
          {share && (
            <ShareButton
              href={share}
              label={t("share")}
              className={messageActionClass}
            />
          )}
        </>
      )}
      {edit &&
        (editLink || (
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
      {!split && reportButton}
      {moderation}
    </>
  );
  const summaryRow = summary && <div className="-mx-2 flex">{summary}</div>;

  return (
    <div
      data-slot="content-actions"
      className={cn(
        wall ? "mt-1" : split ? "mt-3" : "mt-3 border-t border-dashed pt-1",
        className,
      )}
    >
      {!split && summaryRow}
      <div className="-mx-2 flex flex-wrap items-center justify-between gap-x-1">
        <div className="flex flex-wrap items-center">
          {leading}
          {split ? tools : answers}
        </div>
        <div className="ml-auto flex flex-wrap items-center">
          {split ? answers : tools}
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
      {split && summaryRow}
    </div>
  );
}
