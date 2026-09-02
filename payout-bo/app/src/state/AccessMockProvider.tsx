import { useMemo, useState, type ReactNode } from "react";
import { seedBoUsers, seedLoginEvents } from "../mock/access-seed";
import type { BoUser, BoUserStatus, LoginEvent } from "../mock/types";
import { merchById } from "../mock/query";
import { NOW } from "../lib/bangkok";
import { AccessMockContext, type AccessMockValue } from "./access-mock-context";

function cloneUsers(): BoUser[] {
  return seedBoUsers().map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
    createdAt: new Date(u.createdAt),
  }));
}

function cloneEvents(): LoginEvent[] {
  return seedLoginEvents().map((e) => ({ ...e, at: new Date(e.at) }));
}

function tempPassword(): string {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "mock-";
  for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

export function AccessMockProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<BoUser[]>(cloneUsers);
  const [events] = useState<LoginEvent[]>(cloneEvents);
  const [flash, setFlash] = useState<string | null>(null);
  const [merchantNames, setMerchantNames] = useState<Record<string, string>>({});

  const value = useMemo<AccessMockValue>(
    () => ({
      users,
      events,
      flash,
      clearFlash: () => setFlash(null),
      merchantName: (merchantId) => merchantNames[merchantId] ?? merchById(merchantId)?.name ?? merchantId,
      createUser: (input) => {
        const username = input.username.trim();
        const displayName = input.displayName.trim();
        if (!username) return { ok: false, error: "ใส่ชื่อผู้ใช้" };
        if (!displayName) return { ok: false, error: "ใส่ชื่อที่แสดง" };
        if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
          return { ok: false, error: "ชื่อผู้ใช้นี้มีอยู่แล้ว" };
        }
        const platform = input.merchantId == null;
        const next: BoUser = {
          id: `u-new-${Date.now()}`,
          username,
          displayName,
          merchantId: input.merchantId,
          kind: platform ? "platform" : "merchant",
          role: platform ? "platform_admin" : input.role === "shop_admin" ? "shop_admin" : "user",
          status: "active",
          twoFactor: false,
          mustChangePassword: true,
          lastLoginAt: null,
          createdAt: NOW,
        };
        setUsers((list) => [next, ...list]);
        setFlash(`สร้างผู้ใช้ ${username} แล้ว · รหัสชั่วคราวต้องเปลี่ยนตอนเข้าครั้งแรก`);
        return { ok: true, user: next };
      },
      setStatus: (id, status: BoUserStatus) => {
        const target = users.find((u) => u.id === id);
        if (!target || target.kind === "platform" || target.role === "platform_admin") return;
        setUsers((list) => list.map((u) => (u.id === id ? { ...u, status } : u)));
        setFlash(status === "disabled" ? `ปิดใช้ ${target.username} แล้ว` : `เปิดใช้ ${target.username} แล้ว`);
      },
      resetPassword: (id) => {
        const target = users.find((u) => u.id === id);
        if (!target || target.kind === "platform" || target.role === "platform_admin") return null;
        const temp = tempPassword();
        setUsers((list) => list.map((u) => (u.id === id ? { ...u, mustChangePassword: true } : u)));
        setFlash(`รีเซ็ตรหัสของ ${target.username} แล้ว · รหัสชั่วคราว ${temp}`);
        return temp;
      },
      renameShop: (merchantId, name) => {
        const next = name.trim();
        if (!next) return { ok: false, error: "ใส่ชื่อร้าน" };
        const shop = merchById(merchantId);
        if (!shop || shop.role !== "DIRECT") return { ok: false, error: "ไม่พบร้านนี้" };
        setMerchantNames((map) => ({ ...map, [merchantId]: next }));
        setFlash(`เปลี่ยนชื่อร้านเป็น ${next} แล้ว`);
        return { ok: true };
      },
      renameDisplayName: (id, displayName) => {
        const target = users.find((u) => u.id === id);
        if (!target || target.kind === "platform" || target.role === "platform_admin") {
          return { ok: false, error: "แก้ชื่อบัญชีแพลตฟอร์มแอดมินไม่ได้" };
        }
        const next = displayName.trim();
        if (!next) return { ok: false, error: "ใส่ชื่อที่แสดง" };
        setUsers((list) => list.map((u) => (u.id === id ? { ...u, displayName: next } : u)));
        setFlash(`เปลี่ยนชื่อที่แสดงของ ${target.username} เป็น ${next} แล้ว`);
        return { ok: true };
      },
    }),
    [users, events, flash, merchantNames],
  );

  return <AccessMockContext.Provider value={value}>{children}</AccessMockContext.Provider>;
}
