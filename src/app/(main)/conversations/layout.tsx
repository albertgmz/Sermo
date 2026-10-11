import { MessagesSquare, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ConversationLink,
  ListPane,
} from "@/app/(main)/conversations/conversation-nav";
import { ConversationPreview } from "@/components/forum/conversation-preview";
import { EmptyState } from "@/components/forum/empty-state";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { getConversations } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Conversations - forum/ui",
};

export default async function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const conversations = await getConversations(user.id);

  return (
    <Container className="px-0 lg:px-4 lg:py-8">
      <div className="lg:flex lg:h-[calc(100dvh-12rem)] lg:min-h-[32rem] lg:overflow-hidden lg:rounded-lg lg:border lg:bg-card">
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
        </ListPane>
        <div className="min-w-0 flex-1 lg:h-full">{children}</div>
      </div>
    </Container>
  );
}
