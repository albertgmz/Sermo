"use client";

import { useId, useRef, useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import { type Choice, IdPicker } from "@/components/forum/id-picker";
import { Label } from "@/components/ui/label";

export async function findMemberChoices(prefix: string): Promise<Choice[]> {
  return (await findRecipients(prefix)).map((user) => ({
    id: user.id,
    label: user.username,
  }));
}

// A chosen member that was not found here (a username from the address) has no id; this one stands
// in for it, and is never offered.
const CARRIED = 0;

export type MemberPickerFieldText = {
  placeholder: string;
  noMatch: string;
  chosen: string;
  // The remove button's name, with `{name}` where the member's name goes.
  remove: string;
};

// One member chosen by name, as a chip, for a filter of a GET form: the username goes under
// `name`, which is what the backend's `author` filters take. Until one is chosen the box itself
// carries `name`, so a name typed in full and not picked still reaches the form. The visible label
// is the box's name; clicking it focuses the box.
export function MemberPickerField({
  name,
  label,
  initial,
  text,
}: {
  name: string;
  label: string;
  initial?: string;
  text: MemberPickerFieldText;
}) {
  const inputId = useId();
  const [ids, setIds] = useState<number[]>(initial ? [CARRIED] : []);
  // The names of the members the searches have found, by id, to know the one the chip stands for.
  const met = useRef(new Map<number, string>());
  if (initial) met.current.set(CARRIED, initial);

  async function search(prefix: string) {
    const found = await findMemberChoices(prefix);
    for (const choice of found) met.current.set(choice.id, choice.label);
    return found;
  }

  const chosen = ids.length > 0 ? met.current.get(ids[0]) : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      {chosen !== undefined && (
        <input type="hidden" name={name} value={chosen} />
      )}
      <IdPicker
        single
        ids={ids}
        known={initial ? [{ id: CARRIED, label: initial }] : []}
        search={search}
        inputId={inputId}
        inputName={name}
        text={{
          chosen: text.chosen,
          placeholder: text.placeholder,
          noMatch: text.noMatch,
          remove: (member) => text.remove.replace("{name}", member),
        }}
        onChange={setIds}
      />
    </div>
  );
}
