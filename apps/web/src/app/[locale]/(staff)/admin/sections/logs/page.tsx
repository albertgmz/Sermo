import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("logs");

export default function LogsLanding() {
  return <SectionLanding section="logs" />;
}
