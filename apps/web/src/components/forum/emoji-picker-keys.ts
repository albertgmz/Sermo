// The keys of the emoji picker (`emoji-picker.tsx`), run as the picker's own native listener: the
// composer is a form, so Enter in the search box would send it, and the dialog the composer may be
// in listens for Escape on the document. Both stop at the picker.

// Where a key was pressed: the search box (empty or not), an option (with its place among them), or elsewhere in
// the picker (its buttons and select keep their own keys).
export type KeyPlace =
  | { in: "search"; empty: boolean }
  | { in: "option"; index: number; count: number; columns: number }
  | { in: "other" };

// `stay`: the key stops at the picker and does nothing more.
export type KeyAction =
  | { do: "stay" }
  | { do: "close" }
  | { do: "pickFirst" }
  | { do: "focus"; index: number };

// The next option the arrow keys reach from `index` of `count`, in rows of `columns`; null for a
// key that does not move.
export function nextOption(
  key: string,
  index: number,
  count: number,
  columns: number,
) {
  const moves: Record<string, number> = {
    ArrowRight: index + 1,
    ArrowLeft: index - 1,
    ArrowDown: index + columns,
    ArrowUp: index - columns,
    Home: 0,
    End: count - 1,
  };
  const next = moves[key];
  if (next === undefined) return null;
  return Math.min(Math.max(next, 0), count - 1);
}

// What a key does: Escape closes the picker (back in the text); in the search box Enter picks the
// first result (with nothing searched, nothing: it is no result), never sending the form, and the
// down arrow goes to the options; on an option the arrows, Home and End move. Null leaves the key
// alone.
export function pickerKey(key: string, place: KeyPlace): KeyAction | null {
  if (key === "Escape") return { do: "close" };
  if (place.in === "search") {
    if (key === "Enter") return { do: place.empty ? "stay" : "pickFirst" };
    if (key === "ArrowDown") return { do: "focus", index: 0 };
    return null;
  }
  if (place.in !== "option") return null;
  const index = nextOption(key, place.index, place.count, place.columns);
  return index === null ? null : { do: "focus", index };
}

// Listens on the picker's element: a key it acts on stops there (`placeOf` says where it was
// pressed, `act` does it). A key that ends or cancels an input method's composition is the input
// method's (Firefox marks it `isComposing`, Safari gives it keyCode 229).
export function registerPickerKeys(
  picker: EventTarget,
  placeOf: (event: KeyboardEvent) => KeyPlace,
  act: (action: KeyAction) => void,
) {
  const listener = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.isComposing || key.keyCode === 229) return;
    const action = pickerKey(key.key, placeOf(key));
    if (!action) return;
    key.preventDefault();
    key.stopPropagation();
    if (action.do !== "stay") act(action);
  };
  picker.addEventListener("keydown", listener);
  return () => picker.removeEventListener("keydown", listener);
}
