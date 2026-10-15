"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchForm({ className }: { className?: string }) {
  const t = useTranslations("layout.siteNav");
  return (
    <search className={className}>
      <form action="/search" className="relative">
        <Input
          type="search"
          name="q"
          placeholder={t("placeholder")}
          aria-label={t("aria.search")}
          className="bg-card pr-10 md:pr-8 [&::-webkit-search-cancel-button]:hidden"
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon-xs"
          aria-label={t("aria.submit")}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground md:right-1"
        >
          <Search />
        </Button>
      </form>
    </search>
  );
}
