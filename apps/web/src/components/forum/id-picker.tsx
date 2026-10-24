"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export type Choice = { id: number; label: string };

// The search of a picker with no list: names found by the start of what was typed.
export type Search = (prefix: string) => Promise<Choice[]>;

const TYPING_PAUSE_MS = 250;

// What a search found, for the prefix it was asked about. A result is used only while the field
// still holds that prefix, so a slow answer can never be offered (or picked) for newer text.
export type Found = { prefix: string; items: Choice[] } | null;

// The answer to a search; one that fails is an answer with nothing in it.
export async function runSearch(
  search: Search,
  prefix: string,
): Promise<Found> {
  try {
    return { prefix, items: await search(prefix) };
  } catch {
    return { prefix, items: [] };
  }
}

// What the picker offers now: the choices matching what was typed that are neither chosen nor
// excluded, whether a list is on show at all, and whether it is settled. A fixed list is always on
// show and settled. A search is settled once it has answered for the current text; until then the
// previous answer's choices that still start with the typed text stay on show (so the list does
// not flicker between keystrokes), but nothing is chosen from an unsettled list by Enter.
export function offered(input: {
  query: string;
  ids: readonly number[];
  exclude?: readonly number[];
  options?: readonly Choice[];
  found: Found;
}) {
  const typed = input.query.trim();
  const lower = typed.toLowerCase();
  const settled = input.options !== undefined || input.found?.prefix === typed;
  let pool: readonly Choice[] = [];
  if (input.options)
    pool = input.options.filter((choice) =>
      choice.label.toLowerCase().includes(lower),
    );
  else if (settled) pool = input.found?.items ?? [];
  else if (typed !== "")
    pool = (input.found?.items ?? []).filter((choice) =>
      choice.label.toLowerCase().startsWith(lower),
    );
  const shown = pool.filter(
    (choice) =>
      !input.ids.includes(choice.id) && !input.exclude?.includes(choice.id),
  );
  return {
    shown,
    settled,
    // An unsettled search shows what it has, and says "No match" only once it has answered.
    listed:
      input.options !== undefined ||
      (typed !== "" && (settled || shown.length > 0)),
  };
}

// The choice Enter makes: the first one offered, but only for text that was typed.
export const enterChoice = (query: string, shown: readonly Choice[]) =>
  query.trim() === "" ? undefined : shown[0];

// The ids with the one at `place` taken out (an id can be there twice; only that chip goes).
export const without = (ids: readonly number[], place: number) =>
  ids.filter((_, at) => at !== place);

// Whether no more can be chosen: one is chosen in single mode, or the limit is reached.
export const isFull = (
  ids: readonly number[],
  single: boolean,
  limit: number,
) => (single ? ids.length > 0 : ids.length >= limit);

// IdPicker: chooses one id or several, by name. Chosen ones are chips with a remove button; the
// rest are found either in `options` (filtered as the visitor types) or through `search` (asked
// after a short pause). The caller keeps the ids; the picker only remembers the names it has met.
// Shared by the member picker of conversations and the administration rule builder.
//
// Props
//   ids       The ids chosen, in order (an id can repeat; each chip removes its own place).
//   known     Names of ids that may already be chosen (an id with none shows as `#id`).
//   options   The whole list to choose from, when it is short enough to hold.
//   search    Looks names up when there is no list.
//   exclude   Ids that are never offered.
//   single    One id at most: choosing replaces it, and the search hides while one is chosen.
//   limit     The most ids that can be chosen (default: no limit).
//   inputId   The search box's id, for a visible `<label htmlFor>` that names it.
//   inputName The search box's field name: what was typed and not chosen goes with the form.
//   text      The words: the chosen list's label, the search field's label (left out when a
//             visible label names it) and placeholder, the line for no match, and the remove
//             button's label for a name.
//   onChange  Told the new ids.
export function IdPicker({
  ids,
  known,
  options,
  search,
  exclude,
  single = false,
  limit = Number.POSITIVE_INFINITY,
  inputId,
  inputName,
  text,
  onChange,
}: {
  ids: readonly number[];
  known: readonly Choice[];
  options?: readonly Choice[];
  search?: Search;
  exclude?: readonly number[];
  single?: boolean;
  limit?: number;
  inputId?: string;
  inputName?: string;
  text: {
    chosen: string;
    search?: string;
    placeholder: string;
    noMatch: string;
    remove: (name: string) => string;
  };
  onChange: (ids: number[]) => void;
}) {
  const [names, setNames] = useState(
    () => new Map(known.map((choice) => [choice.id, choice.label])),
  );
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>(null);

  useEffect(() => {
    const prefix = query.trim();
    if (!search || !prefix) return;
    let current = true;
    const timer = setTimeout(async () => {
      const answer = await runSearch(search, prefix);
      if (current) setFound(answer);
    }, TYPING_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  const name = (id: number) => names.get(id) ?? `#${id}`;
  const { shown, listed, settled } = offered({
    query,
    ids,
    exclude,
    options,
    found,
  });

  function choose(choice: Choice) {
    setNames((now) => new Map(now).set(choice.id, choice.label));
    onChange(single ? [choice.id] : [...ids, choice.id]);
    setQuery("");
    setFound(null);
  }

  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <ul aria-label={text.chosen} className="flex flex-wrap gap-2">
          {ids.map((id, place) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: an id can be chosen twice
              key={`${place}:${id}`}
              className="inline-flex h-10 items-center rounded-md border bg-muted/40 pl-3 text-sm"
            >
              <span className="max-w-40 truncate">{name(id)}</span>
              <button
                type="button"
                aria-label={text.remove(name(id))}
                onClick={() => onChange(without(ids, place))}
                className="flex size-10 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isFull(ids, single, limit) && (
        <>
          <Input
            type="search"
            id={inputId}
            name={inputName}
            value={query}
            autoComplete="off"
            placeholder={text.placeholder}
            aria-label={text.search}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const choice = settled ? enterChoice(query, shown) : undefined;
              // A box that sends its text lets Enter submit the form when nothing is offered.
              if (choice || inputName === undefined) event.preventDefault();
              if (choice) choose(choice);
            }}
            className="h-10 md:h-8"
          />
          {listed &&
            (shown.length > 0 ? (
              <ul className="max-h-60 divide-y overflow-y-auto rounded-md border bg-card">
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
                {text.noMatch}
              </p>
            ))}
        </>
      )}
    </div>
  );
}
