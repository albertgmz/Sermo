import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadPostEdit } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import { EditPostForm } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-post-form";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { parseId, parsePageId } from "@/lib/sermo/ids";
import { getMember } from "@/lib/sermo/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("threads.edit");
  return { title: t("metaTitle") };
}

export default async function EditPostPage({
  params,
}: PageProps<"/[locale]/threads/[id]/edit/[postId]">) {
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
  const loaded = await loadPostEdit(read, threadId, postId);
  if (!loaded) notFound();
  const { post, found, fields } = loaded;
  const { thread, node } = found;
  const back = threadHref(threadId, post.position, post.id);

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
            target={{ kind: "post", threadId, postId }}
            back={back}
            {...fields}
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
