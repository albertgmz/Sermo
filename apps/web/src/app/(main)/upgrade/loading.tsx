import { useTranslations } from "next-intl";
import {
  FaqSkeleton,
  HeroSkeleton,
  RanksSkeleton,
} from "@/app/(main)/upgrade/skeletons";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";

export default function Loading() {
  const t = useTranslations("upgrade.loading");
  return (
    <LoadingRegion label={t("aria.loading")}>
      <HeroSkeleton />
      <Container className="space-y-12 pb-8">
        <RanksSkeleton />
        <FaqSkeleton />
      </Container>
    </LoadingRegion>
  );
}
