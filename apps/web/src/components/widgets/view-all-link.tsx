import Link from "next/link";

// The quiet link in the corner of a widget's card that opens the whole list.
export function ViewAllLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground"
    >
      {children}
    </Link>
  );
}
