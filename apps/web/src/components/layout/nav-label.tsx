import { iconFor, type NavItem } from "@/components/layout/nav";

// An entry's title with its icon on the side the entry asks for. The icon is the one the server
// drew for the entry (`iconNode`). `withDefault` also draws the icon a built-in entry has by
// default (the account menu); elsewhere only an icon the entry has itself. The parent lays its
// children out in a row with a gap.
export function NavLabel({
  item,
  withDefault = false,
  className = "size-4",
}: {
  item: Pick<NavItem, "title" | "iconNode" | "iconPosition" | "builtin">;
  withDefault?: boolean;
  className?: string;
}) {
  const Default = withDefault && !item.iconNode ? iconFor(item.builtin) : null;
  const icon = item.iconNode ? (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 [&>svg]:size-full ${className}`}
    >
      {item.iconNode}
    </span>
  ) : (
    Default && <Default className={className} aria-hidden="true" />
  );
  return (
    <>
      {item.iconPosition === "before" && icon}
      {item.title}
      {item.iconPosition === "after" && icon}
    </>
  );
}
