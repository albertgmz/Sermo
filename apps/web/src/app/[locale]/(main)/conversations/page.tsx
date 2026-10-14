import { conversationsList } from "@sermo/core/contracts";
import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ConversationRow } from "@/app/[locale]/(main)/conversations/conversation-row";
import { LoadMore } from "@/app/[locale]/(main)/conversations/load-more";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import {
  ConversationListSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

export default async function ConversationsPage() {
  const t = await getTranslations("conversations.list");
  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb items={[{ label: t("home"), href: "/" }]} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <Link
          href="/conversations/new"
          className={cn(buttonVariants(), "h-10 shrink-0 px-3 md:h-8")}
        >
          <Plus />
          {t("newConversation")}
        </Link>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingConversations")}>
              <ConversationListSkeleton />
            </LoadingRegion>
          }
        >
          <ConversationList />
        </Suspense>
      </div>
    </PageLayout>
  );
}

async function ConversationList() {
  const [{ items, nextCursor }, t] = await Promise.all([
    read(conversationsList, {}),
    getTranslations("conversations.list"),
  ]);
  const member = await membersFor(items.map((c) => c.lastMessage.user));

  if (!items.length) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }
  return (
    <ul className="divide-y">
      {items.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          member={member(conversation.lastMessage.user.id)}
        />
      ))}
      {nextCursor && (
        <LoadMore key={nextCursor} cursor={nextCursor} label={t("older")} />
      )}
    </ul>
  );
}
