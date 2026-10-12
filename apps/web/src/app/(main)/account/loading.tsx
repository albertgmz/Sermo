import { useTranslations } from "next-intl";
import { ProfileSkeleton } from "@/app/(main)/account/profile-skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.profile");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <ProfileSkeleton />
      </div>
    </LoadingRegion>
  );
}
