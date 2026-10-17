import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("users");

export default function UsersLanding() {
  return <SectionLanding section="users" />;
}
