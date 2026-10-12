import { awardsGet, awardsHolders } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { EconomyNotice } from "../../credits/shared";
import { ConfirmDelete } from "../../groups/confirm-delete";
import { FormSkeleton, PageHead } from "../../groups/skeletons";
import { deleteAward } from "../actions";
import { AwardForm } from "../award-form";

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
  const [t, format, page] = await Promise.all([
    getTranslations("adminEconomy.awards.editPage"),
    getFormatter(),
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
            className="inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {grant.user.username}
          </Link>
          <span className="text-xs text-muted-foreground">
            {format.dateTime(new Date(grant.grantedAt), {
              dateStyle: "medium",
            })}
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
  params: PageProps<"/admin/awards/[id]">["params"];
  searchParams: PageProps<"/admin/awards/[id]">["searchParams"];
}) {
  const awardId = parseId((await params).id);
  if (awardId === null) notFound();
  const [t, award, query] = await Promise.all([
    getTranslations("adminEconomy.awards"),
    read(awardsGet, { awardId }),
    searchParams,
  ]);
  return (
    <>
      <PageHead
        heading={award.name}
        subtitle={t("editPage.subtitle", { count: award.grantCount })}
      />
      <EconomyNotice
        searchParams={searchParams}
        shown={{
          saved: t("notices.saved"),
          createdNoPicture: t("notices.createdNoPicture"),
        }}
      />
      <AwardForm award={award} />
      <ConfirmDelete
        action={deleteAward}
        id={award.id}
        summary={t("deleteHeading")}
        warning={t("deleteWarning")}
        submit={t("delete")}
      />
      <Holders awardId={award.id} params={query} />
      <p>
        <Link
          href="/admin/awards"
          className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("back")}
        </Link>
      </p>
    </>
  );
}

export default async function AwardPage({
  params,
  searchParams,
}: PageProps<"/admin/awards/[id]">) {
  const t = await getTranslations("adminEconomy.awards");
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={8} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <EditAward params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
