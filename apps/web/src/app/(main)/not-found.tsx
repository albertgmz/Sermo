import { SearchX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/forum/empty-state";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  const t = useTranslations("home.notFound");
  return (
    <PageLayout className="md:py-16">
      <EmptyState
        icon={SearchX}
        title={t("title")}
        description={t("description")}
      >
        <Link href="/" className={cn(buttonVariants(), "h-10 px-4")}>
          {t("back")}
        </Link>
      </EmptyState>
    </PageLayout>
  );
}
