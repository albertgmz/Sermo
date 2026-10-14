import { redirect } from "next/navigation";

// Appearance is a group of the account screen now. A visit to the old address is sent there with
// a redirect of its own, so the old page does not stay in the history.
export default function AppearancePage(): never {
  redirect("/account#appearance");
}
