"use client";

import type { ForumOption } from "@/components/forum/forum-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// A choice among the forums the backend lists; the chosen forum's id is submitted under `name`.
export function ForumPickerField({
  name,
  forums,
  labelledBy,
  placeholder,
  defaultValue,
}: {
  name: string;
  forums: ForumOption[];
  labelledBy: string;
  placeholder: string;
  defaultValue?: number;
}) {
  const items = forums.map((forum) => ({
    value: String(forum.id),
    label: forum.title,
  }));
  return (
    <Select
      name={name}
      items={items}
      defaultValue={
        defaultValue === undefined ? undefined : String(defaultValue)
      }
    >
      <SelectTrigger
        aria-labelledby={labelledBy}
        className="w-full data-[size=default]:h-10"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {forums.map((forum) => (
          <SelectItem
            key={forum.id}
            value={String(forum.id)}
            label={forum.title}
            className="min-h-10"
          >
            <span style={{ paddingLeft: `${Math.max(0, forum.depth - 1)}rem` }}>
              {forum.title}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
