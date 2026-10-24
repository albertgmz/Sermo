"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { PrefixSelect } from "@/components/forum/prefix-select";
import { Label } from "@/components/ui/label";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// How the title row is drawn. `default`: a form's field, as the edit forms draw theirs. `large`:
// the title of a new thread, XenForo's `input--title`: taller, larger text, filled like the editor
// box under it (`EDITOR_BOX`), so it stands out from the card in both themes.
const LOOK = {
  default: {
    frame: "dark:bg-input/30",
    prefix:
      "max-w-[45%] rounded-r-none border-0 border-r bg-muted/60 focus-visible:border-input focus-visible:bg-muted focus-visible:ring-0 dark:bg-input/40",
    input: "h-10 px-2.5 text-base md:h-8 md:text-sm",
  },
  large: {
    frame: "rounded-[9px] bg-muted focus-within:bg-card",
    prefix:
      "h-auto max-w-[45%] self-stretch rounded-r-none border-0 border-r bg-input/40 px-2.5 text-base hover:bg-input/60 focus-visible:border-input focus-visible:bg-input/60 focus-visible:ring-0 md:h-auto md:px-3 md:text-[15px] dark:bg-input/40 dark:hover:bg-input/60",
    input: "h-11 px-3 text-lg md:h-12 md:text-xl",
  },
} as const;

// The title of a thread with its prefix, as XenForo's title row: the prefix menu joined to the
// left of the title box, the box and the button one field. A forum that offers no prefix draws the
// box alone. The caller keeps the prefix (`prefix`, "" for none) and sends it with its form; the
// rest of the props are the title box's own.
export function TitleField({
  prefixes,
  prefix,
  onPrefix,
  none,
  look = "default",
  className,
  ...input
}: {
  prefixes: PrefixView[];
  prefix: string;
  onPrefix: (value: string) => void;
  // The choice of no prefix, first in the menu; null where the thread must keep a prefix.
  none: string | null;
  look?: keyof typeof LOOK;
} & Omit<React.ComponentProps<"input">, "prefix">) {
  const t = useTranslations("forum.threadFields");
  const style = LOOK[look];
  return (
    <div
      className={cn(
        "flex min-w-0 rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        style.frame,
      )}
    >
      {prefixes.length > 0 && (
        <PrefixSelect
          prefixes={prefixes}
          value={prefix}
          none={none}
          label={t("prefixLabel")}
          onChange={onPrefix}
          className={style.prefix}
        />
      )}
      {/* `w-full`: an input's own width (its `size`) would otherwise hold the row, and a grid or
          flex parent with it (the thread's dialog), wider than a phone. */}
      <input
        name="title"
        autoComplete="off"
        className={cn(
          "w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
          style.input,
          className,
        )}
        {...input}
      />
    </div>
  );
}

// The title row of the form that edits the opening post, in place and on its page, and of the one
// that edits the thread, with its label. The prefix goes with the form as `prefixId` ("" for none),
// the title as `title`.
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
      <TitleField
        prefixes={prefixes}
        prefix={prefix}
        onPrefix={setPrefix}
        none={mustHavePrefix ? null : t("noPrefix")}
        id={id}
        defaultValue={title}
        placeholder={placeholder ?? t("titlePlaceholder")}
      />
      <input type="hidden" name="prefixId" value={prefix} />
    </div>
  );
}
