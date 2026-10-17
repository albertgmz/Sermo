import { noticesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm } from "@/components/staff/edit-form";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
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
      <EditForm key={notice.updatedAt} action={saveNotice}>
        <input type="hidden" name="id" value={notice.id} />
        <NoticeFields notice={notice} prefix="notice" />
      </EditForm>
      <ConfirmStep
        heading={t("delete.heading")}
        action={removeNotice}
        fields={{ id: notice.id }}
        summary={t("delete.summary")}
        warning={t("delete.warning")}
        submit={t("delete.submit")}
      />
    </>
  );
}

export default function NoticeEditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/notices/[id]">) {
  const t = useTranslations("adminCommunication.noticeEdit");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={params.then(({ id }) => staffTrail(`/admin/notices/${id}`))}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <Editor params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
