import { nodesGet, nodesList, threadPrefixesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { ComposerSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { ThreadComposer } from "@/components/forum/thread-composer";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { parsePageId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { activePrefixViews } from "@/lib/sermo/threads";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forums.new");
  return { title: t("metaTitle") };
}

export default async function NewThreadPage({
  params,
}: PageProps<"/[locale]/forums/[id]/new">) {
  const nodeId = parsePageId((await params).id);
  if (nodeId === null) notFound();
  const { node, resolvedPermissions } = await read(nodesGet, { nodeId });
  // Threads live in forums; a category has none to start.
  if (node.type !== "forum") notFound();
  const t = await getTranslations("forums.new");

  return (
    <PageLayout className="pt-2">
      <h1 className="sr-only">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loading")}>
            <ComposerSkeleton />
          </LoadingRegion>
        }
      >
        <ThreadForm
          id={node.id}
          canPost={node.permissions.canPost}
          requirePrefix={node.settings.requirePrefix}
          canAttach={resolvedPermissions["forum.uploadAttachments"] === true}
          canPoll={resolvedPermissions["poll.create"] === true}
        />
      </Suspense>
    </PageLayout>
  );
}

async function ThreadForm({
  id,
  canPost,
  requirePrefix,
  canAttach,
  canPoll,
}: {
  id: number;
  canPost: boolean;
  requirePrefix: boolean;
  canAttach: boolean;
  canPoll: boolean;
}) {
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
  const [{ items: prefixItems }, { items: nodes }] = await Promise.all([
    read(threadPrefixesList, { nodeId: id }),
    read(nodesList, {}),
  ]);
  const prefixes = activePrefixViews(prefixItems);
  const viewer = await getViewer();
  const forums = nodes.map(({ id, parentId, title, type, permissions }) => ({
    id,
    parentId,
    title,
    type,
    canPost: permissions.canPost,
  }));
  return (
    <ThreadComposer
      forumId={id}
      forums={forums}
      prefixes={prefixes}
      // As the backend applies it: a forum with nothing to choose from asks for nothing.
      requirePrefix={requirePrefix && prefixes.length > 0}
      canAttach={canAttach}
      canTag={viewer.resolvedPermissions["tag.apply"] === true}
      canPoll={canPoll}
      memberId={viewer.user?.id ?? null}
    />
  );
}
