import { useTranslations } from "next-intl";
import { AwardRow } from "@/components/forum/award-icon";
import { LevelBadge, levelWithBounds, XpBar } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { formatCompact, formatDate } from "@/lib/format";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// How the column sits in a frame, in one place: the width of the column (from `md` up) and the
// cover that is drawn behind it. The postbit itself fills whatever width it is given.
export const POSTBIT_FRAME = {
  grid: "md:grid-cols-[10rem_minmax(0,1fr)]",
  cover:
    "md:inset-x-auto md:left-0 md:h-full md:w-40 md:[mask-image:linear-gradient(to_bottom,black,transparent)]",
};

// `column`: avatar on top, then name, title, level and a list of facts (a card of its own width).
// `compact`: one small header, avatar then name and a line of title and counts.
// `responsive`: the compact header below `md`, the column from `md` up.
export type PostbitLayout = "column" | "compact" | "responsive";

// The author of a post: who they are and a few facts about them. It knows nothing of posts, so a
// frame, a floating card or a list can place it. `actions` is drawn at the foot of the column, at
// the end of the compact header.
export function Postbit({
  author,
  layout = "responsive",
  actions,
  className,
}: {
  author: AuthorView;
  layout?: PostbitLayout;
  actions?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("forum.memberCard");
  const { member } = author;
  const compact = layout !== "column";
  const column = layout !== "compact";
  const responsive = layout === "responsive";
  const pick = (forCompact: string, forColumn: string, both: string) =>
    layout === "compact" ? forCompact : layout === "column" ? forColumn : both;
  const level = levelWithBounds(
    member.level,
    author.xp,
    author.currentLevelXp,
    author.nextLevelXp,
  );

  return (
    <div
      data-slot="postbit"
      data-layout={layout}
      className={cn(
        pick(
          "flex items-start gap-3",
          "flex flex-col items-center gap-3 text-center",
          "flex items-start gap-3 md:flex-col md:items-center md:text-center",
        ),
        className,
      )}
    >
      {compact && (
        <UserAvatar
          user={member}
          size="lg"
          className={cn("self-start", responsive && "md:hidden")}
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
          "flex min-w-0 flex-1 flex-col gap-1",
          "flex w-full min-w-0 flex-col items-center gap-2",
          "flex min-w-0 flex-1 flex-col gap-1 md:w-full md:flex-none md:items-center md:gap-2",
        )}
      >
        <div
          className={pick(
            "flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm",
            "flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm",
            "flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm md:justify-center",
          )}
        >
          <UserLink user={member} className="[overflow-wrap:anywhere]" />
          <UserBadges user={member} />
          <AwardRow awards={author.awards} />
        </div>
        <div
          className={pick(
            "flex min-w-0 items-center gap-x-3",
            "flex w-full min-w-0 flex-col items-center gap-2",
            "flex min-w-0 items-center gap-x-3 md:w-full md:flex-col md:gap-2",
          )}
        >
          {member.title && (
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
          {compact && (
            <UserStats
              user={{
                level,
                postCount: author.postCount,
                reactionCount: author.reactionScore,
              }}
              className={cn(
                "shrink-0 [&_[data-slot=progress]]:hidden",
                responsive && "md:hidden",
              )}
            />
          )}
        </div>
        {column && (
          <div
            className={cn(
              "w-full min-w-0 flex-col items-center gap-2",
              responsive ? "hidden md:flex" : "flex",
            )}
          >
            <div className="inline-flex items-center gap-1.5">
              <LevelBadge level={level} />
              <XpBar level={level} className="w-16" />
            </div>
            <dl className="grid w-full gap-1 border-t pt-2 text-left text-xs">
              <Fact label={t("joinedLabel")}>
                <time dateTime={author.joinedAt}>
                  {formatDate(author.joinedAt)}
                </time>
              </Fact>
              <Fact label={t("postsLabel")}>
                {formatCompact(author.postCount)}
              </Fact>
              <Fact label={t("reactionsLabel")}>
                {formatCompact(author.reactionScore)}
              </Fact>
            </dl>
          </div>
        )}
      </div>
      {actions && (
        <div
          data-slot="postbit-actions"
          className={pick(
            "ml-auto flex shrink-0 items-center",
            "mt-auto flex w-full flex-col gap-2",
            "ml-auto flex shrink-0 items-center md:mt-auto md:ml-0 md:w-full md:flex-col md:items-stretch md:gap-2",
          )}
        >
          {actions}
        </div>
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
