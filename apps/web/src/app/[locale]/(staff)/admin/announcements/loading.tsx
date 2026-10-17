import { useTranslations } from "next-intl";
import { ListSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  const t = useTranslations("adminCommunication.announcements");
  return (
    <LoadingPage label={t("loading")}>
      <ListSkeleton rows={5} />
    </LoadingPage>
  );
}
