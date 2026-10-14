import { useTranslations } from "next-intl";
import { SectionSkeleton } from "@/app/[locale]/(main)/account/skeletons";
import { StatTileSkeleton } from "@/components/forum/skeletons";

export function ProfileSkeleton() {
  const pictures = useTranslations("account.pictures");
  const username = useTranslations("account.username");
  const about = useTranslations("account.about");
  const title = useTranslations("account.title");
  const referral = useTranslations("account.referral");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <StatTileSkeleton key={i} />
        ))}
      </div>
      <SectionSkeleton
        heading={pictures("heading")}
        description={pictures("description")}
        rows={2}
      />
      <SectionSkeleton
        heading={username("heading")}
        description={username("description")}
        rows={1}
      />
      <SectionSkeleton
        heading={about("heading")}
        description={about("description")}
        rows={7}
      />
      <SectionSkeleton
        heading={title("heading")}
        description={title("description")}
        rows={2}
      />
      <SectionSkeleton
        heading={referral("heading")}
        description={referral("description")}
        rows={1}
      />
    </div>
  );
}
