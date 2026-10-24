import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { CopyButton } from "@/components/forum/copy-button";
import { SectionCard } from "@/components/forum/section-card";
import { ShareButton } from "@/components/forum/share-button";
import { CardSkeleton } from "@/components/forum/skeletons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { publicUrl } from "@/lib/sermo/config";
import { getViewer } from "@/lib/sermo/session";

// The built-in group of a member who has not confirmed their address: the backend does not count
// a referral brought by one.
const UNCONFIRMED_GROUP = 5;

// The invitation link of a member in a read-only field, with Copy and Share beside it: the widget's
// body, and the member's own About tab.
export function ReferralField({ userId }: { userId: number }) {
  const t = useTranslations("widgetTypes.referralLink");
  const link = new URL(`/register?ref=${userId}`, publicUrl()).href;
  return (
    <div className="space-y-3">
      <Input readOnly value={link} aria-label={t("linkLabel")} />
      <div className="flex items-center gap-2">
        <CopyButton value={link} />
        <ShareButton
          href="/register"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground md:size-8 [&_svg]:size-4"
        />
      </div>
    </div>
  );
}

// The signed-in visitor's invitation link, to copy or share, with a line on what it is for. The
// link carries their id; whoever registers through it is counted as their referral. Nothing for a
// guest or for a member who cannot bring referrals yet.
export async function ReferralLink({ title }: WidgetBodyProps<"referralLink">) {
  const { user } = await getViewer();
  if (!user || user.groupId === UNCONFIRMED_GROUP) return null;
  const t = await getTranslations("widgetTypes.referralLink");
  return (
    <SectionCard title={title}>
      <div className="space-y-3 px-4 py-3">
        <ReferralField userId={user.id} />
        <details className="text-sm">
          <summary className="flex min-h-10 cursor-pointer items-center text-muted-foreground hover:text-foreground">
            {t("whatIsThis")}
          </summary>
          <p className="pb-1 text-xs text-pretty text-muted-foreground">
            {t("explanation")}
          </p>
        </details>
      </div>
    </SectionCard>
  );
}

export function ReferralLinkSkeleton() {
  return (
    <CardSkeleton>
      <div className="space-y-3 px-4 py-3">
        <Skeleton className="h-10 w-full md:h-8" />
        <Skeleton className="h-10 w-28" />
      </div>
    </CardSkeleton>
  );
}
