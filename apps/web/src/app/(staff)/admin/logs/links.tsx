import "server-only";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { linkClass } from "@/components/staff/rows";
import { membersFor } from "@/lib/sermo/members";
import { hrefFor, type ScreenKey, type Standing } from "../../registry";

// The links of the logs and of the moderation screens: a member to the public profile, and to the
// panel page of the member when the panel has one built for this viewer.

// The panel address of a record, or undefined when the screen is not built or not open to them.
// The registry holds the path with `[id]` in it.
export function panelHref(viewer: Standing, key: ScreenKey, id: number) {
  return hrefFor(viewer, key)?.replace("[id]", String(id));
}

// Usernames for member ids, once for a page. An id the backend no longer knows keeps `#id`.
export async function memberNames(
  ids: Iterable<number>,
  known: { id: number; username: string }[] = [],
) {
  const refs = new Map<number, { id: number; username: string }>();
  for (const id of ids) refs.set(id, { id, username: `#${id}` });
  for (const ref of known) refs.set(ref.id, ref);
  const member = await membersFor(refs.values());
  return (id: number) => member(id).username;
}

export function MemberLink({
  id,
  name,
  panel,
}: {
  id: number;
  name: string;
  panel?: string;
}) {
  const t = useTranslations("adminTools.links");
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <Link href={`/members/${id}`} className={linkClass}>
        {name}
      </Link>
      {panel && (
        <Link href={panel} className={`${linkClass} text-xs`}>
          {t("panel")}
        </Link>
      )}
    </span>
  );
}
