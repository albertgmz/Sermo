import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { PagedList } from "@/components/forum/paged-list";
import { SectionHeader } from "@/components/forum/section-card";

// A card with a heading over a paged list (`PagedList`), or over the empty state when the first
// page holds nothing and nothing follows.
export async function PagedCard({
  title,
  description,
  empty,
  ...list
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  empty: { icon: LucideIcon; title: string; description: string };
} & Omit<ComponentProps<typeof PagedList>, "className" | "header">) {
  const heading = <SectionHeader title={title} description={description} />;
  if (list.first.rows.length === 0 && !list.first.nextCursor) {
    return (
      <section className="overflow-hidden rounded-lg border bg-card">
        {heading}
        <EmptyState
          icon={empty.icon}
          title={empty.title}
          description={empty.description}
        />
      </section>
    );
  }
  return (
    <PagedList
      {...list}
      className="overflow-hidden rounded-lg border bg-card"
      header={heading}
    />
  );
}
