import Link from "next/link";
import { useTranslations } from "next-intl";
import { tagHref } from "@/lib/sermo/tags";
import { cn } from "@/lib/utils";

// The tags of a thread, each a link to the page that gathers the threads carrying it. Nothing is
// drawn for a thread with none.
export function ThreadTags({
  tags,
  className,
}: {
  tags: readonly string[];
  className?: string;
}) {
  const t = useTranslations("forum.threadTags");
  if (tags.length === 0) return null;
  return (
    <ul
      aria-label={t("list")}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {tags.map((tag) => (
        <li key={tag} className="min-w-0">
          <Link
            href={tagHref(tag)}
            className="inline-flex min-h-10 max-w-full items-center rounded-full border bg-card px-3 md:min-h-8 md:px-2.5 text-xs font-medium text-primary-ink [overflow-wrap:anywhere] hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
