import { promotionsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { ConfirmDelete } from "../../groups/confirm-delete";
import { Notice } from "../../groups/notice";
import { FormSkeleton, PageHead } from "../../groups/skeletons";
import { deletePromotion } from "../actions";
import { PromotionForm } from "../promotion-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.promotionEdit");
  return { title: t("metaTitle") };
}

async function Promotion({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/promotions/[id]">["params"];
  searchParams: PageProps<"/admin/promotions/[id]">["searchParams"];
}) {
  const promotionId = parseId((await params).id);
  if (promotionId === null) notFound();
  const [t, promotion] = await Promise.all([
    getTranslations("adminGroups.promotionEdit"),
    read(promotionsGet, { promotionId }),
  ]);
  return (
    <>
      <Notice searchParams={searchParams} shown={["created", "saved"]} />
      <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {promotion.title}
      </h2>
      <PromotionForm promotion={promotion} />
      <ConfirmDelete
        action={deletePromotion}
        id={promotion.id}
        summary={t("deleteHeading")}
        warning={t("deleteWarning")}
        submit={t("delete")}
      />
    </>
  );
}

export default function PromotionPage({
  params,
  searchParams,
}: PageProps<"/admin/promotions/[id]">) {
  const t = useTranslations("adminGroups.promotionEdit");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={4} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Promotion params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
