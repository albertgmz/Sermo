import { useTranslations } from "next-intl";
import { LoadingPage } from "../../skeletons";
import { FormSkeleton } from "../groups/skeletons";

// The loading screen of a settings page: the header with its trail, the switcher's row, a form.
export function SettingsLoading({ rows }: { rows?: number }) {
  const t = useTranslations("adminSetup.loading");
  return (
    <LoadingPage label={t("label")}>
      <FormSkeleton rows={rows} />
    </LoadingPage>
  );
}
