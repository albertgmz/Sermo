import { PageSlug, pagesGetSource } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { FormSkeleton, PageHead } from "../../groups/skeletons";
import { deletePage, savePage } from "../actions";
import { PageFields } from "../page-fields";
import { wellKnown } from "../well-known";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.pageEdit");
  return { title: t("metaTitle") };
}

async function Editor({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/pages/[slug]">["params"];
  searchParams: PageProps<"/[locale]/admin/pages/[slug]">["searchParams"];
}) {
  const parsed = PageSlug.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const slug = parsed.data;
  const [t, format, page] = await Promise.all([
    getTranslations("adminContent.pageEdit"),
    getFormatter(),
    read(pagesGetSource, { slug }),
  ]);
  const known = wellKnown(slug);
  const address = `/pages/${slug}`;
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{ created: t("notices.created"), saved: t("notices.saved") }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {page.title}
        </h2>
        <Badge variant={page.isPublished ? "success" : "secondary"}>
          {page.isPublished ? t("published") : t("draft")}
        </Badge>
      </div>
      <Section heading={t("public.heading")}>
        <dl className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{t("public.address")}</dt>
            <dd className="font-medium [overflow-wrap:anywhere]">
              {page.isPublished ? (
                <Link
                  href={address}
                  className="inline-flex min-h-10 items-center text-primary-ink underline-offset-4 hover:underline"
                >
                  {address}
                </Link>
              ) : (
                address
              )}
            </dd>
          </div>
          {known?.address && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t("public.alias")}</dt>
              <dd className="font-medium">{known.address}</dd>
            </div>
          )}
          {known && (
            <p className="text-xs text-muted-foreground">
              {t(`wellKnown.${known.slug}`)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {page.isPublished ? t("public.preview") : t("public.hidden")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("public.updated", {
              date: format.dateTime(new Date(page.updatedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        </dl>
      </Section>
      <FormRows
        key={page.updatedAt}
        action={savePage}
        heading={t("form.heading")}
        description={t("form.description")}
      >
        <input type="hidden" name="slug" value={slug} />
        <PageFields page={page} />
      </FormRows>
      <Section heading={t("delete.heading")} className="border-destructive/30">
        <div className="px-4">
          <ConfirmStep
            action={deletePage}
            fields={{ id: slug }}
            summary={t("delete.summary")}
            warning={t("delete.warning")}
            submit={t("delete.submit")}
          />
        </div>
      </Section>
    </>
  );
}

export default function PageEditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/pages/[slug]">) {
  const t = useTranslations("adminContent.pageEdit");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={3} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Editor params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
