import { wordFiltersList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { removeWordFilter } from "./actions";

// The word filters the backend returns. Holders of wordFilter.manage get an Edit link and the
// remove step on each row, and the link to add one in the header; the others read the list. The
// backend enforces either way.
export async function FilterList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, viewer, { items }] = await Promise.all([
    getTranslations("adminContent.wordFilters"),
    getViewer(),
    read(wordFiltersList, {}),
  ]);
  const manage = viewer.resolvedPermissions["wordFilter.manage"] === true;
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          saved: t("notices.saved"),
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
        }}
        items={items.map((item) => ({
          id: item.id,
          title: item.term,
          href: manage ? `/admin/word-filters/${item.id}` : undefined,
          badges: (
            <Badge variant={item.isActive ? "success" : "secondary"}>
              {item.isActive ? t("list.active") : t("list.inactive")}
            </Badge>
          ),
          description: (
            <>
              <span className="block">{t(`row.${item.action}`)}</span>
              {item.replacement !== null && (
                <span className="block">
                  {t("list.replacedBy", { replacement: item.replacement })}
                </span>
              )}
            </>
          ),
          actions: manage && (
            <>
              <RowLink
                href={`/admin/word-filters/${item.id}`}
                label={t("list.edit", { term: item.term })}
              />
              <ConfirmStep
                action={removeWordFilter}
                fields={{ id: String(item.id) }}
                summary={t("list.remove")}
                warning={t("list.removeWarning")}
                submit={t("list.remove")}
              />
            </>
          ),
        }))}
      />
    </>
  );
}
