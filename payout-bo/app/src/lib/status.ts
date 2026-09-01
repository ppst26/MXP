import type { BatchStatus, PayoutStatus, Route } from "../mock/types";

const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  PENDING: "รอส่ง",
  PROCESSING: "กำลังส่ง",
  COMPLETED: "สำเร็จ",
  FAILED: "ไม่สำเร็จ",
  REJECTED: "ไม่รับทำ",
  NEEDS_REVIEW: "รอตรวจสอบ",
};

const BATCH_LABEL: Record<BatchStatus, string> = {
  PENDING: "รอส่ง",
  SENDING: "กำลังส่งชุด",
  SENT: "ส่งแล้วรอปิดยอด",
  SETTLED: "ปิดยอดแล้ว",
  NEEDS_REVIEW: "รอตรวจสอบ",
  FAILED: "ส่งชุดไม่สำเร็จ",
};

const PAYOUT_PILL: Record<PayoutStatus, string> = {
  PENDING: "muted",
  PROCESSING: "info",
  COMPLETED: "ok",
  FAILED: "alert",
  REJECTED: "orange",
  NEEDS_REVIEW: "review",
};

const BATCH_PILL: Record<BatchStatus, string> = {
  PENDING: "muted",
  SENDING: "info",
  SENT: "info",
  SETTLED: "ok",
  NEEDS_REVIEW: "review",
  FAILED: "orange",
};

export function payoutLabel(s: PayoutStatus): string {
  return PAYOUT_LABEL[s];
}

export function batchLabel(s: BatchStatus): string {
  return BATCH_LABEL[s];
}

export function statusLabel(s: string): string {
  return (PAYOUT_LABEL as Record<string, string>)[s] || (BATCH_LABEL as Record<string, string>)[s] || s;
}

export function statusPillClass(s: string): string {
  return PAYOUT_PILL[s as PayoutStatus] || BATCH_PILL[s as BatchStatus] || "muted";
}

export function payoutPill(s: PayoutStatus): string {
  return PAYOUT_PILL[s];
}

export function batchPill(s: BatchStatus): string {
  return BATCH_PILL[s];
}

export function routeLabel(r: Route): string {
  return r === "INTERBANK" ? "ข้ามธนาคาร" : "ในธนาคาร";
}

export const PAYOUT_STATUSES: PayoutStatus[] = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "REJECTED",
  "NEEDS_REVIEW",
];

export const BATCH_STATUSES: BatchStatus[] = [
  "PENDING",
  "SENDING",
  "SENT",
  "SETTLED",
  "NEEDS_REVIEW",
  "FAILED",
];
