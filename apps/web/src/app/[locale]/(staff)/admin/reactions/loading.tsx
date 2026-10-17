import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";
import { ListSkeleton } from "../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.reactions");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <ListSkeleton rows={6} />
      </div>
    </LoadingRegion>
  );
}
