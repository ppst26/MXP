import { Navigate, useParams, useSearchParams } from "react-router-dom";

export function LegacyAdminUsersRedirect() {
  const [params] = useSearchParams();
  const { merchantId } = useParams();
  if (merchantId) return <Navigate to={`/shops/${merchantId}`} replace />;
  if (params.get("kind") === "admin") return <Navigate to="/admins" replace />;
  return <Navigate to="/shops" replace />;
}
