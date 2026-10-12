import { MessagesSquare, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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

export const metadata: Metadata = {
  title: "Conversations - forum/ui",
};

export default function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Container className="px-0 lg:px-4 lg:py-8">
      <div className="lg:flex lg:h-[calc(100dvh-12rem)] lg:min-h-[32rem] lg:overflow-hidden lg:rounded-lg lg:border lg:bg-card">
        <Suspense
          fallback={
            <div className="hidden min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0 lg:border-r">
              <LoadingRegion label="Loading conversation list…">
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
                Conversations
              </h1>
              <Link
                href="/conversations/new"
                className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
              >
                <Plus />
                New conversation
              </Link>
            </header>
            <Suspense
              fallback={
                <LoadingRegion label="Loading conversations…">
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

  return (
    <>
      {conversations.length ? (
        <ul className="divide-y lg:flex-1 lg:overflow-y-auto">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <ConversationLink id={conversation.id}>
                <ConversationPreview
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
          title="No conversations yet"
          description="Start one to talk privately with other members."
        />
      )}
    </>
  );
}
