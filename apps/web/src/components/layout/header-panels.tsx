import { Bell, CheckCheck, Inbox, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MarkAllReadForm } from "@/app/(main)/notifications/mark-all-read";
import { HeaderPanel } from "@/components/layout/header-panel";
import { LoadedPanel } from "@/components/layout/loaded-panel";
import {
  loadAlerts,
  loadConversations,
} from "@/components/layout/panel-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const headerIconClass =
  "relative inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-(--spacing-inline-icon)";

const footerClass = "flex items-center justify-between gap-2 border-t p-2";

const footerLinkClass =
  "inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground";

export function MessagesPanel({
  unread,
  className,
}: {
  unread: number;
  className?: string;
}) {
  const t = useTranslations("layout.headerPanels.messages");
  return (
    <LoadedPanel
      label={t("label")}
      title={t("title")}
      unread={unread}
      icon={<Inbox />}
      className={cn(headerIconClass, className)}
      loadingLabel={t("loading")}
      load={loadConversations}
      footer={
        <div className={footerClass}>
          <Link href="/conversations" className={footerLinkClass}>
            {t("viewAll")}
          </Link>
          <Link href="/conversations/new" className={footerLinkClass}>
            {t("new")}
          </Link>
        </div>
      }
    />
  );
}

export function AlertsPanel({
  unread,
  className,
}: {
  unread: number;
  className?: string;
}) {
  const t = useTranslations("layout.headerPanels.alerts");
  return (
    <LoadedPanel
      label={t("label")}
      title={t("title")}
      unread={unread}
      icon={<Bell />}
      className={cn(headerIconClass, className)}
      loadingLabel={t("loading")}
      load={loadAlerts}
      footer={
        <div className={footerClass}>
          <Link href="/notifications" className={footerLinkClass}>
            {t("viewAll")}
          </Link>
          <MarkAllReadForm
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            className="h-8 text-xs text-muted-foreground"
          >
            <CheckCheck />
            {t("markAllRead")}
          </MarkAllReadForm>
        </div>
      }
    />
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
