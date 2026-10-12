import {
  Bitcoin,
  BriefcaseBusiness,
  Brush,
  ChartLine,
  Earth,
  Gamepad2,
  Gift,
  Hand,
  Handshake,
  LayoutTemplate,
  Lightbulb,
  Link2,
  type LucideIcon,
  Megaphone,
  MessageCircleMore,
  MessagesSquare,
  Newspaper,
  Rocket,
  ShoppingCart,
  SquareTerminal,
  Store,
  Wrench,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  bitcoin: Bitcoin,
  "briefcase-business": BriefcaseBusiness,
  brush: Brush,
  "chart-line": ChartLine,
  earth: Earth,
  "gamepad-2": Gamepad2,
  gift: Gift,
  hand: Hand,
  handshake: Handshake,
  "layout-template": LayoutTemplate,
  lightbulb: Lightbulb,
  "link-2": Link2,
  megaphone: Megaphone,
  "message-circle-more": MessageCircleMore,
  newspaper: Newspaper,
  rocket: Rocket,
  "shopping-cart": ShoppingCart,
  "square-terminal": SquareTerminal,
  store: Store,
  wrench: Wrench,
};

export function ForumIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? MessagesSquare;
  return <Icon className={className} aria-hidden="true" />;
}
