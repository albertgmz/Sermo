import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("tools");

export default function ToolsLanding() {
  return <SectionLanding section="tools" />;
}
