import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/forum/empty-state";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <PageLayout className="md:py-16">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page you are looking for does not exist or has been removed."
      >
        <Link href="/" className={cn(buttonVariants(), "h-10 px-4")}>
          Back to home
        </Link>
      </EmptyState>
    </PageLayout>
  );
}
