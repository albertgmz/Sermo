import { useLocale, useTranslations } from "next-intl";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { LevelBadge, levelWithBounds, XpBar } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { formatCompact, formatDate } from "@/lib/format";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// How the column sits in a frame, in one place: the width of the column (from `md` up), which the
// frame hands on as `--postbit-width`, and the cover drawn behind it. The cover starts at the
// frame's edge and ends exactly at the column's border (the frame's padding plus the column), so
// it leaves no edge short of the border. The postbit itself fills whatever width it is given.
export const POSTBIT_WIDTH = "10rem";
export const POSTBIT_FRAME = {
  grid: "md:grid-cols-[var(--postbit-width)_minmax(0,1fr)]",
  cover:
    "md:inset-x-auto md:left-0 md:h-full md:w-[calc(var(--postbit-width)+1rem)] md:[mask-image:linear-gradient(to_bottom,black,transparent)]",
};

// `column`: avatar on top, then name, actions, title, level, awards and a list of facts (a card of
// its own width).
// `compact`: one small header, avatar then name and a line of title and counts, actions at the end.
// `responsive`: the compact header below `md`, the column from `md` up.
export type PostbitLayout = "column" | "compact" | "responsive";

// The author of a post: who they are and a few facts about them. It knows nothing of posts, so the
// post frame and the member's card both draw this one block, part for part. The member's cover is
// drawn behind the top of the `relative isolate` box that holds the block (the frame, the card),
// shaped there by `coverClassName`. The name and avatar open the member's card, unless a
// `MemberCardScope` above turns that off (inside the card itself). `actions` is drawn under the
// name in the column, at the end of the compact header.
export function Postbit({
  author,
  layout = "responsive",
  actions,
  coverClassName,
  className,
}: {
  author: AuthorView;
  layout?: PostbitLayout;
  actions?: React.ReactNode;
  coverClassName?: string;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.memberCard");
  const { member } = author;
  const compact = layout !== "column";
  const column = layout !== "compact";
  const responsive = layout === "responsive";
  const pick = (forCompact: string, forColumn: string, both: string) =>
    layout === "compact" ? forCompact : layout === "column" ? forColumn : both;
  // A member whose profile the viewer may not open (or the backend did not return) has no facts
  // to show: the counts and the date would be placeholders.
  const facts = !member.restricted;
  const joined = Number.isFinite(new Date(author.joinedAt).getTime());
  const hasTitle = Boolean(member.title);
  const titleRow = hasTitle || (compact && facts);
  const level = levelWithBounds(
    member.level,
    author.xp,
    author.currentLevelXp,
    author.nextLevelXp,
  );

  // The compact header is a grid: the avatar over two rows, the name over the title, the actions in
  // a column of their own at the end. The column is one flex column, the parts in their order.
  return (
    <div
      data-slot="postbit"
      data-layout={layout}
      className={cn(
        pick(
          "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1",
          "flex flex-col items-center gap-2 text-center",
          "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 md:flex md:flex-col md:items-center md:gap-2 md:text-center",
        ),
        className,
      )}
    >
      <CoverBackdrop
        cover={author.cover}
        variant="header"
        className={coverClassName}
      />
      {compact && (
        <UserAvatar
          user={member}
          size="lg"
          className={cn("row-span-2 self-start", responsive && "md:hidden")}
        />
      )}
      {column && (
        <UserAvatar
          user={member}
          size="xl"
          className={responsive ? "hidden md:block" : undefined}
        />
      )}
      <div
        className={pick(
          "col-start-2 flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm",
          "flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm",
          "col-start-2 flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm md:justify-center",
        )}
      >
        <UserLink
          user={member}
          // The name wraps inside the column and truncates beside the avatar and the
          // buttons of the compact header; the link may shrink to the room it has.
          wrap={
            layout === "compact" ? false : layout === "column" ? true : "md"
          }
          className="max-w-full min-w-0 [overflow-wrap:anywhere]"
        />
        <span className="contents [&>*]:max-w-full [&>*]:overflow-hidden">
          <UserBadges user={member} />
        </span>
        {/* Beside the name in the compact header; the column gives the awards a row of their own. */}
        {compact && (
          <AwardRow
            awards={author.awards}
            className={responsive ? "md:hidden" : undefined}
          />
        )}
      </div>
      {actions && (
        <div
          data-slot="postbit-actions"
          className={pick(
            "col-start-3 row-span-2 row-start-1 flex shrink-0 items-center",
            "flex w-full flex-col gap-2",
            "col-start-3 row-span-2 row-start-1 flex shrink-0 items-center md:w-full md:flex-col md:items-stretch md:gap-2",
          )}
        >
          {actions}
        </div>
      )}
      {titleRow && (
        <div
          className={cn(
            pick(
              "col-start-2 flex min-w-0 items-center gap-x-3",
              "flex w-full min-w-0 flex-col items-center gap-2",
              "col-start-2 flex min-w-0 items-center gap-x-3 md:w-full md:flex-col md:gap-2",
            ),
            // Without a title the row holds only the phone counts.
            responsive && !hasTitle && "md:hidden",
          )}
        >
          {hasTitle && (
            <p
              title={member.title}
              className={cn(
                "min-w-0 text-xs text-muted-foreground",
                pick(
                  "truncate",
                  "line-clamp-2 [overflow-wrap:anywhere]",
                  "truncate md:line-clamp-2 md:whitespace-normal md:[overflow-wrap:anywhere]",
                ),
              )}
            >
              {member.title}
            </p>
          )}
          {compact && facts && (
            <UserStats
              user={{
                level,
                postCount: author.postCount,
                reactionCount: author.reactionScore,
              }}
              className={cn(
                "shrink-0",
                // On a phone the XP bar gives its room to the title.
                hasTitle && "max-sm:[&_[data-slot=progress]]:hidden",
                responsive && "md:hidden",
              )}
            />
          )}
        </div>
      )}
      {column && facts && (
        <div
          data-slot="postbit-level"
          className={cn(
            "items-center gap-1.5",
            responsive ? "hidden md:inline-flex" : "inline-flex",
          )}
        >
          <LevelBadge level={level} />
          <XpBar level={level} className="w-16" />
        </div>
      )}
      {column && (
        <AwardRow
          awards={author.awards}
          className={cn(
            "max-w-full flex-wrap justify-center",
            responsive && "hidden md:inline-flex",
          )}
        />
      )}
      {column && facts && (
        <dl
          className={cn(
            "w-full min-w-0 gap-1 border-t pt-2 text-left text-xs",
            responsive ? "hidden md:grid" : "grid",
          )}
        >
          {joined && (
            <Fact label={t("joinedLabel")}>
              <time dateTime={author.joinedAt}>
                {formatDate(author.joinedAt, locale)}
              </time>
            </Fact>
          )}
          <Fact label={t("postsLabel")}>
            {formatCompact(author.postCount, locale)}
          </Fact>
          <Fact label={t("reactionsLabel")}>
            {formatCompact(author.reactionScore, locale)}
          </Fact>
        </dl>
      )}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-semibold tabular-nums">
        {children}
      </dd>
    </div>
  );
}
