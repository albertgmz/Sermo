import Link from "next/link";
import type { ComponentProps } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// The panel of the staff screens: one row per member with a link to their permissions, and under
// it what the page says about them (`detail`), or an empty state when nobody is listed.
export function StaffList<
  Item extends { card: ComponentProps<typeof MemberRow>["user"] },
>({
  items,
  heading,
  permissions,
  empty,
  detail,
}: {
  items: readonly Item[];
  heading: string;
  permissions: string;
  empty: { title: string; description: string };
  detail: (item: Item) => React.ReactNode;
}) {
  if (items.length === 0) {
    return (
      <section className="rounded-lg border bg-card">
        <EmptyState title={empty.title} description={empty.description} />
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
      </div>
      <ul aria-label={heading} className="divide-y">
        {items.map((item) => (
          <li key={item.card.id}>
            <MemberRow user={item.card} className="flex-wrap py-3">
              <Link
                href={`/admin/permissions/members/${item.card.id}`}
                className={link}
              >
                {permissions}
              </Link>
            </MemberRow>
            {detail(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}
