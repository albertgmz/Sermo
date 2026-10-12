import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoNotice } from "@/app/(main)/admin/demo-notice";
import { ForumForm } from "@/app/(main)/admin/forums/forum-form";
import { SectionCard } from "@/components/forum/section-card";
import { buttonVariants } from "@/components/ui/button";
import { getCategories } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export default async function AdminForumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const [categories, query] = await Promise.all([
    getCategories(),
    searchParams,
  ]);
  const forum = categories
    .flatMap((category) => category.forums)
    .find((forum) => forum.id === Number(id));
  if (!forum) notFound();

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/forums"
          className={buttonVariants({
            variant: "outline",
            className: "min-h-10",
          })}
        >
          Back to forums
        </Link>
        <Link
          href={`/forums/${forum.id}`}
          className={buttonVariants({
            variant: "ghost",
            className: "min-h-10",
          })}
        >
          View forum
        </Link>
      </div>
      {query.notice === "demo" && <DemoNotice />}
      <SectionCard
        title={`Edit ${forum.title}`}
        description={`${forum.categoryTitle} · Forum #${forum.id}`}
      >
        <ForumForm
          id={forum.id}
          title={forum.title}
          description={forum.description}
        />
      </SectionCard>
    </>
  );
}
