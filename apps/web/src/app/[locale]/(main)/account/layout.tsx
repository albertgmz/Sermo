import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AccountNavigation } from "@/app/[locale]/(main)/account/navigation";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { NameWithIcon } from "@/components/forum/name-icon";
import {
  AccountHeaderSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameProps } from "@/components/forum/user-name";
import { ClientMessages } from "@/components/layout/client-messages";
import { PageLayout } from "@/components/layout/page-layout";
import { SignOutForm } from "@/components/layout/sign-out-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { authorsFor } from "@/lib/sermo/members";
import { NOINDEX } from "@/lib/sermo/seo";
import { getMember } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { robots: NOINDEX };

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("account.layout");
  return (
    <ClientMessages
      namespaces={[
        "account.navigation",
        "account.pictures",
        "account.profile",
        "account.pushDevices",
        "account.username",
        "forum.autosave",
        "forum.framing",
        "lite.navigation",
      ]}
    >
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
            <SignOutForm>
              <Button
                type="submit"
                variant="outline"
                className="min-h-10 w-full"
              >
                {t("logout")}
              </Button>
            </SignOutForm>
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
    </ClientMessages>
  );
}

async function AccountHeader() {
  const { user } = await getMember();
  if (!user) redirect("/login");
  const t = await getTranslations("account.layout");
  const author = (await authorsFor([user]))(user.id);
  const { member } = author;
  const name = userNameProps(member);

  return (
    <header className="relative isolate flex min-h-40 flex-wrap items-end gap-4 overflow-hidden rounded-lg border bg-card p-4 sm:min-h-48 sm:p-6">
      <CoverBackdrop
        cover={author.cover}
        variant="full"
        className="opacity-45"
      />
      <UserAvatar user={member} size="xl" link={false} eager />
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
          <NameWithIcon user={member} />
        </p>
        <p className="break-words text-sm text-muted-foreground">
          {member.title}
        </p>
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
