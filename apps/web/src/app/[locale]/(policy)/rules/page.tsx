import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(policy)/static-page";

export function generateMetadata() {
  return staticPageMetadata("rules", "/rules");
}

export default function Page() {
  return <StaticPage slug="rules" path="/rules" />;
}
