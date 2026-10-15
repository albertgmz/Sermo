"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/forum/empty-state";
import { PageLayout } from "@/components/layout/page-layout";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  APPROVAL_PENDING_DIGEST,
  RATE_LIMITED_DIGEST,
} from "@/lib/sermo/errors";
import { cn } from "@/lib/utils";

const TITLES = {
  plain: "title",
  throttled: "throttledTitle",
  approval: "approvalTitle",
} as const;
const DESCRIPTIONS = {
  plain: "description",
  throttled: "throttledDescription",
  approval: "approvalDescription",
} as const;

// What a page shows when it could not be built. A server error reaches the browser as its digest
// only (the message stays on the server), so the refusals told apart are the throttled one and
// the one of an account waiting for approval, which carry a digest of their own.
export function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("layout.routeError");
  const kind =
    error.digest === RATE_LIMITED_DIGEST
      ? "throttled"
      : error.digest === APPROVAL_PENDING_DIGEST
        ? "approval"
        : "plain";
  return (
    <PageLayout className="md:py-16">
      <EmptyState
        icon={TriangleAlert}
        title={t(TITLES[kind])}
        description={t(DESCRIPTIONS[kind])}
      >
        {kind !== "approval" && (
          <Button type="button" onClick={() => retry()} className="h-10 px-4">
            <RefreshCw />
            {t("retry")}
          </Button>
        )}
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
