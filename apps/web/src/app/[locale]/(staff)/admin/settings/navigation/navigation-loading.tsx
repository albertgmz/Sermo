import { useTranslations } from "next-intl";
import { FormSkeleton, ListSkeleton, LoadingPage } from "../../../skeletons";

// The loading screen of a navigation page: the header with its trail, then a list or a form.
export function NavigationLoading({ list }: { list?: boolean }) {
  const t = useTranslations("adminSetup.pages.navigation");
  return (
    <LoadingPage label={t("loading")}>
      {list ? <ListSkeleton rows={8} /> : <FormSkeleton />}
    </LoadingPage>
  );
}
