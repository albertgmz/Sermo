import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { NewConversationForm } from "@/app/(main)/conversations/new/new-conversation-form";
import { EmptyState } from "@/components/forum/empty-state";
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
    <div className="lg:h-full lg:overflow-y-auto">
      <header className="flex min-h-14 items-center gap-1 border-b px-2 py-2 lg:px-4">
        <Link
          href="/conversations"
          aria-label={t("aria.back")}
          className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-sm font-semibold">{t("heading")}</h1>
      </header>
      <div className="max-w-2xl p-4">
        {permissions.canStartConversations ? (
          <NewConversationForm preselected={preselected} />
        ) : (
          <EmptyState
            icon={Lock}
            title={t("cannotStartTitle")}
            description={t("cannotStartDescription")}
          />
        )}
      </div>
    </div>
  );
}
