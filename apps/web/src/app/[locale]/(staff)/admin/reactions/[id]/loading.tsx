import { useTranslations } from "next-intl";
import { EditFormSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.reactions");
  return (
    <LoadingPage label={t("loading")}>
      <EditFormSkeleton advanced={2} />
    </LoadingPage>
  );
}
