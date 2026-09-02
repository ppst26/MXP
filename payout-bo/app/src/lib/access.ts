import type { BoUserRole, BoUserStatus, LoginResult, LoginStage } from "../mock/types";

export function boUserRoleLabel(role: BoUserRole): string {
  if (role === "shop_admin") return "แอดมินร้าน";
  if (role === "platform_admin") return "แพลตฟอร์ม";
  return "ผู้ใช้ร้าน";
}

export function boUserStatusLabel(status: BoUserStatus): string {
  return status === "active" ? "ใช้งาน" : "ปิดใช้";
}

export function loginStageLabel(stage: LoginStage): string {
  return stage === "2fa" ? "2FA" : "รหัสผ่าน";
}

export function loginResultLabel(result: LoginResult): string {
  return result === "success" ? "สำเร็จ" : "ล้มเหลว";
}
