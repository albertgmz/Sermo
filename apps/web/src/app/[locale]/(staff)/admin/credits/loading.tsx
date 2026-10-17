import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";
import { FormSkeleton, ListSkeleton } from "../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.adjust");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">
          <FormSkeleton rows={2} />
          <ListSkeleton />
        </div>
      </div>
    </LoadingRegion>
  );
}
