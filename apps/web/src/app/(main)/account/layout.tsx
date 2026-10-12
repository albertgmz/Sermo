import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountNavigation } from "@/app/(main)/account/navigation";
import { logout } from "@/app/(main)/actions";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import {
  AccountHeaderSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameProps } from "@/components/forum/user-name";
import { PageLayout } from "@/components/layout/page-layout";
import { Button, buttonVariants } from "@/components/ui/button";
import { titleKeyForLevel } from "@/lib/levels";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("account.layout");
  return (
    <PageLayout
      asideSide="start"
      asideOnMobile="hidden"
      mainClassName="space-y-4"
      aside={
        <>
          <AccountNavigation />
          <Link
            href="/notifications"
            className="flex min-h-10 items-center rounded-lg border bg-card px-4 text-sm text-muted-foreground hover:text-foreground"
          >
            {t("notifications")}
          </Link>
          <form action={logout}>
            <Button type="submit" variant="outline" className="min-h-10 w-full">
              {t("logout")}
            </Button>
          </form>
        </>
      }
    >
      <div className="min-w-0 lg:hidden">
        <AccountNavigation />
      </div>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <AccountHeaderSkeleton />
          </LoadingRegion>
        }
      >
        <AccountHeader />
      </Suspense>
      {children}
    </PageLayout>
  );
}

async function AccountHeader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("account.layout");
  const levels = await getTranslations("lib.levels");
  const roles = await getTranslations("lib.db.roles");
  const title =
    (can(user, "customTitle") && user.customTitle) ||
    (user.role === "member"
      ? levels(titleKeyForLevel(user.level.level))
      : roles(user.role));

  const name = userNameProps(user.member);

  return (
    <header className="relative isolate flex min-h-40 flex-wrap items-end gap-4 overflow-hidden rounded-lg border bg-card p-4 sm:min-h-48 sm:p-6">
      <CoverBackdrop
        cover={user.coverPicture}
        variant="full"
        className="opacity-45"
      />
      <UserAvatar user={user.member} size="xl" link={false} />
      <div className="min-w-0 flex-1 basis-36">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t("heading")}
        </p>
        <p
          className={cn(
            "truncate text-2xl font-bold tracking-tight",
            name.className,
          )}
          style={name.style}
        >
          {user.username}
        </p>
        <p className="break-words text-sm text-muted-foreground">{title}</p>
      </div>
      <Link
        href={`/members/${user.id}`}
        className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}
      >
        {t("profileLink")}
      </Link>
    </header>
  );
}
