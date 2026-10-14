import { noticesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton, PageHead } from "../../groups/skeletons";
import { removeNotice, saveNotice } from "../actions";
import { NoticeFields } from "../notice-fields";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.noticeEdit");
  return { title: t("metaTitle") };
}

async function Editor({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/notices/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/notices/[id]">["searchParams"];
}) {
  const noticeId = parseId((await params).id);
  if (noticeId === null) notFound();
  const [t, { items }] = await Promise.all([
    getTranslations("adminCommunication.noticeEdit"),
    read(noticesList, {}),
  ]);
  const notice = items.find((item) => item.id === noticeId);
  if (!notice) notFound();
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{ saved: t("notices.saved") }}
      />
      <FormRows
        key={notice.updatedAt}
        action={saveNotice}
        heading={t("form.heading")}
        description={t("form.description")}
      >
        <input type="hidden" name="id" value={notice.id} />
        <NoticeFields notice={notice} prefix="notice" />
      </FormRows>
      <Section heading={t("delete.heading")} className="border-destructive/30">
        <div className="px-4">
          <ConfirmStep
            action={removeNotice}
            fields={{ id: notice.id }}
            summary={t("delete.summary")}
            warning={t("delete.warning")}
            submit={t("delete.submit")}
          />
        </div>
      </Section>
    </>
  );
}

export default function NoticeEditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/notices/[id]">) {
  const t = useTranslations("adminCommunication.noticeEdit");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={4} />
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
