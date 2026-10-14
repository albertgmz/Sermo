import {
  conversationsGet,
  conversationsGetMessage,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EditMessageForm } from "@/app/[locale]/(main)/conversations/[id]/edit/[messageId]/edit-message-form";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { fileName } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
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
  const [, t] = await Promise.all([
    getMember(),
    getTranslations("conversations.edit"),
  ]);
  // The backend gives the source only to someone who may edit the message: anyone else gets a 404.
  const [message, conversation] = await Promise.all([
    read(conversationsGetMessage, { messageId }),
    read(conversationsGet, { conversationId }),
  ]);
  if (message.conversationId !== conversationId) notFound();
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
        <EditMessageForm
          conversationId={conversationId}
          messageId={messageId}
          source={message.bodySource}
          back={back}
          attached={message.attachments.map((file) => ({
            id: file.fileId,
            name: fileName(file.url, file.fileId),
            size: file.byteSize,
            type: file.contentType,
          }))}
        />
      </div>
    </PageLayout>
  );
}
