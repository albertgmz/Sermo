"use client";

import { Flag, Pencil, Reply, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  createContext,
  use,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ActionFormState } from "@/components/forum/action-form";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { InPlaceEdit } from "@/components/forum/in-place-edit";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";
import { QuoteButton } from "@/components/forum/quote-button";
import { ShareButton } from "@/components/forum/share-button";
import { HashLink } from "@/components/layout/hash-link";
import { isPlainClick } from "@/components/ui/lazy-popup-intent";
import { cn } from "@/lib/utils";

// The delete and report dialogs come with the first press of their buttons.
const DeleteDialog = dynamic(() =>
  import("@/components/forum/delete-dialog").then(
    (module) => module.DeleteDialog,
  ),
);
const ReportDialog = dynamic(() =>
  import("@/components/forum/report-form").then(
    (module) => module.ReportDialog,
  ),
);

type FormAction = (
  previous: ActionFormState,
  formData: FormData,
) => Promise<ActionFormState>;

type Panel = "edit" | "delete" | "report";

// What a panel calls to close itself: the cancel button of a form in the `edit` panel. Delete and
// report are dialogs over the page, which close themselves.
export const ClosePanel = createContext<() => void>(() => undefined);

// What the wall bar's "•••" menu (`ContentMenu`, given as `menu`) reads from the bar: which of its
// panels the viewer may open from it, and how to open one. `permanentOnly` is an item that is
// already deleted, whose delete is the permanent one.
export const MenuPanels = createContext<{
  open: (panel: "edit" | "delete") => void;
  edit: boolean;
  remove: boolean;
  permanentOnly?: boolean;
}>({
  open: () => undefined,
  edit: false,
  remove: false,
});

