import { conversationsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadMessageEdit } from "@/app/[locale]/(main)/conversations/[id]/edit/[messageId]/edit-data";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { EditPostForm } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-post-form";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getMember } from "@/lib/sermo/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("conversations.edit");
  return { title: t("metaTitle") };
}

export default async function EditMessagePage({
  params,
}: PageProps<"/[locale]/conversations/[id]/edit/[messageId]">) {
  const { id, messageId: rawMessage } = await params;
  const conversationId = parseId(id);
  const messageId = parseId(rawMessage);
  if (conversationId === null || messageId === null) notFound();
  const [{ resolvedPermissions }, t] = await Promise.all([
    getMember(),
    getTranslations("conversations.edit"),
  ]);
  // The backend gives the source only to someone who may edit the message: anyone else gets a 404.
  const [loaded, conversation] = await Promise.all([
    loadMessageEdit(
      read,
      conversationId,
      messageId,
      resolvedPermissions["conversation.attach"] !== false,
    ),
    read(conversationsGet, { conversationId }),
  ]);
  if (!loaded) notFound();
  const back = conversationHref(conversationId, messageId);

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
          { label: t("conversations"), href: "/conversations" },
          { label: conversation.title, href: back },
        ]}
      />
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {t("heading")}
      </h1>
      <div className="mt-4">
        <EditPostForm
          target={{ kind: "message", conversationId, messageId }}
          back={back}
          {...loaded.fields}
        />
      </div>
    </PageLayout>
  );
}
