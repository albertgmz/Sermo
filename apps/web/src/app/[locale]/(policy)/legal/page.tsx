import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(policy)/static-page";

export function generateMetadata() {
  return staticPageMetadata("legal", "/legal");
}

export default function Page() {
  return <StaticPage slug="legal" path="/legal" />;
}
