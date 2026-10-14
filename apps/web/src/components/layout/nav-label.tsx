import { entryIcon, type NavItem } from "@/components/layout/nav";

// An entry's title with its icon on the side the entry asks for. `withDefault` also draws the icon
// a built-in entry has by default (the account menu); elsewhere only an icon the entry has itself.
// The parent lays its children out in a row with a gap.
export function NavLabel({
  item,
  withDefault = false,
  className = "size-4 shrink-0",
}: {
  item: Pick<NavItem, "title" | "icon" | "iconPosition" | "builtin">;
  withDefault?: boolean;
  className?: string;
}) {
  const Icon = entryIcon(item, withDefault);
  const icon = Icon && <Icon className={className} aria-hidden="true" />;
  return (
    <>
      {item.iconPosition === "before" && icon}
      {item.title}
      {item.iconPosition === "after" && icon}
    </>
  );
}
