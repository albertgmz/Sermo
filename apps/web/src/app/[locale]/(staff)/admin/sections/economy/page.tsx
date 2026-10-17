import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("economy");

export default function EconomyLanding() {
  return <SectionLanding section="economy" />;
}
