import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { NewThreadForm } from "@/app/(main)/forums/[id]/new/new-thread-form";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import {
  EditorSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { getForum, getPrefixes } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "New thread - forum/ui",
};

export default async function NewThreadPage({
  params,
}: PageProps<"/forums/[id]/new">) {
  const { id } = await params;
  const forum = await getForum(Number(id));
  if (!forum) notFound();

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: forum.categoryTitle, href: `/forums?tab=${forum.tab}` },
          { label: forum.title, href: `/forums/${forum.id}` },
        ]}
      />
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New thread</h1>
      <div className="mt-4">
        <Suspense
          fallback={
            <LoadingRegion label="Loading thread form…">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <FormRowSkeleton />
                  <FormRowSkeleton />
                </div>
                <EditorSkeleton className="min-h-50" />
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-10 w-20" />
                  <Skeleton className="h-10 w-28" />
                </div>
              </div>
            </LoadingRegion>
          }
        >
          <ThreadForm id={forum.id} />
        </Suspense>
      </div>
    </PageLayout>
  );
}

async function ThreadForm({ id }: { id: number }) {
  const [user, prefixes] = await Promise.all([getCurrentUser(), getPrefixes()]);
  if (!user) redirect("/login");
  return <NewThreadForm id={id} prefixes={prefixes} />;
}
