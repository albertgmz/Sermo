import { useTranslations } from "next-intl";
import { TrailLoading } from "../content-kit/trail-loading";
import { ListSkeleton } from "../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.pages");
  return (
    <TrailLoading label={t("loading")}>
      <ListSkeleton rows={6} />
    </TrailLoading>
  );
}
