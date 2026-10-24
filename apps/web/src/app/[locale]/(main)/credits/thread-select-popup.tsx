"use client";

import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ThreadSelectProps = {
  threads: { value: string; label: string }[];
  label: string;
  placeholder: string;
  triggerClass: string;
};

// The real select of `ThreadSelect`, with Base UI in it: loaded when the plain button is first
// reached for, and mounted open on it (a key that opened it is replayed on the real button).
export default function ThreadSelectPopup({
  threads,
  label,
  placeholder,
  triggerClass,
  openedBy,
  openKey,
}: ThreadSelectProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <Select name="thread" items={threads} defaultOpen={defaultOpen}>
      <SelectTrigger ref={trigger} aria-label={label} className={triggerClass}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {threads.map((thread) => (
          <SelectItem
            key={thread.value}
            value={thread.value}
            className="min-h-10 md:min-h-8"
          >
            {thread.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
