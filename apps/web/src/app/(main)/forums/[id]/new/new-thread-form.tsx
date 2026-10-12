"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const NO_PREFIX = { value: "", label: "noPrefix" } as const;

export function NewThreadForm({
  id,
  prefixes,
}: {
  id: number;
  prefixes: PrefixView[];
}) {
  const t = useTranslations("forums.newThreadForm");
  const [state, action, pending] = useActionState(
    createThreadAction.bind(null, id),
    {},
  );
  const options = [
    { ...NO_PREFIX, label: t(NO_PREFIX.label) },
    ...prefixes.map((prefix) => ({
      value: String(prefix.id),
      label: prefix.label,
    })),
  ];
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label id="thread-prefix-label">{t("prefixLabel")}</Label>
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
                {t(NO_PREFIX.label)}
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
          <Label htmlFor="thread-title">{t("titleLabel")}</Label>
          <Input
            id="thread-title"
            name="title"
            defaultValue={state.title}
            placeholder={t("placeholder")}
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
          {t("cancel")}
        </Link>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
