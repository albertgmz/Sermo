import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../../skeletons";
import { FormSkeleton, ListSkeleton } from "../../groups/skeletons";

// The loading screen of a navigation page: the header with its trail, then a list or a form.
export function NavigationLoading({ list }: { list?: boolean }) {
  const t = useTranslations("adminSetup.pages.navigation");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">
          {list ? <ListSkeleton rows={8} /> : <FormSkeleton />}
        </div>
      </div>
    </LoadingRegion>
  );
}
