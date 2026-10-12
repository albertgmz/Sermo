import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";
import { RoleBadge } from "@/components/forum/role-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { nameColor } from "@/lib/appearance";
import type { UserView } from "@/lib/db";
import type { Rank } from "@/lib/types";
import { cn } from "@/lib/utils";

export function RankBadge({
  rank,
  className,
}: {
  rank: Pick<Rank, "name" | "headline">;
  className?: string;
}) {
  const t = useTranslations("forum.userBadges");
  return (
    <span
      title={t("rank.title", { name: rank.name })}
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm border px-1 text-(length:--text-tiny) leading-none font-semibold tracking-wide whitespace-nowrap uppercase",
        nameColor(rank.headline.nameColor)?.text ?? "text-muted-foreground",
        className,
      )}
    >
      {rank.name}
      <span className="sr-only"> {t("rank.suffix")}</span>
    </span>
  );
}

export function DonorBadge({ className }: { className?: string }) {
  const t = useTranslations("forum.userBadges");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={t("donor")}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center text-name-rose",
              className,
            )}
          />
        }
      >
        <Heart aria-hidden="true" className="size-3 fill-current" />
      </TooltipTrigger>
      <TooltipContent>{t("donor")}</TooltipContent>
    </Tooltip>
  );
}

// Role, rank and donor marks, in the order they read next to a name.
export function UserBadges({
  user,
}: {
  user: Pick<UserView, "role" | "rank" | "donor">;
}) {
  return (
    <>
      <RoleBadge user={user} />
      {user.rank && <RankBadge rank={user.rank} />}
      {user.donor && <DonorBadge />}
    </>
  );
}
