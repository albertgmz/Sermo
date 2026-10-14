import { useTranslations } from "next-intl";
import { GroupSkeleton } from "@/app/[locale]/(main)/account/skeletons";
import { StatTileSkeleton } from "@/components/forum/skeletons";

// The settings screen while it loads: the stats, then a group of rows for each group it settles to.
export function ProfileSkeleton() {
  const profile = useTranslations("account.profile");
  const appearance = useTranslations("account.appearance");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <StatTileSkeleton key={i} />
        ))}
      </div>
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
