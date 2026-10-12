import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeaderSkeleton } from "./header-skeleton";
import { MemberHeader } from "./member-header";

// The member's header, tab strip and notices, shared by every tab. Each tab streams its own
// content below it.
export default function MemberLayout({
  children,
  params,
}: LayoutProps<"/admin/users/[id]">) {
  const t = useTranslations("adminUsers.header");
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <HeaderSkeleton />
          </LoadingRegion>
        }
      >
        <MemberHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}
