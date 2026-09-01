import type { HouseAlert } from "../../mock/query";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function HouseBanners({ alerts }: { alerts: HouseAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {alerts.map((a) => (
        <Alert key={a.id} variant={a.level === "alert" ? "destructive" : "default"}>
          <AlertDescription>{a.text}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
