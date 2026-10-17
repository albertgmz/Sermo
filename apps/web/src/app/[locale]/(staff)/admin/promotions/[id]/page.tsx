import { promotionsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
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
  params: PageProps<"/[locale]/admin/promotions/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/promotions/[id]">["searchParams"];
}) {
  const promotionId = parseId((await params).id);
  if (promotionId === null) notFound();
  const [t, promotion] = await Promise.all([
    getTranslations("adminGroups.promotionEdit"),
    read(promotionsGet, { promotionId }),
  ]);
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["created", "saved"]}
      />
      <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {promotion.title}
      </h2>
      <PromotionForm promotion={promotion} />
      <ConfirmStep
        action={deletePromotion}
        fields={{ id: promotion.id }}
        heading={t("deleteHeading")}
        warning={t("deleteWarning")}
        submit={t("delete")}
        password
      />
    </>
  );
}

export default function PromotionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/promotions/[id]">) {
  const t = useTranslations("adminGroups.promotionEdit");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={params.then(({ id }) => staffTrail(`/admin/promotions/${id}`))}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <Promotion params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
