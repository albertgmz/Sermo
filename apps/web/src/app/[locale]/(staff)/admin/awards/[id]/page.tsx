import { awardsGet, awardsHolders } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { EditForm } from "@/components/staff/edit-form";
import { Notice } from "@/components/staff/notice";
import { PageHeader } from "@/components/staff/page-header";
import { StreamedPanel } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { EditFormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { deleteAward, saveAward } from "../actions";
import { AwardFormFields } from "../award-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awards.editPage");
  return { title: t("metaTitle") };
}

async function Holders({
  awardId,
  params,
}: {
  awardId: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const [t, page] = await Promise.all([
    getTranslations("adminEconomy.awards.editPage"),
    read(awardsHolders, { awardId, cursor: cursorFrom(params), limit: 25 }),
  ]);
  return (
    <CursorList
      items={page.items}
      nextCursor={page.nextCursor}
      path={`/admin/awards/${awardId}`}
      params={params}
      itemKey={(grant) => grant.id}
      label={t("holders")}
      head={
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("holders")}</h2>
        </div>
      }
      empty={{ title: t("noHolders") }}
      render={(grant) => (
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
          <Link
            href={`/members/${grant.user.id}`}
            className="inline-flex min-h-10 items-center font-medium text-primary-ink underline-offset-4 hover:underline"
          >
            {grant.user.username}
          </Link>
          <span className="text-xs text-muted-foreground">
            <RelativeTime date={grant.grantedAt} />
            {grant.grantedBy
              ? ` · ${t("by", { name: grant.grantedBy.username })}`
              : ` · ${t("automatic")}`}
          </span>
        </div>
      )}
    />
  );
}

async function EditAward({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/awards/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/awards/[id]">["searchParams"];
}) {
  const awardId = parseId((await params).id);
  if (awardId === null) notFound();
  const [t, award, query] = await Promise.all([
    getTranslations("adminEconomy.awards"),
    read(awardsGet, { awardId }),
    searchParams,
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        trail={staffTrail(`/admin/awards/${award.id}`)}
        title={award.name}
        description={t("editPage.subtitle", { count: award.grantCount })}
      />
      <div className="space-y-4">
        <Notice
          searchParams={searchParams}
          notices={{
            saved: t("notices.saved"),
            createdNoPicture: t("notices.createdNoPicture"),
          }}
        />
        <EditForm action={saveAward}>
          <AwardFormFields award={award} />
        </EditForm>
        <ConfirmStep
          action={deleteAward}
          fields={{ id: award.id }}
          heading={t("deleteHeading")}
          warning={t("deleteWarning")}
          submit={t("delete")}
        />
        <Holders awardId={award.id} params={query} />
      </div>
    </div>
  );
}

export default async function AwardPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/awards/[id]">) {
  const t = await getTranslations("adminEconomy.awards");
  return (
    <StreamedPanel
      label={t("loading")}
      fallback={<EditFormSkeleton heading rows={7} advanced={1} />}
    >
      <EditAward params={params} searchParams={searchParams} />
    </StreamedPanel>
  );
}
