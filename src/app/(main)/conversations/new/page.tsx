import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewConversationForm } from "@/app/(main)/conversations/new/new-conversation-form";
import { UserAvatar } from "@/components/forum/user-avatar";
import { getUsers } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export default async function NewConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string | string[] }>;
}) {
  const { to } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const users = (await getUsers()).filter((u) => u.id !== user.id);
  const preselected =
    typeof to === "string"
      ? users.find((u) => u.username.toLowerCase() === to.toLowerCase())
      : undefined;

  return (
    <div className="lg:h-full lg:overflow-y-auto">
      <header className="flex min-h-14 items-center gap-1 border-b px-2 py-2 lg:px-4">
        <Link
          href="/conversations"
          aria-label="Back to conversations"
          className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-sm font-semibold">New conversation</h1>
      </header>
      <div className="max-w-2xl p-4">
        <NewConversationForm
          users={users.map((recipient) => ({
            id: recipient.id,
            username: recipient.username,
            avatar: <UserAvatar user={recipient} size="sm" link={false} />,
          }))}
          preselected={preselected?.id}
        />
      </div>
    </div>
  );
}
