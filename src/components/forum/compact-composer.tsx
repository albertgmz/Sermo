import { SendHorizontal } from "lucide-react";
import { Editor } from "@/components/forum/editor";
import { PendingButton } from "@/components/forum/pending-button";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { cn } from "@/lib/utils";

export function CompactComposer({
  action,
  placeholder,
  submitLabel,
  user,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  placeholder: string;
  submitLabel: string;
  user?: AvatarUser;
  className?: string;
}) {
  return (
    <form action={action} className={cn("flex items-end gap-2", className)}>
      {user && <UserAvatar user={user} size="lg" className="mr-1 self-start" />}
      <Editor
        compact
        name="body"
        placeholder={placeholder}
        className="flex-1"
      />
      <PendingButton size="icon" aria-label={submitLabel} className="size-10">
        <SendHorizontal />
      </PendingButton>
    </form>
  );
}
