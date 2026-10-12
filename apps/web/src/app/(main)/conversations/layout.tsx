import { MessagesSquare, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  ConversationLink,
  ListPane,
} from "@/app/(main)/conversations/conversation-nav";
import { ConversationPreview } from "@/components/forum/conversation-preview";
import { EmptyState } from "@/components/forum/empty-state";
import {
  ConversationListSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getConversations } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("conversations.layout");
  return {
    title: t("metaTitle"),
  };
}

export default function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("conversations.layout");
  return (
    <Container className="px-0 lg:px-4 lg:py-8">
      <div className="lg:flex lg:h-[calc(100dvh-12rem)] lg:min-h-[32rem] lg:overflow-hidden lg:rounded-lg lg:border lg:bg-card">
        <Suspense
          fallback={
            <div className="hidden min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0 lg:border-r">
              <LoadingRegion label={t("loadingList")}>
                <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4 py-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-8 w-32" />
                </div>
                <ConversationListSkeleton />
              </LoadingRegion>
            </div>
          }
        >
          <ListPane>
            <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4 py-2">
              <h1 className="text-base font-semibold tracking-tight">
                {t("heading")}
              </h1>
              <Link
                href="/conversations/new"
                className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
              >
                <Plus />
                {t("newConversation")}
              </Link>
            </header>
            <Suspense
              fallback={
                <LoadingRegion label={t("loadingConversations")}>
                  <ConversationListSkeleton />
                </LoadingRegion>
              }
            >
              <ConversationList />
            </Suspense>
          </ListPane>
        </Suspense>
        <div className="min-w-0 flex-1 lg:h-full">{children}</div>
      </div>
    </Container>
  );
}

async function ConversationList() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const conversations = await getConversations(user.id);
  const t = await getTranslations("conversations.layout");

  return (
    <>
      {conversations.length ? (
        <ul className="divide-y lg:flex-1 lg:overflow-y-auto">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <ConversationLink id={conversation.id}>
                <ConversationPreview
                  linked
                  conversation={conversation}
                  viewerId={user.id}
                />
              </ConversationLink>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={MessagesSquare}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      )}
    </>
  );
}
