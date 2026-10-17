import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";
import { FormSkeleton } from "../groups/skeletons";

// The loading screen of a settings page: the header with its trail, the switcher's row, a form.
export function SettingsLoading({ rows }: { rows?: number }) {
  const t = useTranslations("adminSetup.loading");
  return (
    <LoadingRegion label={t("label")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">
          <FormSkeleton rows={rows} />
        </div>
      </div>
    </LoadingRegion>
  );
}
