import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(main)/(static)/static-page";
import { LoggedData } from "@/components/forum/logged-data";

export function generateMetadata() {
  return staticPageMetadata("privacy", "/privacy");
}

// Under the privacy text: the link to the cookie policy, then what the server records.
async function CookiePolicyLink() {
  const t = await getTranslations("cookies.banner");
  return (
    <p className="mt-8">
      <Link
        href="/cookies"
        className="font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
      >
        {t("policyLink")}
      </Link>
    </p>
  );
}

export default function Page() {
  return (
    <StaticPage
      slug="privacy"
      path="/privacy"
      after={
        <>
          <CookiePolicyLink />
          <LoggedData />
        </>
      }
    />
  );
}
