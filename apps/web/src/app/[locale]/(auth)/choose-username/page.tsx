import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { ChooseUsernameForm } from "@/app/[locale]/(auth)/choose-username/choose-username-form";
import { refusalText } from "@/app/[locale]/(auth)/refusal-text";
import { termsPages } from "@/app/[locale]/(auth)/register/terms-pages";
import { SignOutForm } from "@/components/layout/sign-out-form";
import { Button } from "@/components/ui/button";
import { safeReturnPath } from "@/lib/sermo/return-path";
import { getMember } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.chooseUsername");
  return {
    title: t("metaTitle"),
  };
}

// The first page of a member whose account a sign-in provider made: they choose their username and
// accept the terms, then go on to `next` (the forum's pages send them here, `UsernameGate`). A
// member who has a username of their own goes straight on; a guest goes to sign in. Every forum page
// sends the member back here, so the screen has its own way out: the site's sign-out form, for
// someone who signed in with the wrong account.
export default async function ChooseUsernamePage({
  searchParams,
}: PageProps<"/[locale]/choose-username">) {
  const [{ next, refused }, { user }] = await Promise.all([
    searchParams,
    getMember(),
  ]);
  const back = safeReturnPath(next);
  if (!user) redirect("/login");
  if (!user.needsUsername) redirect(back);
  const [t, { registration }, pages, refusal] = await Promise.all([
    getTranslations("auth.chooseUsername"),
    getSite(),
    termsPages(),
    refusalText(refused),
  ]);
  return (
    <AuthShell heading={t("heading")}>
      <p className="mb-6 -mt-3 text-center text-sm text-muted-foreground md:-mt-5">
        {t("description")}
      </p>
      <ChooseUsernameForm
        username={user.username}
        next={back}
        pages={pages}
        fields={registration.fields}
        minimumAge={registration.minimumAge}
        {...(refusal ? { refusal } : {})}
      />
      <SignOutForm className="mt-4">
        <Button
          type="submit"
          variant="ghost"
          className="h-10 w-full text-muted-foreground md:h-8"
        >
          <LogOut aria-hidden="true" />
          {t("signOut")}
        </Button>
      </SignOutForm>
    </AuthShell>
  );
}
