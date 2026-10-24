import { useMemberFieldText } from "@/components/forum/member-field-text";
import { MemberPickerField } from "@/components/forum/member-picker-field";

// The member filter of the search page: a labelled box that suggests members as the visitor types
// and keeps the chosen one as a chip.
export function MemberField({
  name,
  label,
  initial,
}: {
  name: string;
  label: string;
  initial?: string;
}) {
  return (
    <MemberPickerField
      name={name}
      label={label}
      initial={initial}
      text={useMemberFieldText()}
    />
  );
}
