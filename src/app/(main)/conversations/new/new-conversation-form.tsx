"use client";

import { useActionState, useState } from "react";
import { startConversation } from "@/app/(main)/conversations/actions";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { User } from "@/lib/types";

function check(data: FormData) {
  if (!data.getAll("to").length) return "Choose at least one recipient.";
  if (!String(data.get("body") ?? "").trim()) return "Write a message.";
  return "";
}

export function NewConversationForm({
  users,
  preselected,
}: {
  users: (Pick<User, "id" | "username"> & { avatar: React.ReactNode })[];
  preselected?: number;
}) {
  const [serverError, action, pending] = useActionState(startConversation, "");
  const [clientError, setClientError] = useState("");
  const error = clientError || serverError;

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const message = check(new FormData(event.currentTarget));
        setClientError(message);
        if (message) event.preventDefault();
      }}
      className="space-y-5"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Recipients</legend>
        <ul className="grid gap-x-4 sm:grid-cols-2">
          {users.map((user) => (
            <li key={user.id}>
              <Label
                htmlFor={`to-${user.id}`}
                className="min-h-10 cursor-pointer font-normal"
              >
                <Checkbox
                  id={`to-${user.id}`}
                  name="to"
                  value={String(user.id)}
                  defaultChecked={user.id === preselected}
                />
                {user.avatar}
                <span className="truncate">{user.username}</span>
              </Label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="conversation-title">Title</Label>
        <Input
          id="conversation-title"
          name="title"
          required
          maxLength={100}
          placeholder="What is it about?"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm leading-none font-medium">Message</p>
        <Editor name="body" placeholder="Write your message..." />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-10 px-4 md:h-8">
        Start conversation
      </Button>
    </form>
  );
}
