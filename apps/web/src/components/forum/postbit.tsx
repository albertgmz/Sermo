import { useLocale, useTranslations } from "next-intl";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { DeviceIcons } from "@/components/forum/device-icons";
import { LevelBadge, levelWithBounds, XpBar } from "@/components/forum/level";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { UserAvatar } from "@/components/forum/user-avatar";
import { titleBesideBadges, UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { formatCompact } from "@/lib/format";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// How the column sits in a frame, in one place: the width of the column (from `md` up), which the
// frame hands on as `--postbit-width`, and how wide the cover behind it is
// (`--postbit-cover-width`): from the frame's edge exactly to the column's border (the frame's
// padding plus the column), so it leaves no edge short of the border. The postbit itself fills
// whatever width it is given.
export const POSTBIT_WIDTH = "10rem";
export const POSTBIT_FRAME = {
  grid: "md:grid-cols-[var(--postbit-width)_minmax(0,1fr)]",
  style: {
    "--postbit-width": POSTBIT_WIDTH,
    "--postbit-cover-width": "calc(var(--postbit-width) + 1rem)",
  } as React.CSSProperties,
};

// The cover behind the column: the whole height of the box holding the postbit, fading downward,
// as wide as `--postbit-cover-width` (the whole box when it is not set, as in the member's card).
// Behind the compact header it is the strip `CoverBackdrop` draws by default.
const COLUMN_COVER = {
  column:
    "inset-x-auto left-0 h-full w-[var(--postbit-cover-width,100%)] [mask-image:linear-gradient(to_bottom,black,transparent)]",
  responsive:
    "md:inset-x-auto md:left-0 md:h-full md:w-[var(--postbit-cover-width,100%)] md:[mask-image:linear-gradient(to_bottom,black,transparent)]",
};

// `column`: avatar on top, then name, actions, title, level, awards and a list of facts (a card of
// its own width).
// `compact`: one small header, avatar then name and a line of title and counts, then the awards and
// the actions on a line of their own.
// `responsive`: the compact header below `md`, the column from `md` up.
export type PostbitLayout = "column" | "compact" | "responsive";

// avatar | awards | room left | actions; the name and the title span all but the avatar's track.
const COMPACT_GRID =
  "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-y-1";
// name (at least 12 characters, at most its own width) | badges; the header shows the first
// badge (the highest group), the column all of them.
const NAME_ROW =
  "grid min-w-0 grid-cols-[minmax(min(12ch,100%),max-content)_auto] items-center gap-x-2";
const BADGES = "flex items-center [&>*:nth-child(n+2)]:hidden";

// The author of a post: who they are and a few facts about them. It knows nothing of posts, so the
// post frame and the member's card both draw this one block, part for part. The member's cover is
// drawn behind the `relative isolate` box that holds the block (the frame, the card);
// `coverClassName` adds what only one holder needs. The name and avatar open the member's card,
// unless a `MemberCardScope` above turns that off (inside the card itself). `actions` is drawn
// under the name in the column, at the end of the compact header's last line.
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
  const title = titleBesideBadges(member);
  const hasTitle = Boolean(title);
  const titleRow = hasTitle || (compact && facts);
  const level = levelWithBounds(
    member.level,
    author.xp,
    author.currentLevelXp,
    author.nextLevelXp,
  );

  // The parts are in the column's order, one flex column. The compact header places them on a
  // grid instead: the avatar over two rows beside the name and, under it, the title and counts;
  // then a line with the awards at the start and the actions at the end. The name has the whole
  // width beside the avatar, so it is not squeezed by the buttons on a small phone. The tracks are
  // spaced by margins, so a part that is not drawn leaves no gap and no empty line.
  return (
    <div
      data-slot="postbit"
      data-layout={layout}
      className={cn(
        pick(
          COMPACT_GRID,
          "flex flex-col items-center gap-2 text-center",
          `${COMPACT_GRID} md:flex md:flex-col md:items-center md:gap-2 md:text-center`,
        ),
        className,
      )}
    >
      <CoverBackdrop
        cover={author.cover}
        variant="header"
        className={cn(
          pick("", COLUMN_COVER.column, COLUMN_COVER.responsive),
          coverClassName,
        )}
      />
      {compact && (
        <UserAvatar
          user={member}
          size="lg"
          className={cn(
            "col-start-1 row-span-2 row-start-1 mr-3 self-start",
            responsive && "md:hidden",
          )}
        />
      )}
      {column && (
        <UserAvatar
          user={member}
          size="xl"
          className={responsive ? "hidden md:block" : undefined}
        />
      )}
      {/* In the compact header the name keeps at least 12 characters with the first badge beside
          it, on one line; in the column the name and every badge wrap, centred. */}
      <div
        className={pick(
          `col-start-2 col-end-5 row-start-1 ${NAME_ROW} text-sm`,
          "flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm",
          `col-start-2 col-end-5 row-start-1 ${NAME_ROW} text-sm md:flex md:max-w-full md:flex-wrap md:justify-center md:gap-y-1`,
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
        <span
          className={cn(
            "[&>*]:max-w-full [&>*]:overflow-hidden",
            pick(
              BADGES,
              "contents",
              `${BADGES} md:contents md:[&>*:nth-child(n+2)]:inline-flex`,
            ),
          )}
        >
          <UserBadges user={member} />
        </span>
      </div>
      {actions && (
        <div
          data-slot="postbit-actions"
          className={pick(
            "col-start-4 row-start-3 mt-1 ml-3 flex shrink-0 items-center",
            "flex w-full flex-col gap-2",
            "col-start-4 row-start-3 mt-1 ml-3 flex shrink-0 items-center md:mt-0 md:ml-0 md:w-full md:flex-col md:items-stretch md:gap-2",
          )}
        >
          {actions}
        </div>
      )}
      {titleRow && (
        <div
          className={cn(
            pick(
              "col-start-2 col-end-5 row-start-2 flex min-w-0 items-center gap-x-3",
              "flex w-full min-w-0 flex-col items-center gap-2",
              "col-start-2 col-end-5 row-start-2 flex min-w-0 items-center gap-x-3 md:w-full md:flex-col md:gap-2",
            ),
            // Without a title the row holds only the phone counts.
            responsive && !hasTitle && "md:hidden",
          )}
        >
          {hasTitle && (
            <p
              title={title}
              className={cn(
                "min-w-0 text-xs text-muted-foreground",
                pick(
                  "truncate",
                  "line-clamp-2 [overflow-wrap:anywhere]",
                  "truncate md:line-clamp-2 md:whitespace-normal md:[overflow-wrap:anywhere]",
                ),
              )}
            >
              {title}
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
      {/* The device of the latest sign-in ends the level line, so it costs the column no row of
          its own; on a narrow column it wraps under it, centred. */}
      {column && facts && (
        <div
          data-slot="postbit-level"
          className={cn(
            "max-w-full flex-wrap items-center justify-center gap-1.5",
            responsive ? "hidden md:inline-flex" : "inline-flex",
          )}
        >
          <LevelBadge level={level} />
          <XpBar level={level} className="w-16" />
          {author.device && <DeviceIcons device={author.device} />}
        </div>
      )}
      {/* Opening the compact header's last line, a row of their own in the column. */}
      <AwardRow
        awards={author.awards}
        className={pick(
          "col-start-2 row-start-3 mt-1 self-center",
          "max-w-full flex-wrap justify-center",
          "col-start-2 row-start-3 mt-1 self-center md:mt-0 md:max-w-full md:flex-wrap md:justify-center md:self-auto",
        )}
      />
      {column && facts && (
        <dl
          className={cn(
            "w-full min-w-0 gap-1 border-t pt-2 text-left text-xs",
            responsive ? "hidden md:grid" : "grid",
          )}
        >
          {joined && (
            <Fact label={t("joinedLabel")}>
              <StaticRelativeTime date={author.joinedAt} />
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
