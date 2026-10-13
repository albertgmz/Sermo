import { Suspense } from "react";
import { ViewerAccent } from "@/components/layout/site-accent";
import { getSite } from "@/lib/sermo/site";

// The sign-in pages are for visitors without a session, so they draw the site's own accent.
async function Accent() {
  const { accents } = await getSite();
  return <ViewerAccent accent={accents[0] ?? null} />;
}

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense>
        <Accent />
      </Suspense>
      {children}
    </>
  );
}
