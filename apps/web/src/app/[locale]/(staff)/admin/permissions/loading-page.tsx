import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";

// The loading file of a permission screen: the page header with its breadcrumb, then the given
// skeletons.
export function PermissionsLoading({
  children,
}: {
  children: React.ReactNode;
}) {
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
