import {
  BookOpen,
  CircleCheck,
  CircleHelp,
  type LucideIcon,
  Newspaper,
  Scale,
  ShoppingCart,
  Sparkles,
  Tag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Prefix } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  "circle-check": CircleCheck,
  "circle-help": CircleHelp,
  newspaper: Newspaper,
  scale: Scale,
  "shopping-cart": ShoppingCart,
  sparkles: Sparkles,
  tag: Tag,
};

const COLORS: Record<string, string> = {
  sky: "border-prefix-sky/30 bg-prefix-sky/10 text-prefix-sky",
  emerald: "border-prefix-emerald/30 bg-prefix-emerald/10 text-prefix-emerald",
  orange: "border-prefix-orange/30 bg-prefix-orange/10 text-prefix-orange",
  violet: "border-prefix-violet/30 bg-prefix-violet/10 text-prefix-violet",
  amber: "border-prefix-amber/30 bg-prefix-amber/10 text-prefix-amber",
  cyan: "border-prefix-cyan/30 bg-prefix-cyan/10 text-prefix-cyan",
  rose: "border-prefix-rose/30 bg-prefix-rose/10 text-prefix-rose",
  lime: "border-prefix-lime/30 bg-prefix-lime/10 text-prefix-lime",
};

export function PrefixTag({
  prefix,
  icon = true,
  className,
}: {
  prefix: Pick<Prefix, "label" | "color" | "icon">;
  icon?: boolean;
  className?: string;
}) {
  const Icon = icon ? ICONS[prefix.icon] : undefined;
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-[1.125rem] gap-1 px-1.5 text-[0.6875rem] font-semibold",
        COLORS[prefix.color] ?? "text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" />}
      {prefix.label}
    </Badge>
  );
}
