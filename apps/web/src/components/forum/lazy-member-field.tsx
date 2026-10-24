import { LazyMemberPickerField } from "@/components/forum/lazy-member-picker-field";
import { useMemberFieldText } from "@/components/forum/member-field-text";

// The same filter for the header's search popup: a separate module from `MemberField`, so no page
// carries the picker's code for it; the popup fetches it when it opens.
export function LazyMemberField({
  name,
  label,
  initial,
}: {
  name: string;
  label: string;
  initial?: string;
}) {
  return (
    <LazyMemberPickerField
      name={name}
      label={label}
      initial={initial}
      text={useMemberFieldText()}
    />
  );
}
