import { Navigate } from "react-router-dom";
import { useViewer } from "../state/use-viewer";
import { Shell } from "../layout/Shell";

export function AuthShell() {
  const { isAuthenticated } = useViewer();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Shell />;
}
