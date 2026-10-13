import type { reportsList } from "@sermo/core/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type * as z from "zod";
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

// Where a row of a queue sits, from the queue's own answer: a link to the thread or to the
// member's profile, and a plain note, no link, when the backend names no place (a message of a
// conversation, or a profile the viewer may not see).
export function QueuePlace({
  where,
}: {
  where: z.output<typeof reportsList.output>["items"][number]["where"];
}) {
  const t = useTranslations("moderation.common.where");
  if (!where) return <span>{t("hidden")}</span>;
  if (where.kind === "thread") {
    return (
      <Link href={`/threads/${where.id}`} className={linkClass}>
        {where.title
          ? t("threadTitled", { title: where.title })
          : t("thread", { id: where.id })}
      </Link>
    );
  }
  return (
    <Link href={`/members/${where.id}`} className={linkClass}>
      {t("wall", { name: where.title })}
    </Link>
  );
}
