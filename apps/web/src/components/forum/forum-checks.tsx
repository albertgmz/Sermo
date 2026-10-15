import { cn } from "@/lib/utils";

export type ForumCheck = { id: number; title: string; depth: number };

// The forums as a list of tick boxes, each under its category and indented by depth, for a form
// that picks several: the ticked ids are submitted under `name`. `extra` adds a control at the end
// of a row (the feed filters put "hide from my feed" there).
export function ForumChecks({
  name,
  forums,
  checked,
  label,
  extra,
  className,
}: {
  name: string;
  forums: ForumCheck[];
  checked: ReadonlySet<number>;
  label: string;
  extra?: (forum: ForumCheck) => React.ReactNode;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "max-h-60 divide-y overflow-y-auto rounded-lg border bg-card",
        className,
      )}
    >
      {forums.map((forum) => (
        <li key={forum.id} className="flex items-center pr-1">
          <label
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 pr-2 text-sm"
            style={{ paddingLeft: `${0.75 + forum.depth * 1.25}rem` }}
          >
            <input
              type="checkbox"
              name={name}
              value={forum.id}
              defaultChecked={checked.has(forum.id)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 truncate">{forum.title}</span>
          </label>
          {extra?.(forum)}
        </li>
      ))}
    </ul>
  );
}
