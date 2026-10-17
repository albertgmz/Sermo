import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("appearance");

export default function AppearanceLanding() {
  return <SectionLanding section="appearance" />;
}
