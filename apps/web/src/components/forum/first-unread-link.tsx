import { ArrowDownToLine } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { messageActionClass } from "@/components/forum/message-action";
import { cn } from "@/lib/utils";

// The count of posts the viewer has not read in a thread, as a link to the first of them. The
// backend caps the count at 99; past it the figure reads "99+".
export function FirstUnreadLink({
  href,
  count,
  more,
  className,
}: {
  href: string;
  count: number;
  more: boolean;
  className?: string;
}) {
  const t = useTranslations("forum.firstUnreadLink");
  const format = useFormatter();
  const value = `${format.number(count, { useGrouping: false })}${more ? "+" : ""}`;
  return (
    <Link
      href={href}
      aria-label={t("aria.label", { count, value })}
      className={cn(
        messageActionClass,
        "bg-primary/10 text-primary-ink hover:text-primary-ink",
        className,
      )}
    >
      <ArrowDownToLine aria-hidden="true" />
      {t("count", { value })}
    </Link>
  );
}
