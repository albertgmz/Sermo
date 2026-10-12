import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNavigation } from "@/app/(main)/account/navigation";
import { logout } from "@/app/(main)/actions";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameClass } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
            Notifications
          </Link>
          <form action={logout}>
            <Button type="submit" variant="outline" className="min-h-10 w-full">
              Log out
            </Button>
          </form>
        </>
      }
    >
      <div className="min-w-0 lg:hidden">
        <AccountNavigation />
      </div>
      <header className="relative isolate flex min-h-40 flex-wrap items-end gap-4 overflow-hidden rounded-lg border bg-card p-4 sm:min-h-48 sm:p-6">
        <CoverBackdrop
          cover={user.appearance.cover}
          variant="full"
          className="opacity-45"
        />
        <UserAvatar user={user} size="xl" link={false} />
        <div className="min-w-0 flex-1 basis-36">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Your account
          </p>
          <p
            className={cn(
              "truncate text-2xl font-bold tracking-tight",
              userNameClass(user),
            )}
          >
            {user.username}
          </p>
          <p className="break-words text-sm text-muted-foreground">
            {user.title}
          </p>
        </div>
        <Button
          variant="outline"
          className="min-h-10"
          render={<Link href={`/members/${user.id}`} />}
        >
          View profile
        </Button>
      </header>
      {children}
    </PageLayout>
  );
}
