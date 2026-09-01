export type PayoutStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED"
  | "NEEDS_REVIEW";

export type BatchStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "SETTLED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type Route = "SAME_BANK" | "INTERBANK";

export type MerchantRole = "RESELLER" | "DIRECT";

export type Merchant = {
  id: string;
  code: string;
  name: string;
  role: MerchantRole;
  parentId: string | null;
  rate: number;
};

export type TimelinePoint = {
  at: Date;
  status: string;
  note?: string;
};

export type JournalPoint = {
  type: "PAYOUT_CREATED" | "PAYOUT_COMPLETED" | "PAYOUT_FAILED";
  at: Date;
};

export type Payout = {
  referenceId: string;
  transactionId: string;
  merchantId: string;
  merchantCode: string;
  merchantName: string;
  clientId: string;
  clientName: string;
  status: PayoutStatus;
  amount: number;
  reservedFee: number;
  route: Route;
  bankFee: number;
  bankFeeEstimated: boolean;
  recipientAccountNo: string;
  recipientBankCode: string;
  recipientBankName: string;
  recipientName: string;
  recipientPhone: string;
  accountToName: string;
  nameMismatch: boolean;
  sourceAccountNo: string;
  sourceBankCode: string;
  sourceBankName: string;
  sourceAccountName: string;
  batchId: string | null;
  packageRefNo: string | null;
  bankOrderId: string | null;
  bankItemId: string | null;
  bankBulkOrderId: string | null;
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  updatedAt: Date | null;
  attempts: number;
  nextAttemptAt: Date | null;
  callbackUrl: string;
  timeline: TimelinePoint[];
  journal: JournalPoint[];
};

export type Batch = {
  id: string;
  status: BatchStatus;
  itemCount: number;
  totalAmount: number;
  totalFeeQuoted: number | null;
  sameBankCount: number;
  interbankCount: number;
  bankFeeIncurred: number;
  bankFeeEstimated: boolean;
  bankBulkOrderId: string | null;
  packageRefNo: string | null;
  failureReason: string | null;
  createdAt: Date;
  sentAt: Date | null;
  confirmedAt: Date | null;
  settledAt: Date | null;
  stuck: boolean;
  itemRefs: string[];
};

export type SourceAccount = {
  id: string;
  accountNo: string;
  accountName: string;
  bankCode: string;
  bankName: string;
  tier: string;
  status: string;
  bankBalance: number;
  bookBalance: number;
  minBalance: number;
  dailyTxnCap: number;
  dailyAmountCap: number;
  dailyTxnUsed: number;
  dailyAmountUsed: number;
  payoutEnabled: boolean;
  sendEnabled: boolean;
  bankBalanceAt: Date;
};

export type MerchantBooks = {
  merchantId: string;
  operate: number;
  parking: number;
  freeze: number;
  pendingPayout: number;
  freezeBalance: number;
  balance: number;
};

export type MockDb = {
  now: Date;
  source: SourceAccount;
  merchants: Merchant[];
  payouts: Payout[];
  batches: Batch[];
  books: Record<string, { operate: number; parking: number; freeze: number }>;
};

export type PeriodMetrics = {
  count: number;
  amount: number;
  completedCount: number;
  completedAmount: number;
  failedCount: number;
  failedAmount: number;
  rejectedCount: number;
  rejectedAmount: number;
  reservedFee: number;
  successRate: number;
  incurred: number;
  incurredCount: number;
  incurredEstimate: number;
  bankFeeDelta: number | null;
  bankFeeAllEstimated: boolean;
  sameBank: number;
  interbank: number;
  exposed: number;
};

export type BatchPeriodSummary = {
  total: number;
  settled: number;
  sending: number;
  sent: number;
  pending: number;
  needsReview: number;
  failed: number;
  stuck: number;
};

export type MerchantWatchRow = {
  id: string;
  name: string;
  code: string;
  completedCount: number;
  completedAmount: number;
  failed: number;
  review: number;
  pending: number;
  held: number;
  oldestMin: number | null;
  alertScore: number;
};

export type MerchantPeriodFee = {
  id: string;
  name: string;
  code: string;
  amount: number;
  reservedFee: number;
  incurred: number;
  incurredCount: number;
  interbankCount: number;
};
