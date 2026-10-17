import { useTranslations } from "next-intl";
import { FormSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminCommunication.notices");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton rows={5} />
    </LoadingPage>
  );
}
