import { MessagesSquare } from "lucide-react";
import { iconComponent } from "@/components/icons/icon-set";

export function ForumIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = iconComponent(name) ?? MessagesSquare;
  return <Icon className={className} aria-hidden="true" />;
}
