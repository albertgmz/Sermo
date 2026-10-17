import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSkeleton, LoadingPage } from "../../skeletons";

// The loading screen of a settings page: the header with its trail, the switcher's row (but on
// the warning pages, which have none), a form.
export function SettingsLoading({
  rows,
  switcher = true,
}: {
  rows?: number;
  switcher?: boolean;
}) {
  const t = useTranslations("adminSetup.loading");
  return (
    <LoadingPage label={t("label")}>
      {switcher && <Skeleton aria-hidden="true" className="h-11 w-full" />}
      <FormSkeleton rows={rows} />
    </LoadingPage>
  );
}
