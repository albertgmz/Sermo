// What the moderator log calls an action: the backend writes ids such as `permission.set`. A
// message key cannot hold a dot, so the label of an id is stored under the id with `_` for `.`
// (`admin.logTable.actions.permission_set`). An id with no label is not given one.
type Names = ((key: never) => string) & { has: (key: never) => boolean };

export function actionLabel(names: Names, id: string): string | null {
  const key = id.replaceAll(".", "_") as never;
  return names.has(key) ? names(key) : null;
}
