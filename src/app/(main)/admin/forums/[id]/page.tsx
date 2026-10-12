import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("admin.forum");

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
          {t("back")}
        </Link>
        <Link
          href={`/forums/${forum.id}`}
          className={buttonVariants({
            variant: "ghost",
            className: "min-h-10",
          })}
        >
          {t("view")}
        </Link>
      </div>
      {query.notice === "demo" && <DemoNotice />}
      <SectionCard
        title={t("title", { title: forum.title })}
        description={t("description", {
          category: forum.categoryTitle,
          id: forum.id,
        })}
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
