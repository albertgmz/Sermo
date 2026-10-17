import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { SignupsSkeleton } from "../skeletons";
import { DecisionResult } from "./decision-result";
import { SignupList } from "./signup-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.signups");
  return { title: t("metaTitle") };
}

export default function SignupsPage({
  searchParams,
}: PageProps<"/[locale]/moderation/signups">) {
  const t = useTranslations("moderation.signups");
  return (
    <ScreenFrame
      trail={staffTrail("/moderation/signups")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<SignupsSkeleton />}
    >
      <DecisionResult searchParams={searchParams} />
      <SignupList searchParams={searchParams} />
    </ScreenFrame>
  );
}
