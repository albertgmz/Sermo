import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { SectionCard } from "@/components/forum/section-card";
import { buttonVariants } from "@/components/ui/button";
import { getUsers } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

const PAGE_SIZE = 12;
const ROLES = {
  admin: "Administrator",
  moderator: "Moderator",
  member: "Member",
};

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const [members, query] = await Promise.all([getUsers(), searchParams]);
  const pages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const requestedPage = Number(query.page);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, pages)
      : 1;
  const start = (page - 1) * PAGE_SIZE;
  const visible = members
    .toSorted((a, b) => a.username.localeCompare(b.username))
    .slice(start, start + PAGE_SIZE);

  return (
    <>
      <SectionCard
        title="Members"
        description={`${formatNumber(members.length)} members · Roles and ranks`}
      >
        {visible.length ? (
          visible.map((member) => (
            <div key={member.id} className="py-1">
              <MemberRow user={member} />
              <dl className="flex flex-wrap gap-x-5 gap-y-1 px-4 pb-3 text-xs">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Role</dt>
                  <dd>{ROLES[member.role]}</dd>
                </div>
                <div className="flex min-w-0 gap-2">
                  <dt className="text-muted-foreground">Rank</dt>
                  <dd className="break-words">
                    {member.rank?.name ?? "Unranked"}
                  </dd>
                </div>
              </dl>
            </div>
          ))
        ) : (
          <EmptyState title="No members yet" />
        )}
      </SectionCard>
      <nav
        aria-label="Member pages"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-xs text-muted-foreground">
          Page {page} of {pages}
        </p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/admin/members?page=${page - 1}`}
              className={buttonVariants({
                variant: "outline",
                className: "min-h-10",
              })}
            >
              Previous
            </Link>
          )}
          {page < pages && (
            <Link
              href={`/admin/members?page=${page + 1}`}
              className={buttonVariants({
                variant: "outline",
                className: "min-h-10",
              })}
            >
              Next
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}
