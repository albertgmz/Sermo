import { useTranslations } from "next-intl";
import { rowClass } from "@/app/[locale]/(main)/account/security/form-rows";
import { MemberRowSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

function SectionShell({
  heading,
  description,
  children,
}: {
  heading: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-hidden="true" className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function SessionsSkeleton() {
  const t = useTranslations("account.loading");
  return (
    <SectionShell
      heading={t("sessionsHeading")}
      description={t("sessionsDescription")}
    >
      <div className="divide-y">
        <MemberRowSkeleton />
        <MemberRowSkeleton />
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-10 w-44" />
      </div>
    </SectionShell>
  );
}

export function HistorySkeleton() {
  const t = useTranslations("account.loading");
  return (
    <SectionShell
      heading={t("historyHeading")}
      description={t("historyDescription")}
    >
      <div className="divide-y">
        <MemberRowSkeleton />
        <MemberRowSkeleton />
        <MemberRowSkeleton />
      </div>
    </SectionShell>
  );
}

export function PasswordSkeleton() {
  const t = useTranslations("account.loading");
  return (
    <SectionShell
      heading={t("passwordHeading")}
      description={t("passwordDescription")}
    >
      <div className="divide-y">
        {[0, 1, 2].map((row) => (
          <div key={row} className={rowClass}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full md:h-8" />
          </div>
        ))}
        <div className="p-4">
          <Skeleton className="h-10 w-64 max-w-full" />
        </div>
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-10 w-36" />
      </div>
    </SectionShell>
  );
}

export function EmailSkeleton() {
  const t = useTranslations("account.loading");
  return (
    <SectionShell
      heading={t("emailHeading")}
      description={t("emailDescription")}
    >
      <div className={rowClass}>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="border-t">
        <div className={rowClass}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full md:h-8" />
        </div>
        <div className="border-t p-4">
          <Skeleton className="h-10 w-36" />
        </div>
      </div>
    </SectionShell>
  );
}
