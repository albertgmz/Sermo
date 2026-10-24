"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { PrefixSelect } from "@/components/forum/prefix-select";
import { Label } from "@/components/ui/label";
import type { PrefixView } from "@/lib/sermo/views";

// The title of a thread with its prefix, as XenForo's title row: the prefix menu joined to the
// left of the title box, the box and the button one field. For the form that edits the opening
// post, in place and on its page, and the one that edits the thread. The prefix goes with the form
// as `prefixId` ("" for none), the title as `title`.
export function ThreadFields({
  prefixes,
  prefixId = "",
  title,
  placeholder,
  mustHavePrefix = false,
}: {
  prefixes: PrefixView[];
  // The thread has one that its forum does not let its author take off: no "(No prefix)" choice.
  mustHavePrefix?: boolean;
  prefixId?: string;
  title?: string;
  placeholder?: string;
}) {
  const t = useTranslations("forum.threadFields");
  const id = useId();
  const [prefix, setPrefix] = useState(prefixId);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("titleLabel")}</Label>
      <div className="flex min-w-0 rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        {prefixes.length > 0 && (
          <PrefixSelect
            prefixes={prefixes}
            value={prefix}
            none={mustHavePrefix ? null : t("noPrefix")}
            label={t("prefixLabel")}
            onChange={setPrefix}
            className="max-w-[45%] rounded-r-none border-0 border-r bg-muted/60 focus-visible:border-input focus-visible:bg-muted focus-visible:ring-0 dark:bg-input/40"
          />
        )}
        <input
          id={id}
          name="title"
          defaultValue={title}
          placeholder={placeholder ?? t("titlePlaceholder")}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 bg-transparent px-2.5 text-base outline-none placeholder:text-muted-foreground md:h-8 md:text-sm"
        />
      </div>
      <input type="hidden" name="prefixId" value={prefix} />
    </div>
  );
}
