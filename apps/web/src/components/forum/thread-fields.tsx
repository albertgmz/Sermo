"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { PrefixTag } from "@/components/forum/prefix-tag";
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

const NO_PREFIX = "";

// The prefix and the title of a thread, for the form that starts one and the one that edits its
// opening post.
export function ThreadFields({
  prefixes,
  prefixId,
  title,
  placeholder,
  mustHavePrefix = false,
}: {
  prefixes: PrefixView[];
  // The thread has one that its forum does not let its author take off: no "No prefix" choice.
  mustHavePrefix?: boolean;
  prefixId?: string;
  title?: string;
  placeholder?: string;
}) {
  const t = useTranslations("forum.threadFields");
  const ids = useId();
  const options = [
    ...(mustHavePrefix ? [] : [{ value: NO_PREFIX, label: t("noPrefix") }]),
    ...prefixes.map((prefix) => ({
      value: String(prefix.id),
      label: prefix.label,
    })),
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="space-y-2">
        <Label id={`${ids}-prefix`}>{t("prefixLabel")}</Label>
        <Select
          key={prefixId}
          name="prefixId"
          items={options}
          defaultValue={prefixId ?? NO_PREFIX}
        >
          <SelectTrigger
            aria-labelledby={`${ids}-prefix`}
            className="w-full data-[size=default]:h-10 md:data-[size=default]:h-8"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!mustHavePrefix && (
              <SelectItem value={NO_PREFIX} className="min-h-10 md:min-h-8">
                {t("noPrefix")}
              </SelectItem>
            )}
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
        <Label htmlFor={`${ids}-title`}>{t("titleLabel")}</Label>
        <Input
          id={`${ids}-title`}
          name="title"
          defaultValue={title}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
