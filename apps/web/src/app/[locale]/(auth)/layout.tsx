import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientMessages } from "@/components/layout/client-messages";
import { ViewerAccent } from "@/components/layout/site-accent";
import { NOINDEX } from "@/lib/sermo/seo";
import { getSite } from "@/lib/sermo/site";

export const metadata: Metadata = { robots: NOINDEX };

// The sign-in pages are for visitors without a session, so they draw the site's own accent.
async function Accent() {
  const { accents } = await getSite();
  return <ViewerAccent accent={accents[0] ?? null} />;
}

export default function AuthLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <ClientMessages
      namespaces={[
        "auth.forgotPassword",
        "auth.loginForm",
        "auth.notMe",
        "auth.passwordField",
        "auth.passwordStrength",
        "auth.registerForm",
        "auth.resendForm",
        "auth.resetPassword",
        "auth.turnstile",
      ]}
    >
      <Suspense>
        <Accent />
      </Suspense>
      {children}
    </ClientMessages>
  );
}
