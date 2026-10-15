"use client";

import { useId } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type LazyTooltipPopupProps = {
  label: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

// The real tooltip, which Base UI draws. Loaded by `LazyTooltip` when the pointer first comes over
// a trigger, and mounted open on it.
export default function LazyTooltipPopup({
  label,
  className,
  style,
  children,
}: LazyTooltipPopupProps) {
  const id = useId();
  return (
    <Tooltip defaultOpen defaultTriggerId={id}>
      <TooltipTrigger
        id={id}
        render={
          <span
            role="img"
            aria-label={label}
            className={className}
            style={style}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
