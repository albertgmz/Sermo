import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";
import { FormSkeleton, ListSkeleton } from "../groups/skeletons";

// The loading files of the appearance routes: the heading with its trail, then the skeleton of
// what settles (the rows of a list or a sort page, or the form of an add or edit page).

function Loading({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        {children}
      </div>
    </LoadingRegion>
  );
}

export function ListLoading() {
  return (
    <Loading>
      <ListSkeleton />
    </Loading>
  );
}

export function FormLoading() {
  return (
    <Loading>
      <FormSkeleton />
    </Loading>
  );
}
