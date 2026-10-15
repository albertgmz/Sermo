// MemberOutcomeList: what a batch of member actions did to each member: the name, whether it was
// done, skipped (a rule says no) or failed, and the backend's reason for the last two. Server-safe.
// Used by the sign-up decisions and by the batch update of members.
//
// `outcomeTone` gives the text colour of the line that sums a run up: every member done is
// success, any failure is destructive, anything else (skipped members, nobody changed) is muted.
//
// Props
//   items  One entry per member, as the backend answers (`name`, `status`, `message`).
//   label  Accessible name of the list. Default: "Result for each member".

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

export type MemberOutcomeLine = {
  name: string;
  status: "done" | "skipped" | "failed";
  message: string | null;
};

const VARIANTS = {
  done: "success",
  skipped: "secondary",
  failed: "destructive",
} as const;

export function outcomeTone({
  done,
  skipped,
  failed,
}: {
  done: number;
  skipped: number;
  failed: number;
}): string {
  if (failed > 0) return "text-destructive";
  if (done > 0 && skipped === 0) return "text-success";
  return "text-muted-foreground";
}

export function MemberOutcomeList({
  items,
  label,
}: {
  items: readonly MemberOutcomeLine[];
  label?: string;
}) {
  const t = useTranslations("admin.memberOutcomes");
  return (
    <ul
      aria-label={label ?? t("list")}
      className="divide-y overflow-hidden rounded-lg border bg-card"
    >
      {items.map((item, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: an answer's lines, never reordered; names can repeat.
          key={index}
          className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,12rem)_6rem_minmax(0,1fr)] sm:items-center sm:gap-4"
        >
          <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
            {item.name}
          </span>
          <span>
            <Badge variant={VARIANTS[item.status]}>
              {t(`status.${item.status}`)}
            </Badge>
          </span>
          <span className="min-w-0 text-xs text-pretty text-muted-foreground [overflow-wrap:anywhere]">
            {item.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
