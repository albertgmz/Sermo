import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";

// The loading file of a route whose page draws a `PageHeader` with a trail: `LoadingPage` with
// the trail's row in the heading placeholder.
export function TrailLoading({ children }: { children: React.ReactNode }) {
  const t = useTranslations("adminGroups.loading");
  return (
    <LoadingRegion label={t("label")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">{children}</div>
      </div>
    </LoadingRegion>
  );
}
