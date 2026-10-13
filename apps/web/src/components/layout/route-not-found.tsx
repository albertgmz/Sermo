import { SearchX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/forum/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// What a page that does not exist shows outside the site's own shell: the sign-in pages, the panel
// and anything the framework cannot place.
export function RouteNotFound({ panel = false }: { panel?: boolean }) {
  const t = useTranslations("layout.notFound");
  return (
    <div className="rounded-lg border bg-card">
      <EmptyState
        icon={SearchX}
        title={t("title")}
        description={t("description")}
      >
        <Link
          href={panel ? "/admin" : "/"}
          className={cn(buttonVariants(), "h-10 px-4")}
        >
          {t(panel ? "panel" : "home")}
        </Link>
      </EmptyState>
    </div>
  );
}
