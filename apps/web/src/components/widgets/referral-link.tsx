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

// The signed-in visitor's invitation link, to copy or share, with a line on what it is for. The
// link carries their id; whoever registers through it is counted as their referral. Nothing for a
// guest.
export async function ReferralLink({ title }: WidgetBodyProps<"referralLink">) {
  const { user } = await getViewer();
  if (!user) return null;
  const t = await getTranslations("widgetTypes.referralLink");
  const path = `/register?ref=${user.id}`;
  return (
    <SectionCard title={title}>
      <div className="space-y-3 px-4 py-3">
        <Input
          readOnly
          value={new URL(path, publicUrl()).href}
          aria-label={t("linkLabel")}
        />
        <div className="flex items-center gap-2">
          <CopyButton value={new URL(path, publicUrl()).href} />
          <ShareButton
            href={path}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground md:size-8 [&_svg]:size-4"
          />
        </div>
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
