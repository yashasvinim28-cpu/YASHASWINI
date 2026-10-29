import { Navigate } from "react-router-dom";

/** Legacy route; service onboarding is now Create service. */
export default function ProviderRegisterPage() {
  return <Navigate to="/provider/service/create" replace />;
}
