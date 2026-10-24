import type { nodesList, threadPrefixesList } from "@sermo/core/contracts";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { MemberField } from "@/components/forum/member-field";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectFieldLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Filters } from "./filters";

type Node = z.output<typeof nodesList.output>["items"][number];
type Prefix = z.output<typeof threadPrefixesList.output>["items"][number];

const ANY = "";

const selectTriggerClass =
  "w-full data-[size=default]:h-10 md:data-[size=default]:h-8";
const selectItemClass = "min-h-10 md:min-h-8";

export function SearchForm({
  filters,
  nodes,
  prefixes,
}: {
  filters: Filters;
  nodes: Node[];
  prefixes: Prefix[];
}) {
  const t = useTranslations("search.search");
  const { query, author, titlesOnly, forum, prefix } = filters;
  return (
    <search>
      <form
        key={[query, author, titlesOnly, forum, prefix].join("|")}
        action="/search"
        className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3"
      >
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="search-query">{t("keywordsLabel")}</Label>
          <Input
            id="search-query"
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("keywordsPlaceholder")}
            aria-describedby="search-hint"
          />
          <p id="search-hint" className="text-xs text-muted-foreground">
            {t("hint")}
          </p>
        </div>
        <MemberField
          name="author"
          label={t("authorLabel")}
          initial={author || undefined}
        />
        <div className="space-y-2">
          <Select
            name="forum"
            items={[
              { value: ANY, label: t("allForums") },
              ...nodes.map((node) => ({
                value: String(node.id),
                label: node.title,
              })),
            ]}
            defaultValue={forum === undefined ? ANY : String(forum)}
          >
            <SelectFieldLabel>{t("forumLabel")}</SelectFieldLabel>
            <SelectTrigger className={selectTriggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY} className={selectItemClass}>
                {t("allForums")}
              </SelectItem>
              {nodes.map((node) => (
                <SelectItem
                  key={node.id}
                  value={String(node.id)}
                  className={selectItemClass}
                >
                  <span style={{ paddingInlineStart: `${node.depth}rem` }}>
                    {node.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Select
            name="prefix"
            items={[
              { value: ANY, label: t("anyPrefix") },
              ...prefixes.map((entry) => ({
                value: String(entry.id),
                label: entry.label,
              })),
            ]}
            defaultValue={prefix === undefined ? ANY : String(prefix)}
          >
            <SelectFieldLabel>{t("prefixLabel")}</SelectFieldLabel>
            <SelectTrigger className={selectTriggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY} className={selectItemClass}>
                {t("anyPrefix")}
              </SelectItem>
              {prefixes.map((entry) => (
                <SelectItem
                  key={entry.id}
                  value={String(entry.id)}
                  label={entry.label}
                  className={selectItemClass}
                >
                  <PrefixTag prefix={entry} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
          <div className="flex min-h-10 items-center gap-2 md:min-h-8">
            <Checkbox
              id="search-titles"
              name="titles"
              value="1"
              defaultChecked={titlesOnly}
            />
            <Label htmlFor="search-titles" className="font-normal">
              {t("titlesOnlyLabel")}
            </Label>
          </div>
          <Button type="submit" className="h-10 px-4 md:h-8 md:px-3">
            <Search />
            {t("submit")}
          </Button>
        </div>
      </form>
    </search>
  );
}
