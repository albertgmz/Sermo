import { useTranslations } from "next-intl";
import { TrailLoading } from "../../content-kit/trail-loading";
import { FormSkeleton } from "../../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.wordFilters");
  return (
    <TrailLoading label={t("loading")}>
      <FormSkeleton rows={4} />
    </TrailLoading>
  );
}
