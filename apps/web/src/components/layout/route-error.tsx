"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/forum/empty-state";
import { PageLayout } from "@/components/layout/page-layout";
import { Button, buttonVariants } from "@/components/ui/button";
import { RATE_LIMITED_DIGEST } from "@/lib/sermo/errors";
import { cn } from "@/lib/utils";

// What a page shows when it could not be built. A server error reaches the browser as its digest
// only (the message stays on the server), so the one refusal told apart is the throttled one,
// which carries a digest of its own.
export function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("layout.routeError");
  const throttled = error.digest === RATE_LIMITED_DIGEST;
  return (
    <PageLayout className="md:py-16">
      <EmptyState
        icon={TriangleAlert}
        title={t(throttled ? "throttledTitle" : "title")}
        description={t(throttled ? "throttledDescription" : "description")}
      >
        <Button type="button" onClick={() => retry()} className="h-10 px-4">
          <RefreshCw />
          {t("retry")}
        </Button>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          {t("home")}
        </Link>
      </EmptyState>
    </PageLayout>
  );
}
