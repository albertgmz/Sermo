import { useTranslations } from "next-intl";
import { ListSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.tags");
  return (
    <LoadingPage label={t("loading")}>
      <ListSkeleton rows={6} />
    </LoadingPage>
  );
}
