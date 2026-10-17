import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton, LinkCardsSkeleton } from "../../skeletons";

export default function Loading() {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <LinkCardsSkeleton />
      </div>
    </LoadingRegion>
  );
}
