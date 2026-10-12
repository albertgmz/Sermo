import { HtmlContent } from "@/components/forum/html-content";
import { SIGNATURE_MAX_LINES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// A signature the backend already turned into HTML, drawn like `Signature`: small, muted and
// never taller than its line limit. Headings, links and lists are toned down to plain small text
// and pictures are left out, so it never reads as part of the post.
export function SignatureHtml({
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
      <HtmlContent className="text-xs leading-relaxed [&_:is(h1,h2,h3,h4,h5,h6)]:text-xs [&_:is(h1,h2,h3,h4,h5,h6)]:leading-relaxed [&_:is(h1,h2,h3,h4,h5,h6)]:tracking-normal [&_:is(ul,ol)]:space-y-0 [&_a]:font-normal [&_a]:text-muted-foreground [&_a]:hover:text-foreground [&_img]:hidden [&>*+*]:mt-0">
        {children}
      </HtmlContent>
    </div>
  );
}
