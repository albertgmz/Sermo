"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import Link from "next/link";
import {
  chosenPrefix,
  menuChoices,
  PrefixFace,
  type PrefixSelectProps,
  prefixButtonName,
  prefixTriggerClass,
} from "@/components/forum/prefix-select";
import { PrefixTag } from "@/components/forum/prefix-tag";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";
import { cn } from "@/lib/utils";

export type PrefixSelectPopupProps = PrefixSelectProps;

// A row of the menu, as XenForo's `.menuPrefix`: the label on its own line, the choice of none in
// muted text, a tick at the end of the chosen one. The label keeps its colour when the row is
// highlighted.
const rowClass =
  "relative flex min-h-10 cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent md:min-h-8";

function Tick() {
  return (
    <Check
      aria-hidden="true"
      className="pointer-events-none absolute right-2 size-4"
    />
  );
}

function Row({
  prefix,
  none,
}: {
  prefix: PrefixSelectProps["prefixes"][number] | null;
  none: string | null;
}) {
  return prefix ? (
    <PrefixTag prefix={prefix} />
  ) : (
    <span className="text-muted-foreground">{none}</span>
  );
}

// The button and the menu of `PrefixSelect`, which Base UI draws. It is loaded when the plain
// button is first reached for and mounts open.
export default function PrefixSelectPopup({
  prefixes,
  value,
  none,
  label,
  onChange,
  hrefs,
  className,
  openedBy,
  openKey,
}: PrefixSelectPopupProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  const prefix = chosenPrefix(prefixes, value);
  const choices = menuChoices(prefixes, none);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={prefixButtonName(label, prefix, none)}
        className={cn(prefixTriggerClass, className)}
      >
        <PrefixFace prefix={prefix} none={none} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={label}
        className="w-auto max-w-[min(20rem,var(--available-width))] min-w-44"
      >
        {hrefs ? (
          choices.map((choice) => (
            <MenuPrimitive.LinkItem
              key={choice.value}
              label={choice.text}
              closeOnClick
              aria-current={choice.value === value ? "true" : undefined}
              className={rowClass}
              render={<Link href={hrefs[choice.value] ?? "#"} scroll={false} />}
            >
              <Row prefix={choice.prefix} none={none} />
              {choice.value === value && <Tick />}
            </MenuPrimitive.LinkItem>
          ))
        ) : (
          <MenuPrimitive.RadioGroup
            value={value}
            onValueChange={(next: string) => onChange?.(next)}
          >
            {choices.map((choice) => (
              <MenuPrimitive.RadioItem
                key={choice.value}
                value={choice.value}
                label={choice.text}
                closeOnClick
                className={rowClass}
              >
                <Row prefix={choice.prefix} none={none} />
                <MenuPrimitive.RadioItemIndicator>
                  <Tick />
                </MenuPrimitive.RadioItemIndicator>
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
