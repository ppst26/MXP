import { Navigate, useNavigate } from "react-router-dom";
import { BanknoteIcon } from "lucide-react";
import { useViewer } from "../../state/use-viewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const nav = useNavigate();
  const { isAuthenticated, login } = useViewer();

  if (isAuthenticated) {
    return <Navigate to="/payouts/overview" replace />;
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 grid size-10 place-items-center rounded-lg bg-muted">
            <BanknoteIcon className="size-5" />
          </div>
          <CardTitle>MaxPay BO</CardTitle>
          <CardDescription>เข้าสู่ระบบเพื่อจัดการโอนออก</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              login();
              nav("/payouts/overview", { replace: true });
            }}
          >
            เข้าสู่ระบบ
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
