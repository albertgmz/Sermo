"use client";

import { type ComponentType, useEffect, useId, useState } from "react";
import type { MemberPickerField } from "@/components/forum/member-picker-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = Parameters<typeof MemberPickerField>[0];

// The member picker for a place that is not the page's own content (the search popup in the
// header). Its code is fetched when the popup draws it, never with a page's first load; until then
// the field is a plain labelled box that sends the name typed in it, which is also all there is
// without JavaScript.
export function LazyMemberPickerField(props: Props) {
  const [Picker, setPicker] = useState<ComponentType<Props> | null>(null);
  const inputId = useId();

  useEffect(() => {
    let current = true;
    import("@/components/forum/member-picker-field").then((module) => {
      if (current) setPicker(() => module.MemberPickerField);
    });
    return () => {
      current = false;
    };
  }, []);

  if (Picker) return <Picker {...props} />;
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{props.label}</Label>
      <Input
        id={inputId}
        type="search"
        name={props.name}
        defaultValue={props.initial}
        placeholder={props.text.placeholder}
        autoComplete="off"
      />
    </div>
  );
}
