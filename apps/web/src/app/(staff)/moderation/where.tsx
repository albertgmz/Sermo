import Link from "next/link";
import { useTranslations } from "next-intl";
import { linkClass } from "@/components/staff/rows";
import type { Described } from "./content";

// Where a piece of content sits, with a link to the place. `name` gives a member's username by id
// (for the wall of a member).
export function Where({
  where,
  name,
}: {
  where: Described["where"];
  name: (id: number) => string;
}) {
  const t = useTranslations("moderation.common.where");
  if (!where) return null;
  if (where.kind === "thread") {
    return (
      <Link href={`/threads/${where.id}`} className={linkClass}>
        {where.title
          ? t("threadTitled", { title: where.title })
          : t("thread", { id: where.id })}
      </Link>
    );
  }
  if (where.kind === "forum") {
    return (
      <Link href={`/forums/${where.id}`} className={linkClass}>
        {t("forum", { title: where.title ?? where.id })}
      </Link>
    );
  }
  return (
    <Link href={`/members/${where.id}`} className={linkClass}>
      {t("wall", { name: name(where.id) })}
    </Link>
  );
}
