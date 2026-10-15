import { CheckCheck, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MarkAllReadForm } from "@/app/[locale]/(main)/notifications/mark-all-read";
import { headerIconClass } from "@/components/layout/header-icon-class";
import { HeaderPanel } from "@/components/layout/header-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const footerClass = "flex items-center justify-between gap-2 border-t p-2";

const footerLinkClass =
  "inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground";

// The foot of each list in the avatar menu. Drawn on the server and handed to the menu as elements,
// so the unread count a button reads is the one the page drew.
export function ConversationsFooter() {
  const t = useTranslations("layout.headerPanels.messages");
  return (
    <div className={footerClass}>
      <Link href="/conversations" className={footerLinkClass}>
        {t("viewAll")}
      </Link>
      <Link href="/conversations/new" className={footerLinkClass}>
        {t("new")}
      </Link>
    </div>
  );
}

export function AlertsFooter({ unread }: { unread: number }) {
  const t = useTranslations("layout.headerPanels.alerts");
  return (
    <div className={footerClass}>
      <Link href="/notifications" className={footerLinkClass}>
        {t("viewAll")}
      </Link>
      <MarkAllReadForm
        variant="ghost"
        size="sm"
        unread={unread}
        className="h-8 text-xs text-muted-foreground"
      >
        <CheckCheck />
        {t("markAllRead")}
      </MarkAllReadForm>
    </div>
  );
}

export function BookmarksFooter() {
  const t = useTranslations("layout.userMenu.bookmarks");
  return (
    <div className={footerClass}>
      <Link href="/account/bookmarks" className={footerLinkClass}>
        {t("viewAll")}
      </Link>
    </div>
  );
}

export function SearchPanel({ className }: { className?: string }) {
  const t = useTranslations("layout.headerPanels.search");
  return (
    <HeaderPanel
      label={t("label")}
      title={t("title")}
      icon={<Search />}
      className={cn(headerIconClass, className)}
    >
      <search>
        <form action="/search">
          <div className="space-y-3 p-4">
            <Input
              type="search"
              name="q"
              placeholder={t("placeholder")}
              aria-label={t("aria.search")}
            />
            <div className="flex items-center gap-2">
              <Checkbox id="header-search-titles" name="titles" value="1" />
              <Label htmlFor="header-search-titles" className="font-normal">
                {t("titlesOnly")}
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="header-search-author">{t("byAuthor")}</Label>
              <Input
                id="header-search-author"
                name="author"
                placeholder={t("exactUsername")}
                autoComplete="off"
              />
            </div>
          </div>
          <div className={footerClass}>
            <Link href="/search" className={footerLinkClass}>
              {t("advanced")}
            </Link>
            <Button type="submit">
              <Search />
              {t("submit")}
            </Button>
          </div>
        </form>
      </search>
    </HeaderPanel>
  );
}
