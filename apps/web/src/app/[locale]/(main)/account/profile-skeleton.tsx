import { useTranslations } from "next-intl";
import { GroupSkeleton } from "@/app/[locale]/(main)/account/skeletons";

// The settings screen while it loads: a group of rows for each group it settles to.
export function ProfileSkeleton() {
  const profile = useTranslations("account.profile");
  const appearance = useTranslations("account.appearance");
  return (
    <div className="space-y-4">
      <GroupSkeleton
        heading={profile("profileGroup")}
        description={profile("profileDescription")}
        rows={8}
      />
      <GroupSkeleton
        heading={appearance("heading")}
        description={appearance("description")}
        rows={4}
      />
    </div>
  );
}
