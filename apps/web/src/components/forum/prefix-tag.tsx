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
import type { PrefixView } from "@/lib/sermo/views";
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

export function PrefixTag({
  prefix,
  icon = true,
  className,
}: {
  prefix: Pick<PrefixView, "label" | "color" | "icon">;
  icon?: boolean;
  className?: string;
}) {
  const Icon = icon ? ICONS[prefix.icon] : undefined;
  return (
    <Badge
      variant="outline"
      style={
        {
          "--prefix-color": prefix.color,
          "--ink": prefix.color,
        } as React.CSSProperties
      }
      className={cn(
        "h-(--spacing-inline-icon) gap-1 border-(--prefix-color)/30 bg-(--prefix-color)/10 px-1.5 text-(length:--text-caption) font-semibold ink",
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" />}
      {prefix.label}
    </Badge>
  );
}
