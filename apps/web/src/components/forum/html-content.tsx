import { getTranslations } from "next-intl/server";
import "@/components/forum/member-card-parts";
import { MentionCards } from "@/components/forum/mention-cards";
import { prose } from "@/components/forum/prose";
import {
  type SpoilerContent,
  SpoilerReveal,
} from "@/components/forum/spoiler-reveal";
import type { TaggedAttachment } from "@/lib/attachment-tags";
import { withColorGuard } from "@/lib/color-guard";
import { withEmbedGate } from "@/lib/consent/embed-gate";
import { placeInlineAttachments } from "@/lib/inline-attachments";
import { stripHtmlMedia } from "@/lib/lite-content";
import { getLiteLabel, getLiteOrigin, getLiteState } from "@/lib/lite-mode";
import { withMediaPlayers } from "@/lib/media-links";
import { foldNestedQuotes } from "@/lib/quote-fold";
import { publicUrl } from "@/lib/sermo/config";
import { getSmilies } from "@/lib/sermo/smilies";
import { withSmilies } from "@/lib/smilies";
import { withSpoilerButtons } from "@/lib/spoiler-buttons";
import { cn } from "@/lib/utils";

// The look of the editor's text (`prose`), for the elements of the HTML the backend stored. Each
// rule repeats a class of `prose` on the elements below the root. What BB code adds (alignment, code blocks,
// spoilers, tables, highlighting) is styled in `globals.css` under `.bb-content`.
const elements = cn(
  "[&_h1]:text-xl [&_h1]:leading-snug [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:text-lg [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_:is(h3,h4,h5,h6)]:text-base [&_:is(h3,h4,h5,h6)]:leading-snug [&_:is(h3,h4,h5,h6)]:font-semibold",
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ul]:marker:text-muted-foreground",
  "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ol]:marker:text-muted-foreground",
  "[&_li]:pl-0.5",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_a]:font-medium [&_a]:text-primary-ink [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:no-underline",
  "[&_strong]:font-semibold [&_em]:italic [&_del]:text-muted-foreground [&_del]:line-through",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:block [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-(length:--text-compact) [&_pre]:leading-relaxed [&_pre]:whitespace-pre",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:border-border",
  "[&_img]:h-auto [&_img]:max-w-full",
);

// Renders HTML the backend produced and sanitised. The text is not edited, only its placeholders
// are filled: smilie codes become the site's smilies, LITE mode removes its pictures on the server,
// quotes from the second level fold, `[color=…]` spans go through the colour guard, spoilers become buttons and `[ATTACH]` tags become the item's files. A mention in
// it shows the member's card on hover.
// The words BB code shows (a code block's header, "said:", "Spoiler", a folded quote's hint) are not in the HTML: they are
// CSS variables set here in the visitor's language. A body with spoilers needs the `content` it
// belongs to, to ask for them; without it their buttons are disabled. The `attachments` of the item
// take the place of its `[ATTACH]` tags, drawn through the same LITE gate as the list under the body.
export async function HtmlContent(props: {
  children: string;
  className?: string;
  content?: SpoilerContent;
  attachments?: TaggedAttachment[];
}) {
  const [state, origin, label, t, smilies] = await Promise.all([
    getLiteState(),
    getLiteOrigin(),
    getLiteLabel(),
    getTranslations("forum.bbCode"),
    getSmilies(),
  ]);
  let html = withColorGuard(
    withSpoilerButtons(
      await withEmbedGate(
        stripHtmlMedia(
          withMediaPlayers(
            withSmilies(foldNestedQuotes(props.children), smilies),
            publicUrl(),
          ),
          state,
          origin,
          label,
        ),
      ),
      props.content !== undefined,
    ),
  );
  html = await placeInlineAttachments(html, props.attachments ?? []);
  // The files go to the client only when there is a spoiler that may place one.
  const spoilerFiles = html.includes("data-spoiler=")
    ? props.attachments
    : undefined;
  const body = (
    <div
      className={cn("bb-content", prose.root, elements, props.className)}
      style={
        {
          "--bb-code-label": JSON.stringify(t("codeLabel")),
          "--bb-code-rich-label": JSON.stringify(t("richCodeLabel")),
          "--bb-said": JSON.stringify(t("said")),
          "--bb-quote-show": JSON.stringify(t("showQuote")),
          "--bb-quote-hide": JSON.stringify(t("hideQuote")),
          "--bb-spoiler": JSON.stringify(t("spoiler")),
        } as React.CSSProperties
      }
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the backend sanitises this HTML when the page is saved.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
  return (
    <MentionCards>
      {props.content ? (
        <SpoilerReveal content={props.content} attachments={spoilerFiles}>
          {body}
        </SpoilerReveal>
      ) : (
        body
      )}
    </MentionCards>
  );
}
