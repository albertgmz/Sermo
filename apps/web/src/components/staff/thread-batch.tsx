"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { FormError } from "@/components/forum/form-error";
import { PendingButton } from "@/components/forum/pending-button";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { selectClass } from "@/components/staff/rows";
import {
  BATCH_LIMIT,
  type BatchAction,
  type BatchState,
} from "@/components/staff/thread-batch-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const LABELS = {
  lock: "batchLock",
  unlock: "batchUnlock",
  stick: "batchStick",
  unstick: "batchUnstick",
  feature: "batchFeature",
  unfeature: "batchUnfeature",
  delete: "batchDelete",
  restore: "batchRestore",
  move: "batchMove",
  setPrefix: "batchSetPrefix",
} as const;

type Option = { id: number; label: string };

type Selection = {
  selected: ReadonlySet<number>;
  toggle: (id: number) => void;
};
const SelectionContext = createContext<Selection | null>(null);

// The tick beside a thread of a list that offers batch changes. Outside a `ThreadBatch` (a visitor
// with no staff tools) it draws nothing, so the list's rows need not know who is looking.
export function ThreadTick({ id, title }: { id: number; title: string }) {
  const t = useTranslations("forums.forum");
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <div className="relative z-10 flex shrink-0 items-center">
      <Checkbox
        checked={selection.selected.has(id)}
        onCheckedChange={() => selection.toggle(id)}
        aria-label={t("batchSelect", { title })}
      />
    </div>
  );
}

// A list of threads whose rows can be ticked, and the bar that applies one change to the ticked
// threads. The staff who may do nothing to them get the list without either. `actions` are the
// changes the viewer's permissions in the forum offer; the backend judges each thread again.
export function ThreadBatch({
  action,
  actions,
  forums,
  prefixes,
  children,
}: {
  action: (previous: BatchState, formData: FormData) => Promise<BatchState>;
  actions: BatchAction[];
  forums: Option[];
  prefixes: Option[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const form = useKeptForm(action);
  const clear = useCallback(() => setSelected(new Set()), []);
  // Once the batch went through the ticks are spent.
  useEffect(() => {
    if (form.state.done) clear();
  }, [form.state, clear]);
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (actions.length === 0) return children;
  return (
    <SelectionContext value={{ selected, toggle }}>
      {children}
      {(selected.size > 0 || form.state.summary) && (
        <BatchBar
          form={form}
          actions={actions}
          forums={forums}
          prefixes={prefixes}
          selected={selected}
          clear={clear}
        />
      )}
    </SelectionContext>
  );
}

function BatchBar({
  form: { state, onSubmit },
  actions,
  forums,
  prefixes,
  selected,
  clear,
}: {
  form: ReturnType<typeof useKeptForm>;
  actions: BatchAction[];
  forums: Option[];
  prefixes: Option[];
  selected: ReadonlySet<number>;
  clear: () => void;
}) {
  const t = useTranslations("forums.forum");
  const [chosen, setChosen] = useState<BatchAction | "">("");
  const tooMany = selected.size > BATCH_LIMIT;
  return (
    <form
      onSubmit={onSubmit}
      aria-label={t("batchSelected", { count: selected.size })}
      className="sticky bottom-20 z-20 mt-3 space-y-2 rounded-lg border bg-card p-3 shadow-lg md:bottom-4"
    >
      {selected.size > 0 && (
        <p className="text-sm font-medium">
          {t("batchSelected", { count: selected.size })}
        </p>
      )}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="threadIds" value={id} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="action"
          aria-label={t("batchAction")}
          value={chosen}
          onChange={(event) => setChosen(event.target.value as BatchAction)}
          className={selectClass}
        >
          <option value="">{t("batchChoose")}</option>
          {actions.map((name) => (
            <option key={name} value={name}>
              {t(LABELS[name])}
            </option>
          ))}
        </select>
        {chosen === "move" && (
          <select
            name="forumId"
            aria-label={t("batchForum")}
            defaultValue=""
            required
            className={selectClass}
          >
            <option value="" disabled>
              {t("batchForum")}
            </option>
            {forums.map((forum) => (
              <option key={forum.id} value={forum.id}>
                {forum.label}
              </option>
            ))}
          </select>
        )}
        {chosen === "setPrefix" && (
          <select
            name="prefixId"
            aria-label={t("batchPrefix")}
            defaultValue=""
            className={selectClass}
          >
            <option value="">{t("batchNoPrefix")}</option>
            {prefixes.map((prefix) => (
              <option key={prefix.id} value={prefix.id}>
                {prefix.label}
              </option>
            ))}
          </select>
        )}
        <Input
          name="reason"
          aria-label={t("batchReason")}
          placeholder={t("batchReason")}
          autoComplete="off"
          className="min-w-40 flex-1"
        />
      </div>
      {tooMany && <FormError>{t("batchTooMany")}</FormError>}
      {state.error && <FormError>{state.error}</FormError>}
      {state.summary && selected.size === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.summary}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PendingButton
          variant="outline"
          className="h-10 px-3 aria-disabled:opacity-50"
          disabled={chosen === "" || tooMany || selected.size === 0}
          focusableWhenDisabled
        >
          {t("batchApply")}
        </PendingButton>
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={clear}
        >
          {t("batchClear")}
        </Button>
      </div>
    </form>
  );
}
