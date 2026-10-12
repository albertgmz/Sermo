import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCollage } from "@/app/(auth)/login/auth-collage";
import { LogoMark, LogoMarkPlaceholder } from "@/components/layout/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { getSite } from "@/lib/sermo/site";

// The frame the login page has: the form in a narrow column, the collage beside it from `md` up.
export async function AuthShell({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  const [t, site] = await Promise.all([
    getTranslations("auth.login"),
    getSite(),
  ]);
  return (
    <main className="grid min-h-dvh flex-1 md:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            aria-label={t("aria.home", { site: site.name })}
            className="mx-auto flex size-12 items-center justify-center rounded-md"
          >
            <LogoMark className="size-9" />
          </Link>
          <h1 className="mt-3 mb-8 text-center text-3xl font-bold tracking-tight">
            {heading}
          </h1>
          {children}
        </div>
      </div>
      <AuthCollage className="hidden md:block" />
    </main>
  );
}

export function AuthShellSkeleton({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh flex-1 md:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mx-auto flex size-12 items-center justify-center">
            <LogoMarkPlaceholder className="size-9" />
          </div>
          <h1 className="mt-3 mb-8 text-center text-3xl font-bold tracking-tight">
            {heading}
          </h1>
          {children}
        </div>
      </div>
      <Skeleton className="hidden rounded-none md:block" />
    </main>
  );
}
