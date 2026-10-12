import { HtmlContent } from "@/components/forum/html-content";
import { MarkdownContent } from "@/components/forum/markdown-content";
import { SIGNATURE_MAX_LINES } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const boxClass =
  "overflow-hidden text-xs leading-relaxed text-muted-foreground";

// Headings, links and lists are toned down to plain small text and pictures are left out, so a
// signature never reads as part of the post.
const toneClass =
  "text-xs leading-relaxed [&_:is(h1,h2,h3,h4,h5,h6)]:text-xs [&_:is(h1,h2,h3,h4,h5,h6)]:leading-relaxed [&_:is(h1,h2,h3,h4,h5,h6)]:tracking-normal [&_:is(ul,ol)]:space-y-0 [&_a]:font-normal [&_a]:text-muted-foreground [&_a]:hover:text-foreground [&_img]:hidden [&>*+*]:mt-0";

// A member's signature: small, muted and never taller than its line limit.
// A line break in the source is a line break on screen.
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
      className={cn(boxClass, className)}
    >
      <MarkdownContent skipImages className={toneClass}>
        {children.replace(/\n/g, "  \n")}
      </MarkdownContent>
    </div>
  );
}

// The same for a signature the backend already turned into HTML.
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
      className={cn(boxClass, className)}
    >
      <HtmlContent className={toneClass}>{children}</HtmlContent>
    </div>
  );
}
