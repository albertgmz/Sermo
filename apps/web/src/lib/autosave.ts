// The state machine behind a setting that saves on its own. It knows nothing of React or the DOM:
// the component hands it how to read the fields, how to put values back and how to save, and it
// keeps the baseline, the debounce, the one save at a time and the undo window. Pure, so a test
// can drive it with its own clock.

export type Entries = readonly (readonly [string, string])[];

// What a save answers: done, or the message to show beside the setting.
export type SaveResult = { ok: true } | { error: string };

export type SaveState =
  | { phase: "idle" }
  | { phase: "saving" }
  // `undo`: the save emptied a field that had text, and putting it back is on offer.
  | { phase: "saved"; undo: boolean }
  | { phase: "error"; message: string };

export const IDLE: SaveState = { phase: "idle" };

type Timers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

const filled = (entries: Entries) =>
  entries.some(([, value]) => value.trim() !== "");

const same = (a: Entries, b: Entries) =>
  a.length === b.length &&
  a.every(([name, value], index) => {
    const other = b[index];
    return other !== undefined && other[0] === name && other[1] === value;
  });

// A change that took everything out of a setting that had something in it.
export const isCleared = (before: Entries, after: Entries) =>
  filled(before) && !filled(after);

export type Autosave = {
  // The fields were saved (or loaded) as they are: later changes are measured against this.
  baseline: (entries: Entries) => void;
  // A key was pressed: save after a pause.
  edit: () => void;
  // The field was left: save now if anything changed.
  flush: () => Promise<void>;
  // A choice was made: save exactly these entries now.
  saveNow: (entries: Entries) => Promise<void>;
  // A save of another kind (a picture): the same states, one at a time. Answers what the task did.
  perform: (task: () => Promise<SaveResult>) => Promise<SaveResult>;
  // Put back what the last clearing save removed, and save it.
  undo: () => Promise<void>;
  dispose: () => void;
};

export function createAutosave(options: {
  save: (entries: Entries) => Promise<SaveResult>;
  read: () => Entries;
  write: (entries: Entries) => void;
  onState: (state: SaveState) => void;
  delay?: number;
  savedFor?: number;
  undoFor?: number;
  timers?: Timers;
}): Autosave {
  const {
    save,
    read,
    write,
    onState,
    delay = 1000,
    savedFor = 3000,
    undoFor = 6000,
    timers = realTimers,
  } = options;
  let saved: Entries = [];
  let previous: Entries | null = null;
  let busy = false;
  let queued: { entries: () => Entries; force: boolean } | null = null;
  let pause: unknown = null;
  let settle: unknown = null;

  const stop = (id: unknown) => {
    if (id !== null) timers.clear(id);
  };

  // The state after a save answered: shown for a few seconds, longer where an undo is offered.
  function conclude(
    result: SaveResult,
    entries: Entries | null,
    undoable: boolean,
  ) {
    if ("error" in result) {
      onState({ phase: "error", message: result.error });
      return;
    }
    const clearing = undoable && entries !== null && isCleared(saved, entries);
    if (entries) {
      previous = clearing ? saved : null;
      saved = entries;
    }
    onState({ phase: "saved", undo: clearing });
    settle = timers.set(
      () => {
        previous = null;
        onState(IDLE);
      },
      clearing ? undoFor : savedFor,
    );
  }

  async function attempt(task: () => Promise<SaveResult>): Promise<SaveResult> {
    busy = true;
    stop(settle);
    onState({ phase: "saving" });
    try {
      return await task();
    } catch {
      return { error: "" };
    } finally {
      busy = false;
    }
  }

  async function run(entries: Entries, undoable: boolean) {
    conclude(await attempt(() => save(entries)), entries, undoable);
    const next = queued;
    queued = null;
    if (next) await request(next.entries, next.force);
  }

  async function request(entries: () => Entries, force: boolean) {
    if (busy) {
      queued = { entries, force };
      return;
    }
    const now = entries();
    if (!force && same(now, saved)) return;
    await run(now, !force);
  }

  return {
    baseline(entries) {
      saved = entries;
    },
    edit() {
      stop(pause);
      pause = timers.set(() => {
        pause = null;
        void request(read, false);
      }, delay);
    },
    async flush() {
      stop(pause);
      pause = null;
      await request(read, false);
    },
    async saveNow(entries) {
      stop(pause);
      pause = null;
      await request(() => entries, true);
    },
    async perform(task) {
      if (busy) return { error: "" };
      const result = await attempt(task);
      conclude(result, null, false);
      return result;
    },
    async undo() {
      const back = previous;
      if (!back) return;
      previous = null;
      write(back);
      await request(() => back, true);
    },
    dispose() {
      stop(pause);
      stop(settle);
    },
  };
}
