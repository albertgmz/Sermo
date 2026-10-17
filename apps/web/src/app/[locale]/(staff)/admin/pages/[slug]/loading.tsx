import { useTranslations } from "next-intl";
import { TrailLoading } from "../../content-kit/trail-loading";
import { FormSkeleton } from "../../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.pageEdit");
  return (
    <TrailLoading label={t("loading")}>
      <FormSkeleton rows={3} />
    </TrailLoading>
  );
}
