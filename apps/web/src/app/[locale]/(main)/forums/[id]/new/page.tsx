import {
  nodesGet,
  nodesList,
  preferencesGet,
  threadPrefixesList,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { LazyGuestThreadComposer } from "@/components/forum/guest-lazy";
import { ComposerSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { ThreadComposer } from "@/components/forum/thread-composer";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { forumChoices } from "@/lib/sermo/forum-choices";
import { guestPostKey } from "@/lib/sermo/guest-posting";
import { parsePageId } from "@/lib/sermo/ids";
import { NOINDEX } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";
import { activePrefixViews } from "@/lib/sermo/threads";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forums.new");
  return { title: t("metaTitle"), robots: NOINDEX };
}

export default async function NewThreadPage({
  params,
}: PageProps<"/[locale]/forums/[id]/new">) {
  const nodeId = parsePageId((await params).id);
  if (nodeId === null) notFound();
  const { node, resolvedPermissions } = await read(nodesGet, { nodeId });
  // Threads live in forums; a category has none to start.
  if (node.type !== "forum") notFound();
  const [t, { user }] = await Promise.all([
    getTranslations("forums.new"),
    getViewer(),
  ]);
  const guestKey = await guestPostKey(
    user !== null,
    resolvedPermissions,
    node.settings,
  );
  // A guest who may not start a thread here is asked to sign in, as ever.
  if (!user && !guestKey)
    redirect(`/login?next=${encodeURIComponent(`/forums/${node.id}/new`)}`);

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
          guestKey={guestKey}
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
  guestKey,
  requirePrefix,
  canAttach,
  canPoll,
}: {
  id: number;
  canPost: boolean;
  // The Turnstile key of a guest's form, where a guest may start a thread here.
  guestKey: string | null;
  requirePrefix: boolean;
  canAttach: boolean;
  canPoll: boolean;
}) {
  const t = await getTranslations("forums.new");
  if (!canPost && !guestKey) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          title={t("cannotPostTitle")}
          description={t("cannotPostDescription")}
        />
      </div>
    );
  }
  const viewer = await getViewer();
  const [{ items: prefixItems }, { items: nodes }, preferences, site] =
    await Promise.all([
      read(threadPrefixesList, { nodeId: id }),
      read(nodesList, {}),
      // A member's own; a guest who may post has none.
      viewer.user ? read(preferencesGet, {}) : null,
      getSite(),
    ]);
  const prefixes = activePrefixViews(prefixItems);
  // As the backend applies it: a forum with nothing to choose from asks for nothing.
  const prefixRequired = requirePrefix && prefixes.length > 0;
  if (guestKey)
    return (
      <LazyGuestThreadComposer
        forumId={id}
        prefixes={prefixes}
        requirePrefix={prefixRequired}
        turnstileKey={guestKey}
      />
    );
  const forums = await forumChoices(nodes);
  return (
    <ThreadComposer
      forumId={id}
      forums={forums}
      prefixes={prefixes}
      requirePrefix={prefixRequired}
      canAttach={canAttach}
      canTag={viewer.resolvedPermissions["tag.apply"] === true}
      canPoll={canPoll}
      memberId={viewer.user?.id ?? null}
      watchDefault={preferences?.watchOnCreate}
      adultChoice={site.adultMode}
    />
  );
}
