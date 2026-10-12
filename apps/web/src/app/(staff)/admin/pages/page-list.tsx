import { pagesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";
import { Notice } from "../content-kit/notice";
import { createPage } from "./actions";
import { PageFields } from "./page-fields";
import { WELL_KNOWN, wellKnown } from "./well-known";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// Every page the backend lists, the well-known pages that do not exist yet, then the form for a
// new page.
export async function PageList({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string | string[];
    slug?: string | string[];
  }>;
}) {
  const [t, format, { items }, query] = await Promise.all([
    getTranslations("adminContent.pages"),
    getFormatter(),
    read(pagesList, {}),
    searchParams,
  ]);
  const existing = new Set(items.map((item) => item.slug));
  const missing = WELL_KNOWN.filter((entry) => !existing.has(entry.slug));
  const suggested = typeof query.slug === "string" ? query.slug : "";
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{ deleted: t("notices.deleted") }}
      />
      <Section heading={t("list.heading")} description={t("list.description")}>
        {items.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          />
        ) : (
          <ul aria-label={t("list.heading")} className="divide-y">
            {items.map((item) => {
              const known = wellKnown(item.slug);
              return (
                <li
                  key={item.slug}
                  className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="[overflow-wrap:anywhere]">
                        {item.title}
                      </span>
                      <Badge
                        variant={item.isPublished ? "success" : "secondary"}
                      >
                        {item.isPublished
                          ? t("list.published")
                          : t("list.draft")}
                      </Badge>
                    </p>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt>{t("list.slug")}</dt>
                        <dd className="font-medium text-foreground [overflow-wrap:anywhere]">
                          {item.slug}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t("list.address")}</dt>
                        <dd className="font-medium text-foreground [overflow-wrap:anywhere]">
                          {known?.address ?? `/pages/${item.slug}`}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t("list.updated")}</dt>
                        <dd className="font-medium text-foreground">
                          {format.dateTime(new Date(item.updatedAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </dd>
                      </div>
                    </dl>
                    {known && (
                      <p className="text-xs text-muted-foreground">
                        {t(`wellKnown.${known.slug}`)}
                      </p>
                    )}
                  </div>
                  <Link href={`/admin/pages/${item.slug}`} className={link}>
                    {t("list.edit")}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {missing.length > 0 && (
        <Section
          heading={t("suggestions.heading")}
          description={t("suggestions.description")}
        >
          <ul aria-label={t("suggestions.heading")} className="divide-y">
            {missing.map((entry) => (
              <li
                key={entry.slug}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{entry.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`wellKnown.${entry.slug}`)}
                  </p>
                </div>
                <Link
                  href={`/admin/pages?slug=${entry.slug}#new`}
                  className={link}
                >
                  {t("suggestions.create")}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <FormRows
        key={suggested}
        action={createPage}
        heading={t("create.heading")}
        description={t("create.description")}
        submit={t("create.submit")}
        id="new"
      >
        <FieldRow
          name="slug"
          label={t("create.slug")}
          htmlFor="page-slug"
          help={t("create.slugHelp")}
        >
          <Input
            id="page-slug"
            name="slug"
            required
            defaultValue={suggested}
            autoCapitalize="none"
            spellCheck={false}
          />
        </FieldRow>
        <PageFields />
      </FormRows>
    </>
  );
}
