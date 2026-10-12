import { MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/forum/empty-state";

export default function ConversationsPage() {
  const t = useTranslations("conversations.conversations");
  return (
    <EmptyState
      icon={MessagesSquare}
      title={t("title")}
      description={t("description")}
      className="hidden h-full justify-center lg:flex"
    />
  );
}
