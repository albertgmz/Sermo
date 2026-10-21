import { HtmlContent } from "@/components/forum/html-content";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { type LinkUser, UserLink } from "@/components/forum/user-link";
import { cn } from "@/lib/utils";

// A wall post: the author's avatar on the left, then the header (`name · time`), the body, the
// actions and what follows them (the block of comments). Below `md` the avatar is small and starts
// the header line instead, so the body and the comments span the row, as XenForo draws a profile
// post on a phone. One grid places the same avatar both ways.
export function MessageRow({
  id,
  author,
  badge,
  context,
  time,
  actions,
  footer,
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
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className={cn(
        "grid scroll-mt-landing-gap grid-cols-[auto_minmax(0,1fr)] gap-x-2 px-4 pt-4 md:gap-x-3",
        actions && !footer ? "pb-2" : "pb-4",
        className,
      )}
    >
      <UserAvatar
        user={author}
        size="sm-lg"
        className="self-start md:row-span-2"
      />
      <p className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere] md:leading-5">
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
      <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2">
        <div className="mt-1">{children}</div>
        {actions}
        {footer}
      </div>
    </article>
  );
}

// The body of a row: HTML the backend rendered from its BB code (and sanitised: it is drawn as it
// is, so only such HTML may be given). A long one is cut short when
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
  const blocks =
    children.match(/<\/(?:p|li|h\d|blockquote)>|<br\s*\/?>/g) ?? [];
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