// A bar button that opens its panel under the bar, or its dialog (`dialog`). `short` is a word
// shown on a phone, where the label shows only from `sm` up.
function PanelButton({
  icon,
  label,
  short,
  open,
  dialog,
  onClick,
  labelClassName = actionLabelClass,
}: {
  icon: React.ReactNode;
  label: string;
  short?: string;
  open: boolean;
  dialog?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  labelClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup={dialog ? "dialog" : undefined}
      className={messageActionClass}
      onClick={onClick}
    >
      {icon}
      {short && <span className="sm:hidden">{short}</span>}
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
//   quote       A post to quote into the reply editor: the post id, the event and the loader. A
//               conversation message gives `reference: "convMessage"`.
//   reply       Where the reply editor is.
//   share       The permalink of the item.
//   bookmark    The item and whether the viewer bookmarked it; only for signed-in viewers.
//   edit        Either a page to edit on, or a `panel` that opens under the bar. Inside a post that
//               is edited in place (`InPlaceEdit`), the page's link opens the editor there instead,
//               and the bar steps aside while it is open.
//   remove      Deleting, through `DeleteDialog` over the page: the action (it reads `hardDelete`
//               and `reason`), `permanent` when the viewer may delete for good ("choice" next to
//               the soft delete, "only" for an item already deleted, whose button keeps the word
//               "Delete" on a phone), and the lines saying what each does.
//   report      Reporting, through `ReportDialog` over the page: the action that files it.
//   moderation  Moderator tools that exist for the item (approve, restore), after the rest.
//   leading     The first thing on the left: a comment's date, a conversation message's share.
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
//               panel or dialog; an edit page is a link beside it instead), then the moderator tools; on
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
    reference?: "post" | "convMessage";
  };
  reply?: { href: string };
  share?: string;
  bookmark?: { contentType: "post"; contentId: number; bookmarked: boolean };
  edit?: { href: string } | { panel: React.ReactNode };
  remove?: {
    action: FormAction;
    permanent?: "choice" | "only";
    warning?: string;
    permanentHint?: string;
  };
  report?: { action: FormAction };
  moderation?: React.ReactNode;
  leading?: React.ReactNode;
  layout?: "default" | "split" | "wall";
  menu?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("forum.contentActions");
  const [open, setOpen] = useState<Panel | null>(null);
  // The dialogs pressed for once stay drawn, closed, so they close as dialogs do and hand the
  // focus back to the button that opened one (`opener`), or to the wall's "•••" menu it was chosen
  // from.
  const [drawn, draw] = useReducer(
    (panels: ReadonlySet<Panel>, panel: Panel) =>
      panels.has(panel) ? panels : new Set(panels).add(panel),
    new Set<Panel>(),
  );
  const opener = useRef<HTMLElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const show = (panel: Panel, from: HTMLElement | null = null) => {
    opener.current = from;
    draw(panel);
    setOpen(panel);
  };
  const toggle = (panel: Panel, event: React.MouseEvent<HTMLButtonElement>) => {
    if (open === panel) setOpen(null);
    else show(panel, event.currentTarget);
  };
  const close = () => setOpen(null);
  const dialogProps = (panel: Panel) => ({
    open: open === panel,
    onOpenChange: (next: boolean) => !next && close(),
    finalFocus: () =>
      opener.current ??
      bar.current?.querySelector<HTMLElement>(
        '[data-slot="dropdown-menu-trigger"]',
      ) ??
      null,
  });
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
  // A comment's bar (a wall bar led by the comment's date) sits in a narrow column. On a phone the
  // whole date is a line of its own under the text and the buttons follow on the next; from `sm`
  // it is one line, the date giving way first.
  const comment = wall && Boolean(leading);
  // An ordinary member's bar shows report's word on a phone too; with edit, delete (the wall's
  // "•••") or moderator tools beside it, the bar keeps to icons there, so it stays one line.
  const labelClass =
    split && !edit && !remove && !moderation ? "inline" : actionLabelClass;
  const gap = wall ? "gap-1" : "gap-1.5";
  const inPlace = use(InPlaceEdit);
  const editLink = edit && "href" in edit && (
    <Link
      href={edit.href}
      aria-label={t("edit")}
      className={messageActionClass}
      ref={inPlace?.trigger}
      onPointerEnter={inPlace?.warm}
      onFocus={inPlace?.warm}
      onClick={
        inPlace
          ? (event) => {
              if (!isPlainClick(event)) return;
              event.preventDefault();
              inPlace.open();
            }
          : undefined
      }
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
          reference={quote.reference}
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
      dialog
      onClick={(event) => toggle("report", event)}
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
          open: show,
          edit: !!edit && "panel" in edit,
          remove: !!remove,
          permanentOnly: remove?.permanent === "only",
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
            onClick={(event) => toggle("edit", event)}
          />
        ))}
      {remove && (
        <PanelButton
          icon={<Trash2 />}
          label={remove.permanent === "only" ? t("hardDelete") : t("delete")}
          short={remove.permanent === "only" ? t("delete") : undefined}
          open={open === "delete"}
          dialog
          onClick={(event) => toggle("delete", event)}
        />
      )}
      {!split && reportButton}
      {moderation}
    </>
  );
  const summaryRow = summary && <div className="-mx-2 flex">{summary}</div>;
  if (inPlace?.editing) return null;

  return (
    <div
      ref={bar}
      data-slot="content-actions"
      className={cn(
        wall ? "mt-1" : split ? "mt-3" : "mt-3 border-t border-dashed pt-1",
        className,
      )}
    >
      {!split && summaryRow}
      {/* XenForo's footer buttons are small filled pills, apart from each other and level with
          the text (`messageActionClass` takes the fill). A comment's row is already muted: its
          pills take the card. */}
      <div
        className={cn(
          "flex items-center justify-between [--action-hover:var(--input)]",
          gap,
          comment
            ? "flex-nowrap max-sm:flex-wrap [--action-fill:var(--card)]"
            : "flex-wrap [--action-fill:var(--muted)]",
        )}
      >
        <div
          className={cn(
            "flex items-center",
            gap,
            // On a phone the left side dissolves into the row, so the date (its `leading`, which
            // takes a whole line there) stands over the buttons.
            comment ? "min-w-0 flex-nowrap max-sm:contents" : "flex-wrap",
          )}
        >
          {leading}
          {split ? tools : answers}
        </div>
        <div
          className={cn(
            "ml-auto flex items-center",
            gap,
            comment ? "shrink-0 flex-nowrap" : "flex-wrap",
          )}
        >
          {split ? answers : tools}
        </div>
      </div>
      {edit && "panel" in edit && open === "edit" && (
        <div className="mt-2">
          <ClosePanel value={close}>{edit.panel}</ClosePanel>
        </div>
      )}
      {remove && drawn.has("delete") && (
        <DeleteDialog
          {...dialogProps("delete")}
          action={remove.action}
          permanent={remove.permanent}
          warning={remove.warning}
          permanentHint={remove.permanentHint}
        />
      )}
      {report && drawn.has("report") && (
        <ReportDialog {...dialogProps("report")} action={report.action} />
      )}
      {split && summaryRow}
    </div>
  );
}
