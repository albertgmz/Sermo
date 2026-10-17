import { noticesList } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import type { Rule } from "@/components/staff/criteria-rule";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { groupsIfAllowed } from "../groups/data";
import { audienceOf } from "./audience";

// The notices, newest first, each leading to its edit page.
export async function NoticeList({
  searchParams,
  addAction,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
  // The "New notice" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const [t, format, { items }, groups] = await Promise.all([
    getTranslations("adminCommunication.notices"),
    getFormatter(),
    read(noticesList, {}),
    groupsIfAllowed(),
  ]);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const audienceLabel = (rule: Rule) => {
    const { audience, groupId } = audienceOf(rule);
    if (audience !== "group") return t(`fields.${audience}`);
    return t("list.group", {
      group:
        groups?.find((group) => group.id === groupId)?.title ?? `#${groupId}`,
    });
  };
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          removed: t("notices.removed"),
        }}
      />
      <ItemList
        label={t("list.heading")}
        heading={t("list.heading")}
        description={t("list.description")}
        empty={{
          title: t("list.emptyTitle"),
          description: t("list.emptyDescription"),
          action: addAction,
        }}
        items={items.map((item) => ({
          id: item.id,
          title: item.title,
          href: `/admin/notices/${item.id}`,
          badges: (
            <Badge variant={item.active ? "success" : "secondary"}>
              {item.active ? t("list.active") : t("list.inactive")}
            </Badge>
          ),
          description: (
            <>
              {audienceLabel(item.rule)}
              {item.startsAt &&
                ` · ${t("list.from", { date: when(item.startsAt) })}`}
              {item.endsAt &&
                ` · ${t("list.until", { date: when(item.endsAt) })}`}
            </>
          ),
          actions: (
            <RowLink
              href={`/admin/notices/${item.id}`}
              label={t("list.edit", { title: item.title })}
            />
          ),
        }))}
      />
    </>
  );
}
