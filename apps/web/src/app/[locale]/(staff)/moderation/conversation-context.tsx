import { useFormatter, useTranslations } from "next-intl";
import { HtmlContent } from "@/components/forum/html-content";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MemberLink } from "../admin/logs/links";

// A conversation message and the ones around it, as an audited read returned them. Rendered on
// the server (the HTML goes through the lite gate), whether the page or an action asks for it.
export type ContextMessage = {
  id: number;
  author: { id: number; username: string };
  bodyHtml: string;
  createdAt: string;
  target: boolean;
};

export function ConversationContext({
  title,
  messages,
}: {
  title: string;
  messages: readonly ContextMessage[];
}) {
  const t = useTranslations("moderation.auditedRead");
  const format = useFormatter();
  return (
    <Section heading={title} description={t("viewDescription")}>
      {messages.length > 0 ? (
        <ol className="divide-y">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "space-y-2 p-4",
                message.target && "border-l-2 border-primary bg-muted/30",
              )}
            >
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <MemberLink
                  id={message.author.id}
                  name={message.author.username}
                />
                <time dateTime={message.createdAt}>
                  {format.dateTime(new Date(message.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
                {message.target && <Badge>{t("target")}</Badge>}
              </p>
              <HtmlContent
                content={{ type: "conversation_message", id: message.id }}
              >
                {message.bodyHtml}
              </HtmlContent>
            </li>
          ))}
        </ol>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </Section>
  );
}
