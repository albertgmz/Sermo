import { HtmlContent } from "@/components/forum/html-content";
import { cn } from "@/lib/utils";

// A signature the backend already turned into HTML, drawn small, muted and
// never taller than its line limit. Headings, links and lists are toned down to plain small text
// and a picture is held to three lines of height, so it never reads as part of the post. The site
// decides whether a signature may hold pictures at all; whatever it stored is drawn.
export function SignatureHtml({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-h-[4lh] overflow-hidden text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <HtmlContent
        noLabel
        className="text-xs leading-relaxed [&_:is(h1,h2,h3,h4,h5,h6)]:text-xs [&_:is(h1,h2,h3,h4,h5,h6)]:leading-relaxed [&_:is(h1,h2,h3,h4,h5,h6)]:tracking-normal [&_:is(ul,ol)]:space-y-0 [&_a]:font-normal [&_a]:text-muted-foreground [&_a]:hover:text-foreground [&_img]:max-h-[3lh] [&_img]:w-auto [&_img]:align-text-bottom [&>*+*]:mt-0"
      >
        {children}
      </HtmlContent>
    </div>
  );
}
