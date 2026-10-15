"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The tags of a thread typed as a line of names: `name="tags"` in the form it sits in. The form's
// action reads them with `tagsFromText`; the backend judges each one. Plugs into the form that
// starts a thread (`ThreadComposer`, below the prefix chips) and into `ThreadTagsEditor`.
export function ThreadTagsField({
  defaultValue = "",
}: {
  defaultValue?: string;
}) {
  const t = useTranslations("forum.threadTags");
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {t("label")}
      </Label>
      <Input
        id={id}
        name="tags"
        defaultValue={defaultValue}
        placeholder={t("placeholder")}
        autoComplete="off"
        autoCapitalize="none"
        aria-describedby={`${id}-help`}
        className="h-10 md:h-8"
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {t("help")}
      </p>
    </div>
  );
}
