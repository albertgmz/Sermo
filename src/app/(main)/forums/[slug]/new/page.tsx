import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NewThreadForm } from "@/app/(main)/forums/[slug]/new/new-thread-form";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageLayout } from "@/components/layout/page-layout";
import { getForum, getPrefixes } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "New thread - forum/ui",
};

export default async function NewThreadPage({
  params,
}: PageProps<"/forums/[slug]/new">) {
  const { slug } = await params;
  const [user, forum, prefixes] = await Promise.all([
    getCurrentUser(),
    getForum(slug),
    getPrefixes(),
  ]);
  if (!forum) notFound();
  if (!user) redirect("/login");

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: forum.categoryTitle, href: `/forums?tab=${forum.tab}` },
          { label: forum.title, href: `/forums/${forum.slug}` },
        ]}
      />
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New thread</h1>
      <div className="mt-4">
        <NewThreadForm slug={forum.slug} prefixes={prefixes} />
      </div>
    </PageLayout>
  );
}
