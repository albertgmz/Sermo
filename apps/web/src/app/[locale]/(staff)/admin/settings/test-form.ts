// The form data of the settings action tests. Every setting the test posts a value for is marked
// as shown, as the form's own hidden fields would; `unticked` names the switches and lists the
// form showed but the test leaves out (an unticked box is not posted), and `levelTitles` is
// marked when any title row is posted.
export function settingsForm(
  fields: [string, string][],
  ...unticked: string[]
): FormData {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  const shown = new Set<string>(unticked);
  for (const [name] of fields) {
    if (name.startsWith("levelTitles.")) shown.add("levelTitles");
    else if (!name.includes(".")) shown.add(name);
  }
  for (const key of shown) data.append("shown", key);
  return data;
}
