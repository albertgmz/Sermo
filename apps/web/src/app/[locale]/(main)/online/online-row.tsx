import type { OnlineVisitor } from "@sermo/core/contracts";
import { Bot, User } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { ActivityLine } from "@/components/forum/activity-line";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";

export type Visitor = z.output<typeof OnlineVisitor>;

// One current visitor, as XenForo's online list draws it: the avatar, the member's name (with
// their badges and title), "Guest", or the robot's name linked to its page; staff who may see
// addresses get a guest's on the right; then when, and within the hour where.
export function OnlineRow({ visitor }: { visitor: Visitor }) {
  const t = useTranslations("members.online");
  const { card, robot } = visitor;
  return (
    <li data-slot="online-row" className="flex items-start gap-3 px-4 py-3">
      {card ? (
        <UserAvatar user={card} size="lg" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {robot ? (
            <Bot aria-hidden="true" className="size-5" />
          ) : (
            <User aria-hidden="true" className="size-5" />
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
          {card ? (
            <>
              <UserLink user={card} className="max-w-full truncate" />
              <UserBadges user={card} limit={1} />
            </>
          ) : robot ? (
            t.rich("robot", {
              name: robot.name ?? t("unknownRobot"),
              link: (chunks) =>
                robot.url ? (
                  <a
                    href={robot.url}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className="text-primary-ink hover:underline"
                  >
                    {chunks}
                  </a>
                ) : (
                  chunks
                ),
            })
          ) : (
            t("guest")
          )}
        </h3>
        {card?.title && (
          <p className="truncate text-xs text-muted-foreground">{card.title}</p>
        )}
        <ActivityLine
          activity={visitor.activity}
          className="mt-0.5 block text-xs text-muted-foreground [overflow-wrap:anywhere]"
        />
      </div>
      {visitor.ip && (
        <span
          data-slot="online-ip"
          title={t("ipLabel")}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {visitor.ip}
        </span>
      )}
    </li>
  );
}
