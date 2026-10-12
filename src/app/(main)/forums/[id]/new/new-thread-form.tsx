"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createThreadAction } from "@/app/(main)/forums/actions";
import { Editor } from "@/components/forum/editor";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Prefix } from "@/lib/types";
import { cn } from "@/lib/utils";

const NO_PREFIX = { value: "", label: "No prefix" };

export function NewThreadForm({
  id,
  prefixes,
}: {
  id: number;
  prefixes: Prefix[];
}) {
  const [state, action, pending] = useActionState(
    createThreadAction.bind(null, id),
    {},
  );
  const options = [
    NO_PREFIX,
    ...prefixes.map((prefix) => ({
      value: String(prefix.id),
      label: prefix.label,
    })),
  ];
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label id="thread-prefix-label">Prefix</Label>
          <Select
            key={state.prefixId}
            name="prefixId"
            items={options}
            defaultValue={state.prefixId ?? NO_PREFIX.value}
          >
            <SelectTrigger
              aria-labelledby="thread-prefix-label"
              className="w-full data-[size=default]:h-10 md:data-[size=default]:h-8"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value={NO_PREFIX.value}
                className="min-h-10 md:min-h-8"
              >
                {NO_PREFIX.label}
              </SelectItem>
              {prefixes.map((prefix) => (
                <SelectItem
                  key={prefix.id}
                  value={String(prefix.id)}
                  label={prefix.label}
                  className="min-h-10 md:min-h-8"
                >
                  <PrefixTag prefix={prefix} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="thread-title">Title</Label>
          <Input
            id="thread-title"
            name="title"
            required
            maxLength={120}
            defaultValue={state.title}
            placeholder="What is this thread about?"
          />
        </div>
      </div>
      <Editor name="body" minHeight={200} />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Link
          href={`/forums/${id}`}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          Cancel
        </Link>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          Post thread
        </Button>
      </div>
    </form>
  );
}
