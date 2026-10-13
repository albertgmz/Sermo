import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { NewConversationForm } from "@/app/(main)/conversations/new/new-conversation-form";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageLayout } from "@/components/layout/page-layout";
import { getMember } from "@/lib/sermo/session";

export default async function NewConversationPage({
  searchParams,
}: PageProps<"/conversations/new">) {
  const [{ to }, { permissions }, t] = await Promise.all([
    searchParams,
    getMember(),
    getTranslations("conversations.newConversation"),
  ]);
  // A profile links here with the username of the member to write to.
  const preselected =
    typeof to === "string" && permissions.canStartConversations
      ? (await findRecipients(to)).find(
          (user) => user.username.toLowerCase() === to.toLowerCase(),
        )
      : undefined;

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
          { label: t("conversations"), href: "/conversations" },
        ]}
      />
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {t("heading")}
      </h1>
      <div className="mt-4">
        {permissions.canStartConversations ? (
          <NewConversationForm preselected={preselected} />
        ) : (
          <div className="rounded-lg border bg-card">
            <EmptyState
              icon={Lock}
              title={t("cannotStartTitle")}
              description={t("cannotStartDescription")}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
