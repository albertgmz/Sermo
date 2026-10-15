import { HtmlContent } from "@/components/forum/html-content";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { type LinkUser, UserLink } from "@/components/forum/user-link";
import { cn } from "@/lib/utils";

export function MessageRow({
  id,
  author,
  badge,
  context,
  time,
  actions,
  footer,
  compact = false,
  className,
  children,
}: {
  id?: string;
  author: AvatarUser & LinkUser;
  badge?: React.ReactNode;
  context?: React.ReactNode;
  time: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className={cn(
        "flex scroll-mt-4",
        compact ? "gap-2" : "gap-3 px-4 pt-4",
        !compact && (actions && !footer ? "pb-2" : "pb-4"),
        className,
      )}
    >
      <UserAvatar
        user={author}
        size={compact ? "sm" : "lg"}
        className={
          compact ? "relative after:absolute after:-inset-2" : undefined
        }
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-muted-foreground [overflow-wrap:anywhere]",
            compact ? "text-xs leading-6" : "text-sm",
          )}
        >
          <UserLink user={author} />
          {badge && <> {badge}</>}
          {context && (
            <>
              <span aria-hidden="true"> · </span>
              {context}
            </>
          )}{" "}
          <span className="text-xs whitespace-nowrap">
            <span aria-hidden="true">· </span>
            {time}
          </span>
        </p>
        <div className={compact ? undefined : "mt-1"}>{children}</div>
        {actions}
        {footer}
      </div>
    </article>
  );
}

// The body of a row: HTML the backend rendered from its BB code. A long one is cut short when
// `clamp` is set.
export function MessageBody({
  children,
  clamp = false,
  className,
}: {
  children: string;
  clamp?: boolean;
  className?: string;
}) {
  const text = children.replace(/<[^>]*>/g, " ");
  const blocks = children.match(/<\/(?:p|li|h\d|blockquote)>|<br>/g) ?? [];
  const long = clamp && (text.length > 280 || blocks.length > 6);
  return (
    <HtmlContent
      className={cn(
        long &&
          "max-h-28 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
        className,
      )}
    >
      {children}
    </HtmlContent>
  );
}

export { messageActionClass } from "@/components/forum/message-action";
