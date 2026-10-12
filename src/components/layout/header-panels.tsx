import { Bell, CheckCheck, Inbox, Search } from "lucide-react";
import Link from "next/link";
import { markAllRead } from "@/app/(main)/notifications/actions";
import { ConversationPreview } from "@/components/forum/conversation-preview";
import { NotificationRow } from "@/components/forum/notification-row";
import { PendingButton } from "@/components/forum/pending-button";
import { HeaderPanel } from "@/components/layout/header-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConversationView, NotificationView } from "@/lib/db";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export const headerIconClass =
  "relative inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-(--spacing-inline-icon)";

const footerClass = "flex items-center justify-between gap-2 border-t p-2";

const footerLinkClass =
  "inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground";

const emptyClass = "px-4 py-8 text-center text-sm text-muted-foreground";

const listClass = "max-h-96 divide-y divide-border overflow-y-auto";

export function MessagesPanel({
  user,
  conversations,
  unread,
  className,
}: {
  user: Pick<User, "id">;
  conversations: ConversationView[];
  unread: number;
  className?: string;
}) {
  return (
    <HeaderPanel
      label="Conversations"
      title="Messages"
      unread={unread}
      icon={<Inbox />}
      className={cn(headerIconClass, className)}
    >
      {conversations.length > 0 ? (
        <ul className={listClass}>
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <div className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
                <ConversationPreview
                  linked
                  conversation={conversation}
                  viewerId={user.id}
                  ringClassName="ring-popover"
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={emptyClass}>No conversations yet</p>
      )}
      <div className={footerClass}>
        <Link href="/conversations" className={footerLinkClass}>
          View all
        </Link>
        <Link href="/conversations/new" className={footerLinkClass}>
          New conversation
        </Link>
      </div>
    </HeaderPanel>
  );
}

export function AlertsPanel({
  notifications,
  unread,
  className,
}: {
  notifications: NotificationView[];
  unread: number;
  className?: string;
}) {
  return (
    <HeaderPanel
      label="Notifications"
      title="Alerts"
      unread={unread}
      icon={<Bell />}
      className={cn(headerIconClass, className)}
    >
      {notifications.length > 0 ? (
        <ul className={listClass}>
          {notifications.map((item) => (
            <li key={item.id}>
              <NotificationRow item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={emptyClass}>No new alerts</p>
      )}
      <div className={footerClass}>
        <Link href="/notifications" className={footerLinkClass}>
          View all
        </Link>
        <form action={markAllRead}>
          <PendingButton
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            className="h-8 text-xs text-muted-foreground"
          >
            <CheckCheck />
            Mark all as read
          </PendingButton>
        </form>
      </div>
    </HeaderPanel>
  );
}

export function SearchPanel({ className }: { className?: string }) {
  return (
    <HeaderPanel
      label="Search"
      title="Search"
      icon={<Search />}
      className={cn(headerIconClass, className)}
    >
      <search>
        <form action="/search">
          <div className="space-y-3 p-4">
            <Input
              type="search"
              name="q"
              placeholder="Search..."
              aria-label="Search"
            />
            <div className="flex items-center gap-2">
              <Checkbox id="header-search-titles" name="titles" value="1" />
              <Label htmlFor="header-search-titles" className="font-normal">
                Search titles only
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="header-search-member">By member</Label>
              <Input
                id="header-search-member"
                name="member"
                placeholder="Username"
                autoComplete="off"
              />
            </div>
          </div>
          <div className={footerClass}>
            <Link href="/search" className={footerLinkClass}>
              Advanced search
            </Link>
            <Button type="submit">
              <Search />
              Search
            </Button>
          </div>
        </form>
      </search>
    </HeaderPanel>
  );
}
