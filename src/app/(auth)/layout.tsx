import { Suspense } from "react";
import { SiteAccent } from "@/components/layout/site-accent";
import { getCurrentUser } from "@/lib/session";

async function Accent() {
  return <SiteAccent user={await getCurrentUser()} />;
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
