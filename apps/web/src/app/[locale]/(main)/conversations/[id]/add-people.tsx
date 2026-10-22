"use client";

import { UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// The picker and its form come with the first press.
const AddPeopleForm = dynamic(
  () =>
    import("@/app/[locale]/(main)/conversations/[id]/add-people-form").then(
      (module) => module.AddPeopleForm,
    ),
  { loading: () => <Skeleton className="m-4 h-24" /> },
);

// The "Add people" row of the participants card: a button that opens the recipient picker in
// place. Everyone already taking part is left out of the picker; a member who left is not, as
// the backend lets them back in.
export function AddPeople({
  conversationId,
  exclude,
}: {
  conversationId: number;
  exclude: number[];
}) {
  const t = useTranslations("conversations.conversation.addPeople");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="px-4 py-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full px-3"
          onClick={() => setOpen(true)}
        >
          <UserPlus />
          {t("open")}
        </Button>
      </div>
    );
  }
  return (
    <AddPeopleForm
      conversationId={conversationId}
      exclude={exclude}
      onCancel={() => setOpen(false)}
    />
  );
}
