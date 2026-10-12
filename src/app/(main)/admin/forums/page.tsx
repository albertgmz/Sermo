import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/forum/empty-state";
import { SectionCard } from "@/components/forum/section-card";
import { buttonVariants } from "@/components/ui/button";
import { getCategories } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export default async function AdminForumsPage() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const categories = await getCategories();

  return (
    <>
      <h2 className="text-lg font-semibold">Forums</h2>
      {categories.some((category) => category.forums.length) ? (
        categories.map((category) => (
          <SectionCard
            key={category.id}
            title={category.title}
            description={`${category.forums.length} forums`}
          >
            {category.forums.map((forum) => (
              <div key={forum.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/forums/${forum.id}`}
                    className="inline-flex min-h-10 max-w-full items-center text-sm font-semibold underline-offset-4 hover:underline"
                  >
                    <span className="truncate">{forum.title}</span>
                  </Link>
                  <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {forum.description}
                  </p>
                  <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                    {formatNumber(forum.threadCount)} threads ·{" "}
                    {formatNumber(forum.postCount)} posts
                  </p>
                </div>
                <Link
                  href={`/admin/forums/${forum.id}`}
                  aria-label={`Edit ${forum.title}`}
                  className={buttonVariants({
                    variant: "outline",
                    className: "min-h-10",
                  })}
                >
                  Edit
                </Link>
              </div>
            ))}
            {!category.forums.length && (
              <EmptyState title="No forums in this category" />
            )}
          </SectionCard>
        ))
      ) : (
        <EmptyState
          title="No forums yet"
          description="Forums will appear here when they are available."
        />
      )}
    </>
  );
}
