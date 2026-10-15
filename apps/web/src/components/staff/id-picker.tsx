"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export type Choice = { id: number; label: string };

const TYPING_PAUSE_MS = 250;

// The search of a picker with no list: members, found by the start of their username.
export type Search = (prefix: string) => Promise<Choice[]>;

// IdPicker: chooses one id or several, by name. Chosen ones are chips with a remove button; the
// rest are found either in `options` (filtered as the visitor types) or through `search` (asked
// after a short pause). The caller keeps the ids; the picker only remembers the names it has met.
//
// Props
//   ids       The ids chosen, in order.
//   known     Names of ids that may be chosen already (an id with none shows as `#id`).
//   options   The whole list to choose from, when it is short enough to hold.
//   search    Looks names up when there is no list.
//   single    One id at most: choosing replaces it, and the search hides while one is chosen.
//   label     Names the chosen list and the search field.
//   onChange  Told the new ids.
export function IdPicker({
  ids,
  known,
  options,
  search,
  single = false,
  label,
  onChange,
}: {
  ids: readonly number[];
  known: readonly Choice[];
  options?: readonly Choice[];
  search?: Search;
  single?: boolean;
  label: string;
  onChange: (ids: number[]) => void;
}) {
  const t = useTranslations("admin.ruleBuilder.picker");
  const [names, setNames] = useState(
    () => new Map(known.map((choice) => [choice.id, choice.label])),
  );
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Choice[] | null>(null);

  useEffect(() => {
    const prefix = query.trim();
    if (!search || !prefix) {
      setFound(null);
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const items = await search(prefix);
        if (current) setFound(items);
      } catch {
        if (current) setFound([]);
      }
    }, TYPING_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  const name = (id: number) => names.get(id) ?? `#${id}`;
  const typed = query.trim().toLowerCase();
  const pool = options
    ? options.filter((choice) => choice.label.toLowerCase().includes(typed))
    : (found ?? []);
  const shown = pool.filter((choice) => !ids.includes(choice.id));
  const searched = options !== undefined || found !== null;
  const full = single && ids.length > 0;

  function choose(choice: Choice) {
    setNames((now) => new Map(now).set(choice.id, choice.label));
    onChange(single ? [choice.id] : [...ids, choice.id]);
    setQuery("");
    setFound(null);
  }

  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <ul aria-label={label} className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li
              key={id}
              className="inline-flex h-10 items-center rounded-md border bg-muted/40 pl-3 text-sm"
            >
              <span className="max-w-40 truncate">{name(id)}</span>
              <button
                type="button"
                aria-label={t("remove", { name: name(id) })}
                onClick={() => onChange(ids.filter((entry) => entry !== id))}
                className="flex size-10 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <>
          <Input
            type="search"
            value={query}
            autoComplete="off"
            placeholder={t("placeholder")}
            aria-label={`${label}: ${t("search")}`}
            onChange={(event) => {
              setQuery(event.target.value);
              // Results found for an earlier prefix are not what the new one shows.
              setFound(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (typed !== "" && shown[0]) choose(shown[0]);
            }}
            className="h-10 md:h-8"
          />
          {searched &&
            (shown.length > 0 ? (
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border bg-card">
                {shown.map((choice) => (
                  <li key={choice.id}>
                    <button
                      type="button"
                      onClick={() => choose(choice)}
                      className="flex min-h-10 w-full items-center px-3 text-left text-sm [overflow-wrap:anywhere] hover:bg-muted/50"
                    >
                      {choice.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {t("noMatch")}
              </p>
            ))}
        </>
      )}
    </div>
  );
}
