import { noticesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { groupsIfAllowed } from "../groups/data";
import { createNotice } from "./actions";
import { NoticeFields } from "./notice-fields";

// The notices, newest first, each with the link to edit it, and the form for a new one.
export async function NoticeList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, format, { items }, groups] = await Promise.all([
    getTranslations("adminCommunication.notices"),
    getFormatter(),
    read(noticesList, {}),
    groupsIfAllowed(),
  ]);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          removed: t("notices.removed"),
        }}
      />
      <Section heading={t("list.heading")} description={t("list.description")}>
        {items.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          />
        ) : (
          <ul aria-label={t("list.heading")} className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="space-y-1 p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="[overflow-wrap:anywhere]">{item.title}</span>
                  <Badge variant={item.active ? "success" : "secondary"}>
                    {item.active ? t("list.active") : t("list.inactive")}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {item.audience === "group"
                    ? t("list.group", {
                        group:
                          groups?.find((group) => group.id === item.groupId)
                            ?.title ?? `#${item.groupId}`,
                      })
                    : t(`fields.${item.audience}`)}
                  {item.startsAt &&
                    ` · ${t("list.from", { date: when(item.startsAt) })}`}
                  {item.endsAt &&
                    ` · ${t("list.until", { date: when(item.endsAt) })}`}
                </p>
                <Link
                  href={`/admin/notices/${item.id}`}
                  className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("list.edit")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <FormRows
        action={createNotice}
        heading={t("create.heading")}
        description={t("create.description")}
        submit={t("create.submit")}
        id="new"
      >
        <NoticeFields prefix="new-notice" />
      </FormRows>
    </>
  );
}
