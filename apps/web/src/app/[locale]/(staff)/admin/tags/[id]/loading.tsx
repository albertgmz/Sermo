import { useTranslations } from "next-intl";
import { TrailLoading } from "../../content-kit/trail-loading";
import { FormSkeleton } from "../../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.tags");
  return (
    <TrailLoading label={t("loading")}>
      <FormSkeleton rows={2} />
      <FormSkeleton rows={2} />
    </TrailLoading>
  );
}
