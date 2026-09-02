import { useEffect, useMemo, useState } from "react";
import { MERCHANTS } from "../../mock/seed";
import { merchById } from "../../mock/query";
import type { BoUserRole } from "../../mock/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CreateBoUserInput } from "../../state/use-access-mock";

type Props = {
  open: boolean;
  isAdmin: boolean;
  scopedMerchantId: string;
  lockShop?: boolean;
  lockPlatform?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateBoUserInput) => { ok: true } | { ok: false; error: string };
};

export function UserCreateDialog({
  open,
  isAdmin,
  scopedMerchantId,
  lockShop = false,
  lockPlatform = false,
  onOpenChange,
  onCreate,
}: Props) {
  const directs = useMemo(() => MERCHANTS.filter((m) => m.role === "DIRECT"), []);
  const defaultAffiliation = lockPlatform ? "platform" : scopedMerchantId;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState<string>(defaultAffiliation);
  const [role, setRole] = useState<BoUserRole>(defaultAffiliation === "platform" ? "platform_admin" : "user");
  const [error, setError] = useState("");

  const reset = () => {
    setUsername("");
    setDisplayName("");
    setAffiliation(defaultAffiliation);
    setRole(defaultAffiliation === "platform" ? "platform_admin" : "user");
    setError("");
  };

  useEffect(() => {
    if (open) {
      setAffiliation(defaultAffiliation);
      setRole(defaultAffiliation === "platform" ? "platform_admin" : "user");
    }
  }, [open, defaultAffiliation]);

  const platform = affiliation === "platform";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>สร้างผู้ใช้</DialogTitle>
          <DialogDescription>จำลองเท่านั้น — ยังไม่ยิง API จริง รหัสชั่วคราวให้เปลี่ยนตอนเข้าครั้งแรก</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="type-label">ชื่อผู้ใช้</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="เช่น acme.ops" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="type-label">ชื่อที่แสดง</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ชื่อคน" />
          </div>
          {lockShop ? (
            <p className="text-xs text-muted-foreground">
              สังกัด: {merchById(scopedMerchantId)?.name ?? scopedMerchantId}
            </p>
          ) : null}
          {isAdmin && !lockShop && !lockPlatform ? (
            <div className="flex flex-col gap-1">
              <Label className="type-label">สังกัด</Label>
              <Select
                value={affiliation}
                onValueChange={(v) => {
                  setAffiliation(v);
                  setRole("user");
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {directs.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} · {m.code}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {platform ? (
            <p className="text-xs text-muted-foreground">บทบาท: แพลตฟอร์มแอดมิน</p>
          ) : (
            <div className="flex flex-col gap-1">
              <Label className="type-label">บทบาท</Label>
              <Select value={role} onValueChange={(v) => setRole(v as BoUserRole)}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="user">ผู้ใช้ร้าน</SelectItem>
                    <SelectItem value="shop_admin">แอดมินร้าน</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => {
              const result = onCreate({
                username,
                displayName,
                merchantId: platform ? null : affiliation,
                role: platform ? "platform_admin" : role,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              reset();
              onOpenChange(false);
            }}
          >
            สร้าง
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
