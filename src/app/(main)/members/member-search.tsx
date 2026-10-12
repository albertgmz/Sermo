import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Results are shown by the directory view.
export function MemberSearch({
  id,
  query = "",
  sort,
}: {
  id: string;
  query?: string;
  sort?: string;
}) {
  const t = useTranslations("members.memberSearch");
  return (
    <search>
      <form key={query} action="/members" className="flex gap-2">
        <input type="hidden" name="view" value="all" />
        {sort && <input type="hidden" name="sort" value={sort} />}
        <Label htmlFor={id} className="sr-only">
          {t("label")}
        </Label>
        <Input
          id={id}
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t("placeholder")}
          autoComplete="off"
          className="flex-1"
        />
        <Button type="submit" className="h-10 md:h-8">
          <Search aria-hidden="true" />
          {t("submit")}
        </Button>
      </form>
    </search>
  );
}
