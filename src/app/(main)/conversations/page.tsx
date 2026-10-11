import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/forum/empty-state";

export default function ConversationsPage() {
  return (
    <EmptyState
      icon={MessagesSquare}
      title="Select a conversation"
      description="Choose a conversation from the list or start a new one."
      className="hidden h-full justify-center lg:flex"
    />
  );
}
