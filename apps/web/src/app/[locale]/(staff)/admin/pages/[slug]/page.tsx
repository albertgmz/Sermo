import {
  AcceptanceKind,
  PageSlug,
  pagesGetSource,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
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
  const [t, page] = await Promise.all([
    getTranslations("adminContent.pageEdit"),
    read(pagesGetSource, { slug }),
  ]);
  const known = wellKnown(slug);
  const address = `/pages/${slug}`;
  // The pages members have to accept carry a version an administrator raises on purpose.
  const versioned = AcceptanceKind.safeParse(slug).success;
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
          {versioned && (
            <p className="text-xs text-muted-foreground">
              {t("version", { version: page.version })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t.rich("public.updated", {
              time: () => <RelativeTime date={page.updatedAt} />,
            })}
          </p>
        </dl>
      </Section>
      <EditForm key={page.updatedAt} action={savePage}>
        <input type="hidden" name="slug" value={slug} />
        <FieldGroup
          legend={t("form.heading")}
          description={t("form.description")}
        >
          <PageFields page={page} versioned={versioned} />
        </FieldGroup>
      </EditForm>
      <ConfirmStep
        heading={t("delete.heading")}
        action={deletePage}
        fields={{ id: slug }}
        summary={t("delete.summary")}
        warning={t("delete.warning")}
        submit={t("delete.submit")}
      />
    </>
  );
}

export default function PageEditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/pages/[slug]">) {
  const t = useTranslations("adminContent.pageEdit");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={params.then(({ slug }) => staffTrail(`/admin/pages/${slug}`))}
      label={t("loading")}
      fallback={<FormSkeleton rows={3} />}
    >
      <Editor params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
