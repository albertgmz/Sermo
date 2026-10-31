import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(policy)/static-page";

export function generateMetadata() {
  return staticPageMetadata("terms", "/terms");
}

export default function Page() {
  return <StaticPage slug="terms" path="/terms" />;
}
