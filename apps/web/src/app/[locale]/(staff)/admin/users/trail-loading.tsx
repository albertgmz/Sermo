import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";

// The loading state of a page that draws a `PageHeader` with a trail: the heading's placeholder,
// then the skeletons of what streams in below it.
export function TrailLoading({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">{children}</div>
      </div>
    </LoadingRegion>
  );
}
