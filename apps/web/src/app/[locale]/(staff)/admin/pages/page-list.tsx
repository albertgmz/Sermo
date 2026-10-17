import { pagesList } from "@sermo/core/contracts";
import { FileText, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { WELL_KNOWN, wellKnown } from "./well-known";

const icon = (
  <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
);

// Every page the backend lists, then the well-known pages that do not exist yet. A new page has
// its own address; the old list address that carried a suggested slug now leads there.
export async function PageList({
  searchParams,
  addAction,
}: {
  searchParams: Promise<{
    notice?: string | string[];
    slug?: string | string[];
  }>;
  // The "Add page" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const query = await searchParams;
  if (typeof query.slug === "string" && query.slug !== "") {
    redirect(`/admin/pages/-new?slug=${encodeURIComponent(query.slug)}`);
  }
  const [t, format, { items }] = await Promise.all([
    getTranslations("adminContent.pages"),
    getFormatter(),
    read(pagesList, {}),
  ]);
  const existing = new Set(items.map((item) => item.slug));
  const missing = WELL_KNOWN.filter((entry) => !existing.has(entry.slug));
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{ deleted: t("notices.deleted") }}
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
        items={items.map((item) => {
          const known = wellKnown(item.slug);
          return {
            id: item.slug,
            icon,
            title: item.title,
            href: `/admin/pages/${item.slug}`,
            badges: (
              <Badge variant={item.isPublished ? "success" : "secondary"}>
                {item.isPublished ? t("list.published") : t("list.draft")}
              </Badge>
            ),
            description: (
              <>
                <span className="block">
                  {t("list.summary", {
                    slug: item.slug,
                    address: known?.address ?? `/pages/${item.slug}`,
                    date: format.dateTime(new Date(item.updatedAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </span>
                {known && (
                  <span className="block">{t(`wellKnown.${known.slug}`)}</span>
                )}
              </>
            ),
            actions: (
              <RowLink
                href={`/admin/pages/${item.slug}`}
                label={t("list.edit", { title: item.title })}
              />
            ),
          };
        })}
      />
      {missing.length > 0 && (
        <ItemList
          label={t("suggestions.heading")}
          heading={t("suggestions.heading")}
          description={t("suggestions.description")}
          empty={{ title: t("suggestions.heading") }}
          items={missing.map((entry) => ({
            id: entry.slug,
            icon,
            title: entry.slug,
            href: `/admin/pages/-new?slug=${entry.slug}`,
            description: t(`wellKnown.${entry.slug}`),
            actions: (
              <RowLink
                href={`/admin/pages/-new?slug=${entry.slug}`}
                label={t("suggestions.create", { slug: entry.slug })}
                icon={<Plus />}
              />
            ),
          }))}
        />
      )}
    </>
  );
}
