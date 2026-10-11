import { Markdown } from "@/components/forum/markdown";
import { SIGNATURE_MAX_LINES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// A member's signature: small, muted and never taller than its line limit.
// A line break in the source is a line break on screen. Headings, links and
// lists are toned down to plain small text and pictures are left out, so a
// signature never reads as part of the post.
export function Signature({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      style={{ maxHeight: `${SIGNATURE_MAX_LINES}lh` }}
      className={cn(
        "overflow-hidden text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Markdown className="text-xs leading-relaxed [&_:is(h3,h4,h5)]:text-xs [&_:is(h3,h4,h5)]:leading-relaxed [&_:is(h3,h4,h5)]:tracking-normal [&_:is(ul,ol)]:space-y-0 [&_a]:font-normal [&_a]:text-muted-foreground [&_a]:hover:text-foreground [&_img]:hidden [&>*+*]:mt-0">
        {children.replace(/\n/g, "  \n")}
      </Markdown>
    </div>
  );
}
