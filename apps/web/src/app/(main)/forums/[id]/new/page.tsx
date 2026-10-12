import { nodesGet, threadPrefixesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { NewThreadForm } from "@/app/(main)/forums/[id]/new/new-thread-form";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import {
  EditorSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { call, read } from "@/lib/sermo/client";
import { prefixView } from "@/lib/sermo/threads";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forums.new");
  return { title: t("metaTitle") };
}

export default async function NewThreadPage({
  params,
}: PageProps<"/forums/[id]/new">) {
  const nodeId = Number((await params).id);
  if (!Number.isInteger(nodeId) || nodeId < 1) notFound();
  const { node, breadcrumbs } = await read(nodesGet, { nodeId });
  // Threads live in forums; a category has none to start.
  if (node.type !== "forum") notFound();
  const t = await getTranslations("forums.new");
  const trail = breadcrumbs.filter((crumb) => crumb.id !== node.id);

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
          ...trail.map((crumb) => ({
            label: crumb.title,
            href: `/forums/${crumb.id}`,
          })),
          { label: node.title, href: `/forums/${node.id}` },
        ]}
      />
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {t("heading")}
      </h1>
      <div className="mt-4">
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loading")}>
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
          <ThreadForm id={node.id} canPost={node.permissions.canPost} />
        </Suspense>
      </div>
    </PageLayout>
  );
}

async function ThreadForm({ id, canPost }: { id: number; canPost: boolean }) {
  const t = await getTranslations("forums.new");
  if (!canPost) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          title={t("cannotPostTitle")}
          description={t("cannotPostDescription")}
        />
      </div>
    );
  }
  const { items } = await call(threadPrefixesList, {});
  const prefixes = items.flatMap((prefix) =>
    prefix.isActive ? (prefixView(prefix) ?? []) : [],
  );
  return <NewThreadForm id={id} prefixes={prefixes} />;
}
