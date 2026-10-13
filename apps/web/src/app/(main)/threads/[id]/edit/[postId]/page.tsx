import {
  postsGet,
  threadPrefixesList,
  threadsGet,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EditPostForm } from "@/app/(main)/threads/[id]/edit/[postId]/edit-post-form";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { threadMay } from "@/app/(main)/threads/[id]/permissions";
import { fileName } from "@/app/(main)/threads/[id]/post-attachments";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { parseId, parsePageId } from "@/lib/sermo/ids";
import { getMember } from "@/lib/sermo/session";
import { prefixChoices, prefixView } from "@/lib/sermo/threads";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("threads.edit");
  return { title: t("metaTitle") };
}

export default async function EditPostPage({
  params,
}: PageProps<"/threads/[id]/edit/[postId]">) {
  const { id, postId: rawPost } = await params;
  const threadId = parsePageId(id);
  const postId = parseId(rawPost);
  if (threadId === null || postId === null) notFound();
  const [{ user }, t] = await Promise.all([
    getMember(),
    getTranslations("threads.edit"),
  ]);
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/threads/${threadId}/edit/${postId}`)}`,
    );
  }
  const [post, found] = await Promise.all([
    read(postsGet, { postId }),
    read(threadsGet, { threadId, countView: false }),
  ]);
  if (post.threadId !== threadId) notFound();
  const { thread, node, permissions, resolvedPermissions } = found;
  const back = threadHref(threadId, post.position, post.id);
  const opening = post.id === thread.firstPostId && permissions.canEditTitle;
  const prefixes = opening
    ? (await read(threadPrefixesList, {})).items.flatMap((prefix) =>
        prefix.isActive ? (prefixView(prefix) ?? []) : [],
      )
    : [];

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
          { label: node.title, href: `/forums/${node.id}` },
          { label: thread.title, href: back },
        ]}
      />
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {t("heading")}
      </h1>
      <div className="mt-4">
        {post.canEdit ? (
          <EditPostForm
            threadId={threadId}
            postId={postId}
            source={post.bodySource}
            back={back}
            attachIn={threadMay(resolvedPermissions).attach ? node.id : null}
            attached={post.attachments.map((file) => ({
              id: file.fileId,
              name: fileName(file.url, file.fileId),
              size: file.byteSize,
            }))}
            thread={
              opening
                ? {
                    title: thread.title,
                    prefixId: thread.prefix ? String(thread.prefix.id) : "",
                    prefixes: prefixChoices(prefixes, thread.prefix, (label) =>
                      t("inactivePrefix", { label }),
                    ),
                  }
                : null
            }
          />
        ) : (
          <div className="rounded-lg border bg-card">
            <EmptyState
              title={t("cannotTitle")}
              description={t("cannotDescription")}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
