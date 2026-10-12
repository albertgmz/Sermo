import { notFound, redirect } from "next/navigation";

// The permissions of one forum are the screen of "Groups and permissions", so this address sends
// there with the forum already chosen. The gate of the panel has already checked that the viewer
// holds `admin.permissions`; the screen it leads to asks the backend for the entries.
async function ToMatrix({
  params,
}: {
  params: PageProps<"/admin/forums/[id]/permissions">["params"];
}): Promise<never> {
  const { id } = await params;
  if (!/^[1-9]\d{0,14}$/.test(id)) notFound();
  return redirect(`/admin/permissions/forums?node=${id}`);
}

export default function ForumPermissionsPage({
  params,
}: PageProps<"/admin/forums/[id]/permissions">) {
  return <ToMatrix params={params} />;
}
