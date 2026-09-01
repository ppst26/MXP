(function () {
  const TZ = "Asia/Bangkok";
  const NOW = new Date("2026-08-31T18:00:00+07:00");
  const SOURCE = {
    id: "src-ktb-01", accountNo: "1234567890", accountName: "บจก. แม็กซ์เพย์ จำกัด",
    bankCode: "006", bankName: "KTB", tier: "INBOUND", status: "ACTIVE",
    bankBalance: 186400, bookBalance: 186150, minBalance: 50000,
    dailyTxnCap: 200, dailyAmountCap: 500000, payoutEnabled: true, sendEnabled: true,
    bankBalanceAt: new Date(NOW.getTime() - 2 * 60 * 1000)
  };
  const BANKS = [
    { code: "006", name: "KTB" },
    { code: "014", name: "SCB" },
    { code: "004", name: "KBANK" },
    { code: "002", name: "BBL" },
    { code: "025", name: "BAY" },
    { code: "011", name: "TMB" }
  ];
  const NAMES = [
    ["สมชาย ใจดี", "สมชาย ใจดี"],
    ["เฮง ร่ำรวย", "เฮง ร่ำรวย"],
    ["นิด รวย", "นิดา รวย"],
    ["มาลี สุข", "มาลี สุข"],
    ["วิชัย มั่งมี", "วิชัย มั่งมี"],
    ["กมลชนก ศรีสุข", "กมลชนก ศรีสุข"],
    ["ประยุทธ ทองดี", "ประยุทธ์ ทองดี"],
    ["อรุณี แสงทอง", "อรุณี แสงทอง"],
    ["ธนา ตั้งตรง", "ธนา ตั้งตรง"],
    ["ปิยะ เจริญ", "ปิยะ เจริญ"]
  ];

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = Math.imul(a ^ (a >>> 15), 1 | a);
      a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
      return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = rng(20260831);
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function pad(n, w) { return String(n).padStart(w || 2, "0"); }
  function bkk(d) {
    return new Date(d).toLocaleString("sv-SE", { timeZone: TZ });
  }
  function inputVal(d) { return bkk(d).replace(" ", "T").slice(0, 16); }
  function parseInput(v) { return new Date(v + ":00+07:00"); }
  function fmtDT(d) { return bkk(d).replace("T", " ").slice(0, 19); }
  function fmtD(d) { return bkk(d).slice(0, 10); }
  function money(n, dp) { return Number(n).toLocaleString("th-TH", { minimumFractionDigits: dp ?? 2, maximumFractionDigits: dp ?? 2 }); }
  function money4(n) { return Number(n).toFixed(4); }
  function money2(n) { return Number(n).toFixed(2); }
  function pct(n) { return (n * 100).toFixed(1) + "%"; }
  function code(len) {
    const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let s = "";
    for (let i = 0; i < (len || 10); i++) s += c[Math.floor(rand() * c.length)];
    return s;
  }
  function addMs(d, ms) { return new Date(d.getTime() + ms); }
  function startOfDay(d) {
    const s = fmtD(d) + "T00:00:00+07:00";
    return new Date(s);
  }
  function sameBank(bankCode) { return bankCode === SOURCE.bankCode; }

  const merchants = [
    { id: "r-alpha", code: "ALPHA9k2Qx", name: "ตัวแทน อัลฟ่า", role: "RESELLER", parentId: null, rate: 0.007 },
    { id: "r-beta", code: "BETA4mN81p", name: "ตัวแทน เบต้า", role: "RESELLER", parentId: null, rate: 0.008 },
    { id: "r-gamma", code: "GAMMA2pL0s", name: "ตัวแทน แกมมา", role: "RESELLER", parentId: null, rate: 0.006 },
    { id: "m-acme", code: "VOBM7qzaRH", name: "Acme", role: "DIRECT", parentId: "r-alpha", rate: 0.015 },
    { id: "m-nova", code: "NOVA3xK91a", name: "Nova Play", role: "DIRECT", parentId: "r-alpha", rate: 0.018 },
    { id: "m-lotus", code: "LOTUS8dQ2w", name: "Lotus Bet", role: "DIRECT", parentId: "r-alpha", rate: 0.016 },
    { id: "m-orbit", code: "ORBIT5cE3t", name: "Orbit Pay", role: "DIRECT", parentId: "r-beta", rate: 0.014 },
    { id: "m-zen", code: "ZENITH1bR4", name: "Zenith", role: "DIRECT", parentId: "r-beta", rate: 0.017 },
    { id: "m-fox", code: "FOX9pL22k", name: "Fox Wallet", role: "DIRECT", parentId: "r-beta", rate: 0.015 },
    { id: "m-river", code: "RIVER6aM8n", name: "River Club", role: "DIRECT", parentId: "r-gamma", rate: 0.012 },
    { id: "m-peak", code: "PEAK4sT90q", name: "Peak Gaming", role: "DIRECT", parentId: "r-gamma", rate: 0.013 },
    { id: "m-dawn", code: "DAWN2uY11e", name: "Dawn Direct", role: "DIRECT", parentId: "r-gamma", rate: 0.015 }
  ];
  const MOCK_DIRECT_USER = "m-acme";
  const BOOK_SEED = {
    "r-alpha": { operate: 8420, parking: 0, freeze: 0 },
    "r-beta": { operate: 6100, parking: 0, freeze: 0 },
    "r-gamma": { operate: 3900, parking: 0, freeze: 0 },
    "m-acme": { operate: 38250, parking: 0, freeze: 0 },
    "m-nova": { operate: 12400, parking: 3000, freeze: 1500 },
    "m-lotus": { operate: 22100, parking: 0, freeze: 0 },
    "m-orbit": { operate: 9800, parking: 0, freeze: 0 },
    "m-zen": { operate: 15600, parking: 0, freeze: 800 },
    "m-fox": { operate: 7400, parking: 0, freeze: 0 },
    "m-river": { operate: 18800, parking: 5000, freeze: 0 },
    "m-peak": { operate: 11200, parking: 0, freeze: 0 },
    "m-dawn": { operate: 6500, parking: 0, freeze: 0 }
  };
  const HOLDS = { PENDING: 1, PROCESSING: 1, NEEDS_REVIEW: 1 };
  const BALANCE_MAX_AGE_MS = 5 * 60 * 1000;
  function merchById(id) { return merchants.find(function (m) { return m.id === id; }); }
  function subtreeIds(id) {
    if (!id) return null;
    const m = merchById(id);
    if (!m) return [id];
    if (m.role === "RESELLER") {
      return [id].concat(merchants.filter(function (x) { return x.parentId === id; }).map(function (x) { return x.id; }));
    }
    return [id];
  }

  const directs = merchants.filter(function (m) { return m.role === "DIRECT"; });
  const payouts = [];
  const batches = [];

  function feeOf(amount, rate) {
    return Math.round(amount * rate * 10000) / 10000;
  }

  let day = startOfDay(new Date("2026-08-01T00:00:00+07:00"));
  const lastDay = startOfDay(NOW);
  let seq = 1000;
  const openBatchHold = [];

  while (day <= lastDay) {
    const isToday = fmtD(day) === fmtD(NOW);
    const dow = new Date(day).getDay();
    const weekend = dow === 0 || dow === 6;
    let n = weekend ? 4 + Math.floor(rand() * 4) : 8 + Math.floor(rand() * 8);
    if (isToday) n = 14;
    const chunk = [];
    for (let i = 0; i < n; i++) {
      const m = pick(directs);
      const bank = (rand() < 0.42) ? BANKS[0] : pick(BANKS);
      const pair = pick(NAMES);
      const amount = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3500, 5000][Math.floor(rand() * 11)];
      const hour = isToday ? Math.floor(rand() * (NOW.getHours() - 7 + 1)) + 7 : Math.floor(rand() * 14) + 8;
      const minute = Math.floor(rand() * 60);
      const created = new Date(fmtD(day) + "T" + pad(Math.min(hour, isToday ? NOW.getHours() : 22)) + ":" + pad(minute) + ":00+07:00");
      if (created > NOW) continue;
      const route = sameBank(bank.code) ? "SAME_BANK" : "INTERBANK";
      const reserved = feeOf(amount, m.rate);
      const mismatch = pair[0] !== pair[1];
      const p = {
        referenceId: code(10),
        transactionId: "WD" + pad(seq++, 6),
        merchantId: m.id,
        merchantCode: m.code,
        merchantName: m.name,
        clientId: "c" + m.code.slice(0, 8),
        clientName: m.name + " API",
        status: "COMPLETED",
        amount: amount,
        reservedFee: reserved,
        route: route,
        bankFee: route === "INTERBANK" ? 5 : 0,
        bankFeeEstimated: false,
        recipientAccountNo: String(6000000000 + Math.floor(rand() * 899999999)),
        recipientBankCode: bank.code,
        recipientBankName: bank.name,
        recipientName: pair[0],
        recipientPhone: rand() < 0.3 ? "08" + pad(Math.floor(rand() * 100000000), 8) : "",
        accountToName: pair[1],
        nameMismatch: mismatch,
        sourceAccountNo: SOURCE.accountNo,
        sourceBankCode: SOURCE.bankCode,
        sourceBankName: SOURCE.bankName,
        sourceAccountName: SOURCE.accountName,
        batchId: null,
        packageRefNo: null,
        bankOrderId: null,
        bankItemId: null,
        bankBulkOrderId: null,
        failureReason: null,
        createdAt: created,
        confirmedAt: addMs(created, 20000 + Math.floor(rand() * 40000)),
        updatedAt: null,
        attempts: 1,
        nextAttemptAt: null,
        callbackUrl: "https://merchant.example/callback/payout",
        timeline: [],
        journal: []
      };
      p.updatedAt = p.confirmedAt;
      chunk.push(p);
      payouts.push(p);
    }

    const sorted = chunk.slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
    if (isToday) {
      sorted.forEach(function (p, i) {
        if (i < 3) {
          p.status = "PENDING"; p.confirmedAt = null; p.updatedAt = p.createdAt; p.bankFee = 0; p.bankFeeEstimated = p.route === "INTERBANK"; p.attempts = 0;
        } else if (i < 5) {
          p.status = "PROCESSING"; p.confirmedAt = addMs(p.createdAt, 15000); p.updatedAt = p.confirmedAt; p.bankFeeEstimated = p.route === "INTERBANK"; if (p.route === "INTERBANK") p.bankFee = 0;
          openBatchHold.push(p);
        } else if (i === 5) {
          p.status = "NEEDS_REVIEW"; p.confirmedAt = addMs(p.createdAt, 18000); p.failureReason = "bulkItemStatus=UNKNOWN_CODE · transactionErrorDescription=รอตรวจสอบ"; p.bankFee = 0; p.bankFeeEstimated = true;
          openBatchHold.push(p);
        } else if (i === 6) {
          p.status = "FAILED"; p.confirmedAt = null; p.batchId = null; p.failureReason = "บัญชีปลายทางไม่มีตัว"; p.bankFee = 0; p.attempts = 1;
          if (!p.nameMismatch) { p.accountToName = ""; }
        } else if (i === 7) {
          p.status = "REJECTED"; p.confirmedAt = null; p.failureReason = "ยอดไม่ผ่านเงื่อนไขร้าน"; p.bankFee = 0; p.attempts = 0;
        }
      });
    } else if (fmtD(day) === "2026-08-30") {
      sorted.slice(0, 2).forEach(function (p) {
        p.status = "PENDING"; p.confirmedAt = null; p.updatedAt = p.createdAt; p.bankFee = 0; p.bankFeeEstimated = p.route === "INTERBANK"; p.attempts = 0;
      });
      const fail = sorted[2];
      if (fail) {
        fail.status = "FAILED"; fail.confirmedAt = null; fail.failureReason = "บัญชีปลายทางไม่มีตัว"; fail.bankFee = 0; fail.accountToName = fail.accountToName || "";
      }
      const rev = sorted[3];
      if (rev) {
        rev.status = "NEEDS_REVIEW"; rev.failureReason = "รหัสสถานะรายการย่อยยังไม่อยู่ในแผนที่"; rev.bankFee = 0; rev.bankFeeEstimated = true;
      }
    } else {
      if (rand() < 0.35 && sorted[0]) {
        const f = sorted[0];
        f.status = "FAILED"; f.confirmedAt = null; f.failureReason = "บัญชีปลายทางไม่มีตัว"; f.bankFee = 0; f.batchId = null;
      }
      if (rand() < 0.12 && sorted[1]) {
        const r = sorted[1];
        r.status = "REJECTED"; r.confirmedAt = null; r.failureReason = "ร้านถูกระงับชั่วคราวตอนสร้างใบ"; r.bankFee = 0;
      }
    }

    const batchable = sorted.filter(function (p) {
      return p.status === "COMPLETED" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW";
    });
    for (let i = 0; i < batchable.length; i += 4) {
      const items = batchable.slice(i, i + 4);
      if (!items.length) continue;
      const bid = "b-" + fmtD(day).replace(/-/g, "") + "-" + pad(i / 4 + 1, 2);
      const pkg = "PKG-" + fmtD(day).replace(/-/g, "").slice(2) + pad(i / 4 + 1, 2);
      const order = "BULK-" + fmtD(day).replace(/-/g, "") + pad(i / 4 + 1, 2);
      const createdB = items[0].createdAt;
      const sent = addMs(createdB, 8 * 60000);
      const confirmed = addMs(sent, 20000);
      let status = "SETTLED";
      if (items.some(function (p) { return p.status === "NEEDS_REVIEW"; })) status = "NEEDS_REVIEW";
      if (items.some(function (p) { return p.status === "PROCESSING"; })) status = "SENT";
      const inter = items.filter(function (p) { return p.route === "INTERBANK"; }).length;
      const same = items.length - inter;
      const incurred = items.reduce(function (s, p) {
        return s + (p.status === "COMPLETED" && p.route === "INTERBANK" ? 5 : 0);
      }, 0);
      items.forEach(function (p, idx) {
        p.batchId = bid;
        p.packageRefNo = pkg;
        p.bankBulkOrderId = order;
        p.bankItemId = pad(idx + 1, 2);
        p.bankOrderId = order + "-" + p.bankItemId;
        if (p.status === "COMPLETED") {
          p.bankFee = p.route === "INTERBANK" ? 5 : 0;
          p.bankFeeEstimated = false;
        }
        p.timeline = [
          { at: p.createdAt, status: "PENDING" },
          { at: sent, status: "PROCESSING", note: "เข้าชุด" }
        ];
        if (p.confirmedAt) p.timeline.push({ at: p.confirmedAt, status: p.status, note: "confirmed_at" });
        p.journal = [{ type: "PAYOUT_CREATED", at: p.createdAt }];
        if (p.status === "COMPLETED") p.journal.push({ type: "PAYOUT_COMPLETED", at: p.confirmedAt || p.updatedAt });
        if (p.status === "FAILED") p.journal.push({ type: "PAYOUT_FAILED", at: p.updatedAt });
      });
      batches.push({
        id: bid,
        status: status,
        itemCount: items.length,
        totalAmount: items.reduce(function (s, p) { return s + p.amount; }, 0),
        totalFeeQuoted: status === "SETTLED" ? incurred : null,
        sameBankCount: same,
        interbankCount: inter,
        bankFeeIncurred: incurred,
        bankFeeEstimated: status !== "SETTLED",
        bankBulkOrderId: order,
        packageRefNo: pkg,
        failureReason: null,
        createdAt: createdB,
        sentAt: sent,
        confirmedAt: confirmed,
        settledAt: status === "SETTLED" ? addMs(confirmed, 45000) : null,
        stuck: false,
        itemRefs: items.map(function (p) { return p.referenceId; })
      });
    }

    day = addMs(day, 24 * 3600 * 1000);
    day = startOfDay(day);
  }

  const pendingBatchItems = payouts.filter(function (p) { return p.status === "PENDING" && fmtD(p.createdAt) === fmtD(NOW); }).slice(0, 4);
  if (pendingBatchItems.length) {
    const bid = "b-20260831-open";
    batches.unshift({
      id: bid,
      status: "PENDING",
      itemCount: pendingBatchItems.length,
      totalAmount: pendingBatchItems.reduce(function (s, p) { return s + p.amount; }, 0),
      totalFeeQuoted: null,
      sameBankCount: pendingBatchItems.filter(function (p) { return p.route === "SAME_BANK"; }).length,
      interbankCount: pendingBatchItems.filter(function (p) { return p.route === "INTERBANK"; }).length,
      bankFeeIncurred: 0,
      bankFeeEstimated: true,
      bankBulkOrderId: null,
      packageRefNo: null,
      failureReason: null,
      createdAt: addMs(NOW, -25 * 60000),
      sentAt: null,
      confirmedAt: null,
      settledAt: null,
      stuck: false,
      itemRefs: []
    });
  }

  const sending = {
    id: "b-20260831-send",
    status: "SENDING",
    itemCount: 3,
    totalAmount: 1600,
    totalFeeQuoted: null,
    sameBankCount: 1,
    interbankCount: 2,
    bankFeeIncurred: 0,
    bankFeeEstimated: true,
    bankBulkOrderId: "BULK-20260831-SEND",
    packageRefNo: null,
    failureReason: null,
    createdAt: addMs(NOW, -22 * 60000),
    sentAt: addMs(NOW, -20 * 60000),
    confirmedAt: null,
    settledAt: null,
    stuck: false,
    itemRefs: payouts.filter(function (p) { return p.status === "PROCESSING"; }).slice(0, 3).map(function (p) { return p.referenceId; })
  };
  sending.itemRefs.forEach(function (ref, idx) {
    const p = payouts.find(function (x) { return x.referenceId === ref; });
    if (!p) return;
    p.batchId = sending.id;
    p.bankBulkOrderId = sending.bankBulkOrderId;
    p.bankItemId = pad(idx + 1, 2);
    p.bankOrderId = sending.bankBulkOrderId + "-" + p.bankItemId;
    p.confirmedAt = null;
  });
  batches.unshift(sending);

  batches.push({
    id: "b-20260830-fail",
    status: "FAILED",
    itemCount: 4,
    totalAmount: 2200,
    totalFeeQuoted: null,
    sameBankCount: 2,
    interbankCount: 2,
    bankFeeIncurred: 0,
    bankFeeEstimated: true,
    bankBulkOrderId: null,
    packageRefNo: null,
    failureReason: "บัญชีต้นทางไม่พร้อม · CreateBulkOrder ถูกปฏิเสธ · ใบกลับ PENDING",
    createdAt: new Date("2026-08-30T21:40:00+07:00"),
    sentAt: new Date("2026-08-30T21:40:30+07:00"),
    confirmedAt: null,
    settledAt: null,
    stuck: false,
    itemRefs: []
  });

  payouts.forEach(function (p) {
    if (!p.timeline.length) {
      p.timeline = [{ at: p.createdAt, status: "PENDING" }];
      if (p.confirmedAt) p.timeline.push({ at: p.confirmedAt, status: p.status, note: "confirmed_at" });
      else if (p.status !== "PENDING") p.timeline.push({ at: p.updatedAt || p.createdAt, status: p.status });
    }
    if (!p.journal.length) {
      p.journal = [{ type: "PAYOUT_CREATED", at: p.createdAt }];
      if (p.status === "COMPLETED") p.journal.push({ type: "PAYOUT_COMPLETED", at: p.confirmedAt || p.updatedAt });
      if (p.status === "FAILED") p.journal.push({ type: "PAYOUT_FAILED", at: p.updatedAt || p.createdAt });
    }
  });

  const STUCK_AFTER = 15 * 60 * 1000;
  batches.forEach(function (b) {
    if ((b.status === "SENDING" || b.status === "SENT") && NOW - (b.sentAt || b.createdAt) > STUCK_AFTER) b.stuck = true;
  });

  const usedToday = payouts.filter(function (p) {
    return fmtD(p.createdAt) === fmtD(NOW) && (p.status === "COMPLETED" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW");
  });
  SOURCE.dailyTxnUsed = usedToday.length;
  SOURCE.dailyAmountUsed = usedToday.reduce(function (s, p) { return s + p.amount; }, 0);

  const state = {
    page: "overview",
    from: inputVal(startOfDay(NOW)),
    to: inputVal(NOW),
    merchantId: "",
    route: "",
    statuses: [],
    q: "",
    recipientAccount: "",
    nameMismatch: "",
    batchQ: "",
    batchStatus: "",
    batchStuck: "",
    listPage: 1,
    batchPage: 1,
    selectedRef: null,
    selectedBatch: null,
    preset: "today",
    comboOpen: false,
    comboQuery: "",
    role: "admin",
    batchId: "",
    demoSendOff: false,
    demoStale: false,
    demoNoSource: false,
    demoShort: false
  };

  function isAdmin() { return state.role !== "merchant"; }
  function scopedMerchantId() { return isAdmin() ? state.merchantId : MOCK_DIRECT_USER; }

  function statusLabel(s) {
    return ({
      PENDING: "รอส่ง", PROCESSING: "กำลังส่ง", COMPLETED: "สำเร็จ",
      FAILED: "ไม่สำเร็จ", REJECTED: "ไม่รับทำ", NEEDS_REVIEW: "รอตรวจสอบ",
      SENDING: "กำลังส่งชุด", SENT: "ส่งแล้วรอปิดยอด", SETTLED: "ปิดยอดแล้ว"
    })[s] || s;
  }
  function statusPill(s) {
    const map = { PENDING: "muted", PROCESSING: "info", COMPLETED: "ok", FAILED: "alert", REJECTED: "orange", NEEDS_REVIEW: "review", SENDING: "info", SENT: "info", SETTLED: "ok" };
    return '<span class="pill ' + (map[s] || "muted") + '">' + statusLabel(s) + "</span>";
  }
  function routePill(r) {
    return r === "INTERBANK" ? '<span class="pill info">ข้ามธนาคาร</span>' : '<span class="pill muted">ในธนาคาร</span>';
  }
  function deltaHtml(cur, prev) {
    if (!prev) return '<span class="s">ไม่มีช่วงเทียบ</span>';
    const d = (cur - prev) / (prev || 1);
    const cls = d >= 0 ? "up" : "down";
    const sign = d >= 0 ? "+" : "";
    return '<span class="delta ' + cls + '">' + sign + (d * 100).toFixed(1) + "% vs ช่วงก่อน</span>";
  }

  function applyPreset(name) {
    state.preset = name;
    const today0 = startOfDay(NOW);
    if (name === "today") { state.from = inputVal(today0); state.to = inputVal(NOW); }
    if (name === "yesterday") {
      const y0 = addMs(today0, -86400000);
      state.from = inputVal(y0); state.to = inputVal(addMs(y0, 86400000 - 1000));
    }
    if (name === "d7") { state.from = inputVal(addMs(today0, -6 * 86400000)); state.to = inputVal(NOW); }
    if (name === "d14") { state.from = inputVal(addMs(today0, -13 * 86400000)); state.to = inputVal(NOW); }
    if (name === "d30") { state.from = inputVal(new Date("2026-08-01T00:00:00+07:00")); state.to = inputVal(NOW); }
    state.listPage = 1;
  }

  function range() {
    return { from: parseInput(state.from), to: parseInput(state.to) };
  }
  function prevRange(from, to) {
    const fromD = startOfDay(from);
    const sameCalendar = Math.abs(from - fromD) < 60000 && fmtD(from) === fmtD(addMs(to, -1));
    if (sameCalendar || (fmtD(from) === fmtD(to) && from - fromD < 60000)) {
      return { from: addMs(from, -86400000), to: addMs(to, -86400000) };
    }
    const dur = to - from;
    return { from: new Date(from.getTime() - dur), to: from };
  }

  function inMerchant(p) {
    const ids = subtreeIds(scopedMerchantId());
    if (!ids) return true;
    return ids.indexOf(p.merchantId) >= 0;
  }
  function pendingPayoutOf(merchantId) {
    return payouts.filter(function (p) { return p.merchantId === merchantId && HOLDS[p.status]; })
      .reduce(function (s, p) { return s + p.amount + p.reservedFee; }, 0);
  }
  function booksOf(merchantId) {
    if (!merchantId) return null;
    const m = merchById(merchantId);
    if (!m || m.role !== "DIRECT") return null;
    const seed = BOOK_SEED[merchantId];
    if (!seed) return null;
    const pendingPayout = pendingPayoutOf(merchantId);
    const freezeBalance = seed.freeze + pendingPayout;
    return {
      merchantId: merchantId,
      operate: seed.operate,
      parking: seed.parking,
      freeze: seed.freeze,
      pendingPayout: pendingPayout,
      freezeBalance: freezeBalance,
      balance: seed.operate + seed.parking + freezeBalance
    };
  }
  function effectiveSource() {
    if (!isAdmin()) return null;
    if (state.demoNoSource) return null;
    const src = Object.assign({}, SOURCE);
    src.sendEnabled = SOURCE.sendEnabled && !state.demoSendOff;
    src.bankBalanceAt = state.demoStale ? new Date(NOW.getTime() - 2 * 3600 * 1000) : SOURCE.bankBalanceAt;
    src.bankBalance = state.demoShort ? 1000 : SOURCE.bankBalance;
    return src;
  }
  function houseAlerts(src, pendingCount, queueAmount, stuckCount) {
    const out = [];
    if (!src) {
      out.push({ id: "no-source", level: "alert", text: "ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชี" });
      return out;
    }
    if (!src.sendEnabled && pendingCount > 0) {
      out.push({ id: "send-off", level: "warn", text: "ส่งเงินปิดอยู่ แต่มีใบรอส่ง " + pendingCount + " ใบ คิวจะไม่ถูกหยิบ" });
    }
    if (NOW.getTime() - src.bankBalanceAt.getTime() > BALANCE_MAX_AGE_MS) {
      out.push({ id: "stale", level: "warn", text: "ยอดธนาคารเก่ากว่าเกณฑ์ ห้ามอ่านว่าพอจ่าย" });
    }
    if (stuckCount > 0) {
      out.push({ id: "stuck", level: "alert", text: "มีชุด SENDING/SENT ค้างเกินเกณฑ์ " + stuckCount + " ชุด" });
    }
    if (src.bankBalance < queueAmount + src.minBalance) {
      out.push({ id: "short", level: "alert", text: "บัญชีต้นทางไม่พอจ่ายทั้งคิว + เงินสำรอง — จะส่งเท่าที่พอ คิวที่เหลือจะนิ่ง" });
    }
    return out;
  }
  function payoutsInPeriod(from, to) {
    return payouts.filter(function (p) {
      return p.createdAt >= from && p.createdAt < to && inMerchant(p)
        && (!state.route || p.route === state.route)
        && (!state.statuses.length || state.statuses.indexOf(p.status) >= 0);
    });
  }
  function listFiltered() {
    const r = range();
    return payouts.filter(function (p) {
      if (p.createdAt < r.from || p.createdAt >= r.to) return false;
      if (!inMerchant(p)) return false;
      if (state.route && p.route !== state.route) return false;
      if (state.statuses.length && state.statuses.indexOf(p.status) < 0) return false;
      if (state.q) {
        const q = state.q.trim();
        if (p.referenceId !== q && p.transactionId !== q) return false;
      }
      if (state.recipientAccount && p.recipientAccountNo !== state.recipientAccount.trim()) return false;
      if (state.nameMismatch === "1" && !p.nameMismatch) return false;
      if (state.batchId && p.batchId !== state.batchId) return false;
      return true;
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }
  function queuePayouts() {
    return payouts.filter(function (p) {
      return inMerchant(p) && (p.status === "PENDING" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW");
    });
  }
  function metrics(rows) {
    const completed = rows.filter(function (p) { return p.status === "COMPLETED"; });
    const failed = rows.filter(function (p) { return p.status === "FAILED"; });
    const rejected = rows.filter(function (p) { return p.status === "REJECTED"; });
    const incurredRows = completed.filter(function (p) { return p.route === "INTERBANK"; });
    const exposed = rows.filter(function (p) {
      return (p.status === "PENDING" || p.status === "PROCESSING") && p.route === "INTERBANK";
    });
    const successDen = completed.length + failed.length;
    return {
      count: rows.length,
      amount: rows.reduce(function (s, p) { return s + p.amount; }, 0),
      completedCount: completed.length,
      completedAmount: completed.reduce(function (s, p) { return s + p.amount; }, 0),
      failedCount: failed.length,
      failedAmount: failed.reduce(function (s, p) { return s + p.amount; }, 0),
      rejectedCount: rejected.length,
      rejectedAmount: rejected.reduce(function (s, p) { return s + p.amount; }, 0),
      reservedFee: rows.reduce(function (s, p) { return s + p.reservedFee; }, 0),
      successRate: successDen ? completed.length / successDen : 0,
      incurred: incurredRows.length * 5,
      incurredCount: incurredRows.length,
      sameBank: rows.filter(function (p) { return p.route === "SAME_BANK"; }).length,
      interbank: rows.filter(function (p) { return p.route === "INTERBANK"; }).length,
      exposed: exposed.length * 5
    };
  }

  function timeseries(from, to, prevFrom, prevTo) {
    const hours = (to - from) <= 48 * 3600 * 1000;
    const buckets = [];
    if (hours) {
      let t = new Date(from);
      t.setMinutes(0, 0, 0);
      while (t < to) {
        buckets.push({ t: new Date(t), label: pad(t.getHours()) + "น." });
        t = addMs(t, 3600000);
      }
    } else {
      let t = startOfDay(from);
      while (t < to) {
        buckets.push({ t: new Date(t), label: fmtD(t).slice(8) });
        t = addMs(t, 86400000);
      }
    }
    function amt(rows, start, end) {
      return rows.filter(function (p) { return p.status === "COMPLETED" && p.createdAt >= start && p.createdAt < end; })
        .reduce(function (s, p) { return s + p.amount; }, 0);
    }
    const curRows = payoutsInPeriod(from, to);
    const prevRows = payoutsInPeriod(prevFrom, prevTo);
    const step = hours ? 3600000 : 86400000;
    return buckets.map(function (b, i) {
      const end = addMs(b.t, step);
      const prevStart = addMs(prevFrom, i * step);
      const prevEnd = addMs(prevStart, step);
      return { label: b.label, current: amt(curRows, b.t, end), previous: amt(prevRows, prevStart, prevEnd) };
    });
  }

  function byRouteTable(rows) {
    return ["SAME_BANK", "INTERBANK"].map(function (r) {
      const rs = rows.filter(function (p) { return p.route === r; });
      const m = metrics(rs);
      return { route: r, m: m };
    });
  }

  function funnel(rows) {
    return ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REJECTED", "NEEDS_REVIEW"].map(function (s) {
      const rs = rows.filter(function (p) { return p.status === s; });
      return { status: s, count: rs.length, amount: rs.reduce(function (a, p) { return a + p.amount; }, 0) };
    });
  }

  function queueAge(rows) {
    const now = NOW;
    const buckets = [
      { id: "LT_1M", label: "< 1 น.", max: 60 },
      { id: "M1_5", label: "1–5 น.", max: 300 },
      { id: "M5_30", label: "5–30 น.", max: 1800 },
      { id: "M30_2H", label: "30 น.–2 ชม.", max: 7200 },
      { id: "GT_2H", label: "> 2 ชม.", max: Infinity }
    ];
    const open = rows.filter(function (p) { return p.status === "PENDING" || p.status === "PROCESSING" || p.status === "NEEDS_REVIEW"; });
    return buckets.map(function (b, i) {
      const min = i === 0 ? 0 : buckets[i - 1].max;
      const count = open.filter(function (p) {
        const sec = (now - p.createdAt) / 1000;
        return sec >= min && sec < b.max;
      }).length;
      return Object.assign({ count: count }, b);
    });
  }

  function filterBar(showSearch) {
    const presets = [["today", "วันนี้"], ["yesterday", "เมื่อวาน"], ["d7", "7 วัน"], ["d14", "14 วัน"], ["d30", "ทั้งเดือน"]];
    const merchLabel = state.merchantId ? (function () {
      const m = merchById(state.merchantId);
      return m ? ((m.role === "RESELLER" ? m.name + " (ทั้งสาย)" : m.name + " · " + m.code)) : "ทุกร้าน";
    })() : "ทุกร้าน";
    return '<div class="filters">' +
      '<div class="filters-main">' +
        '<div class="filters-left">' +
          '<div class="field"><label>ช่วง</label><div class="preset-row">' +
            presets.map(function (p) { return '<button class="preset' + (state.preset === p[0] ? " on" : "") + '" data-preset="' + p[0] + '">' + p[1] + "</button>"; }).join("") +
          "</div></div>" +
          (isAdmin()
            ? ('<div class="combo-wrap"><label>ร้าน (เลือกโหนด = ทั้งสาย)</label>' +
            '<button type="button" class="combo" id="merchantBtn"><span>' + merchLabel + "</span><span>▾</span></button>" +
            '<div class="combo-panel' + (state.comboOpen ? " open" : "") + '" id="merchantPanel">' + merchantPanel() + "</div></div>")
            : '<div class="field"><label>ร้าน</label><input disabled value="Acme · VOBM7qzaRH"></div>') +
          '<div class="field"><label>เส้นทาง</label><select id="route">' +
            opt("", "ทั้งหมด", state.route) + opt("SAME_BANK", "ในธนาคาร", state.route) + opt("INTERBANK", "ข้ามธนาคาร", state.route) +
          "</select></div>" +
        "</div>" +
        '<div class="filters-dates">' +
          '<div class="field"><label>จาก</label><input type="datetime-local" id="from" value="' + state.from + '"></div>' +
          '<div class="field"><label>ถึง</label><input type="datetime-local" id="to" value="' + state.to + '"></div>' +
          '<button class="primary" id="apply">ใช้ตัวกรอง</button>' +
        "</div>" +
      "</div>" +
      (showSearch ? '<div class="row" style="margin-top:8px">' +
        (state.batchId ? '<div class="field"><label>ชุด</label><button type="button" id="clearBatch">' + esc(state.batchId) + " · ล้าง</button></div>" : "") +
        '<div class="field grow"><label>อ้างอิง / ออเดอร์ร้าน (ตรงค่า)</label><input id="q" value="' + esc(state.q) + '" placeholder="referenceId หรือ transactionId"></div>' +
      "</div>" : "") +
      (showSearch ? '<div class="row" style="margin-top:8px">' +
        '<div class="field grow"><label>เลขบัญชีผู้รับ</label><input id="acc" value="' + esc(state.recipientAccount) + '"></div>' +
        '<div class="field"><label>ชื่อไม่ตรง</label><select id="mm">' + opt("", "ทั้งหมด", state.nameMismatch) + opt("1", "เฉพาะที่ไม่ตรง", state.nameMismatch) + "</select></div>" +
        '<div class="field grow"><label>สถานะใบ (เลือกได้หลายค่า)</label><div class="checks" id="st">' +
          ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REJECTED", "NEEDS_REVIEW"].map(function (s) {
            return '<label style="display:inline"><input type="checkbox" value="' + s + '"' + (state.statuses.indexOf(s) >= 0 ? " checked" : "") + "> " + statusLabel(s) + "</label>";
          }).join("") +
        "</div></div></div>" : "") +
      "</div>";
  }
  function opt(v, t, cur) { return '<option value="' + v + '"' + (cur === v ? " selected" : "") + ">" + t + "</option>"; }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  function merchantPanel() {
    const q = (state.comboQuery || "").toLowerCase();
    let html = '<input id="mq" placeholder="ค้นหาชื่อหรือรหัส" value="' + esc(state.comboQuery) + '">';
    html += '<div class="combo-item' + (!state.merchantId ? " on" : "") + '" data-merch="">ทุกร้าน</div>';
    merchants.filter(function (m) { return m.role === "RESELLER"; }).forEach(function (r) {
      const kids = merchants.filter(function (m) { return m.parentId === r.id; });
      const show = !q || r.name.toLowerCase().indexOf(q) >= 0 || r.code.toLowerCase().indexOf(q) >= 0 ||
        kids.some(function (k) { return k.name.toLowerCase().indexOf(q) >= 0 || k.code.toLowerCase().indexOf(q) >= 0; });
      if (!show) return;
      html += '<div class="combo-group">' + r.name + "</div>";
      html += '<div class="combo-item' + (state.merchantId === r.id ? " on" : "") + '" data-merch="' + r.id + '">' + r.name + " (ทั้งสาย) · " + r.code + "</div>";
      kids.forEach(function (k) {
        if (q && k.name.toLowerCase().indexOf(q) < 0 && k.code.toLowerCase().indexOf(q) < 0 && r.name.toLowerCase().indexOf(q) < 0) return;
        html += '<div class="combo-item indent' + (state.merchantId === k.id ? " on" : "") + '" data-merch="' + k.id + '">' + k.name + " · " + k.code + "</div>";
      });
    });
    return html;
  }

  function bindFilters(root, extra) {
    root.querySelectorAll("[data-preset]").forEach(function (b) {
      b.onclick = function () { applyPreset(b.getAttribute("data-preset")); render(); };
    });
    const apply = function () {
      state.from = root.querySelector("#from").value;
      state.to = root.querySelector("#to").value;
      state.route = root.querySelector("#route").value;
      state.preset = "custom";
      const q = root.querySelector("#q"); if (q) state.q = q.value;
      const acc = root.querySelector("#acc"); if (acc) state.recipientAccount = acc.value;
      const mm = root.querySelector("#mm"); if (mm) state.nameMismatch = mm.value;
      const st = root.querySelector("#st");
      if (st) {
        state.statuses = [].slice.call(st.querySelectorAll("input:checked")).map(function (i) { return i.value; });
      }
      state.listPage = 1;
      if (extra) extra();
      render();
    };
    const applyBtn = root.querySelector("#apply");
    if (applyBtn) applyBtn.onclick = apply;
    const clearBatch = root.querySelector("#clearBatch");
    if (clearBatch) clearBatch.onclick = function () { state.batchId = ""; state.listPage = 1; render(); };
    ["from", "to", "route", "q", "acc", "mm"].forEach(function (id) {
      const el = root.querySelector("#" + id);
      if (el) el.addEventListener(el.tagName === "SELECT" || el.type === "datetime-local" ? "change" : "keydown", function (e) {
        if (e.type === "keydown" && e.key !== "Enter") return;
        apply();
      });
    });
    const btn = root.querySelector("#merchantBtn");
    const panel = root.querySelector("#merchantPanel");
    if (btn) btn.onclick = function (e) { e.stopPropagation(); state.comboOpen = !state.comboOpen; render(); };
    if (panel) {
      const mq = panel.querySelector("#mq");
      if (mq) {
        mq.addEventListener("input", function () { state.comboQuery = mq.value; state.comboOpen = true; const caret = mq.selectionStart; render(); const n = document.querySelector("#mq"); if (n) { n.focus(); n.setSelectionRange(caret, caret); } });
      }
      panel.querySelectorAll("[data-merch]").forEach(function (it) {
        it.onclick = function (e) { e.stopPropagation(); state.merchantId = it.getAttribute("data-merch"); state.comboOpen = false; state.comboQuery = ""; state.listPage = 1; render(); };
      });
    }
  }

  function renderOverview() {
    const r = range();
    const pr = prevRange(r.from, r.to);
    const rows = payoutsInPeriod(r.from, r.to);
    const prev = payoutsInPeriod(pr.from, pr.to);
    const m = metrics(rows);
    const pm = metrics(prev);
    const q = queuePayouts();
    const held = q.filter(function (p) { return p.status === "PENDING" || p.status === "PROCESSING"; })
      .reduce(function (s, p) { return s + p.amount + p.reservedFee; }, 0);
    const pending = q.filter(function (p) { return p.status === "PENDING"; });
    const proc = q.filter(function (p) { return p.status === "PROCESSING"; });
    const review = q.filter(function (p) { return p.status === "NEEDS_REVIEW"; });
    const oldest = pending.slice().sort(function (a, b) { return a.createdAt - b.createdAt; })[0];
    const oldestMin = oldest ? Math.round((NOW - oldest.createdAt) / 60000) : 0;
    const noOrder = proc.filter(function (p) { return !p.bankBulkOrderId && !p.bankOrderId; });
    const unconf = proc.filter(function (p) { return (p.bankBulkOrderId || p.bankOrderId) && !p.confirmedAt; });
    const conf = proc.filter(function (p) { return p.confirmedAt; });
    const bOpen = batches.filter(function (b) { return b.status === "PENDING"; });
    const bSend = batches.filter(function (b) { return b.status === "SENDING"; });
    const bSent = batches.filter(function (b) { return b.status === "SENT"; });
    const bRev = batches.filter(function (b) { return b.status === "NEEDS_REVIEW"; });
    const bStuck = batches.filter(function (b) { return b.stuck; });
    const bPeriod = batches.filter(function (b) { return b.createdAt >= r.from && b.createdAt < r.to; });
    const ts = timeseries(r.from, r.to, pr.from, pr.to);
    const maxBar = Math.max.apply(null, ts.map(function (x) { return Math.max(x.current, x.previous, 1); }));
    const routes = byRouteTable(rows);
    const fn = funnel(rows);
    const ages = queueAge(q);
    const fnMax = Math.max.apply(null, fn.map(function (x) { return x.count; }).concat([1]));

    const admin = isAdmin();
    const shop = merchById(scopedMerchantId());
    const books = booksOf(scopedMerchantId());
    const src = effectiveSource();
    const stuckN = batches.filter(function (b) { return b.stuck; }).length;
    const alerts = admin ? houseAlerts(src, pending.length, sumAmt(pending.concat(proc)), stuckN) : [];
    const bannerAlerts = src ? alerts : alerts.filter(function (a) { return a.id !== "no-source"; });
    const bannersHtml = bannerAlerts.length
      ? '<div class="banners">' + bannerAlerts.map(function (a) { return '<div class="banner ' + a.level + '">' + a.text + "</div>"; }).join("") + "</div>"
      : "";
    const booksHtml = books
      ? ('<div class="books-block"><div class="mini-grid books">' +
          '<div class="mini static' + (books.operate <= 0 ? " warn" : "") + '"><div class="h">ใช้ได้</div><div class="n">' + money(books.operate) + '</div><div class="l">MERCHANT_OPERATE · สั่งถอนได้จากยอดนี้</div></div>' +
          mini("กันไว้รอถอน", money(books.pendingPayout), "MERCHANT_PENDING_PAYOUT · ใบที่ยังไม่จบรวมรอคนดู", "list", { statuses: ["PENDING", "PROCESSING", "NEEDS_REVIEW"] }, books.pendingPayout ? "" : "quiet") +
          (books.parking > 0 ? '<div class="mini static quiet"><div class="h">พักไว้</div><div class="n">' + money(books.parking) + '</div><div class="l">MERCHANT_PARKING · แอดมินย้ายมา ไม่ใช่คิวถอน</div></div>' : "") +
          (books.freeze > 0 ? '<div class="mini static warn"><div class="h">อายัด</div><div class="n">' + money(books.freeze) + '</div><div class="l">MERCHANT_FREEZE · ข้อพิพาท ไม่รวมกันถอน</div></div>' : "") +
        '</div><div class="legend">ยอดร้าน ' + money(books.balance) + " = ใช้ได้ + พัก + อายัด + กันถอน · ตัวเลขสมุด ไม่ใช่ผลรวมใบในช่วงวันที่เลือก</div></div>")
      : "";
    const zone1 = !admin ? "" : (
      src
        ? ('<section class="zone"><h2>โซน 1 — สุขภาพบัญชีต้นทาง</h2><div class="body">' +
          '<div class="cards health">' +
            card("รับคำสั่ง", '<span class="pill ' + (src.payoutEnabled ? "ok" : "alert") + '">' + (src.payoutEnabled ? "enabled" : "ปิด") + "</span>", "payout.enabled") +
            card("ส่งเงิน", '<span class="pill ' + (src.sendEnabled ? "ok" : "alert") + '">' + (src.sendEnabled ? "send เปิด" : "send ปิด") + "</span>", src.sendEnabled ? "คิวถูกหยิบได้" : "คิวจะนิ่ง") +
            card("บัญชีจ่าย", src.accountNo, src.bankName + " " + src.bankCode + " · " + src.accountName) +
            card("สถานะ / tier", '<span class="pill ok">' + src.status + "</span>", src.tier !== "OUTBOUND" ? '<span class="pill warn">' + src.tier + "</span> เตือน: ไม่ใช่ OUTBOUND" : src.tier) +
            card("ยอดธนาคาร", money(src.bankBalance), (NOW - src.bankBalanceAt > BALANCE_MAX_AGE_MS ? "เก่า ห้ามอ่านว่าพอจ่าย" : "รีเฟรชล่าสุด") + " · สมุด " + money(src.bookBalance)) +
            card("เพดานวันนี้", src.dailyTxnUsed + " / " + src.dailyTxnCap, "ยอด " + money(src.dailyAmountUsed) + " / " + money(src.dailyAmountCap) + " · สำรอง " + money(src.minBalance)) +
          "</div></div></section>")
        : '<section class="zone"><h2>โซน 1 — สุขภาพบัญชีต้นทาง</h2><div class="body"><div class="banner alert">ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชีจากร้านหรือจาก config อื่น</div></div></section>'
    );

    const watchHide = !admin || !!(shop && shop.role === "DIRECT");
    const watchRows = watchHide ? [] : merchantWatch(rows, q);
    const watchHtml = !admin ? "" : (watchHide
      ? '<div class="legend">ซ่อนตารางร้านที่ต้องดู เพราะกรองเหลือร้านเดียว — ดูการ์ดด้านบน</div>'
      : (
        '<div class="watch"><div class="k" style="margin-bottom:8px">ร้านที่ต้องดู · เจ้าของระบบเท่านั้น · เรียงเตือนก่อนยอด</div>' +
        '<table><thead><tr><th>ร้าน</th><th class="num">สำเร็จช่วงนี้</th><th class="num">ล้ม</th><th class="num">รอคนดู</th><th class="num">รอส่ง</th><th class="num">กันไว้</th><th>เก่าสุด</th></tr></thead><tbody>' +
        watchRows.map(function (x) {
          const heat = x.review || x.failed || x.oldestMin >= 30;
          return '<tr class="clickable' + (heat ? " heat" : "") + '" data-watch="' + x.id + '"><td>' + x.name + " · " + x.code + "</td>" +
            '<td class="num">' + x.completedCount + " · " + money(x.completedAmount) + "</td>" +
            '<td class="num">' + x.failed + "</td>" +
            '<td class="num">' + x.review + "</td>" +
            '<td class="num">' + x.pending + "</td>" +
            '<td class="num">' + money(x.held) + "</td>" +
            "<td>" + (x.oldestMin != null ? x.oldestMin + " น." : "—") + "</td></tr>";
        }).join("") +
        '</tbody></table><div class="legend">คลิกแถวกรองร้านนี้บนภาพรวม · ไม่ใช่จอร้าน · สูงสุด 8 แถว</div></div>'
      ));

    document.getElementById("app").innerHTML =
      "<h1>ภาพรวมโอนออก</h1>" +
      '<div class="sub">/payouts/overview · ' + (admin ? "แพลตฟอร์มแอดมิน" : "Acme · DIRECT · ไม่เห็นบัญชีต้นทางและต้นทุนบ้าน") + " · เทียบ " + fmtDT(pr.from) + " → " + fmtDT(pr.to) + "</div>" +
      filterBar(false) +
      zone1 + (admin ? bannersHtml : "") +
      '<section class="zone"><h2>โซน 2 — งานค้างตอนนี้ <span class="live"><span class="live-dot"></span>สแนปชอตคิว ณ ตอนนี้ · ไม่ตามวันที่เลือก · poll 15 วินาที</span></h2><div class="body">' +
        booksHtml +
        '<div class="mini-grid' + (books ? " three" : "") + '">' +
          mini("รอส่ง", pending.length, money(sumAmt(pending)) + (oldest ? " · เก่าสุด " + oldestMin + " น." : ""), "list", { statuses: ["PENDING"] }, pending.length ? "" : "quiet") +
          mini("กำลังส่ง", proc.length, (unconf.length ? "ห้ามส่งซ้ำ " + unconf.length : "ในชุด/กำลังโอน") + (conf.length ? " · รอผล " + conf.length : ""), "list", { statuses: ["PROCESSING"] }, unconf.length ? "warn" : (proc.length ? "" : "quiet")) +
          mini("รอคนดู", review.length, review.length ? money(sumAmt(review)) : "ไม่มีใบค้างตรวจ", "list", { statuses: ["NEEDS_REVIEW"] }, review.length ? "alert" : "quiet") +
          (books ? "" : mini("เงินที่กันไว้", money(held), "PENDING + PROCESSING · ผลรวมใบ ไม่ใช่สมุดร้าน", "list", { statuses: ["PENDING", "PROCESSING"] }, "quiet")) +
        "</div>" +
        (admin
          ? ('<div class="mini-grid three">' +
          mini("ชุดรอส่ง", bOpen.length, bOpen.length ? bOpen.reduce(function (s, b) { return s + b.itemCount; }, 0) + " ใบในชุด" : "ไม่มี", "batches", { batchStatus: "PENDING" }, bOpen.length ? "" : "quiet") +
          mini("ชุดระหว่างทาง", bSend.length + bSent.length, (bSend.length + bSent.length) ? "ห้ามส่งซ้ำถ้ามีเลขออเดอร์" : "ไม่มี", "batches", { batchStatus: "SENT" }, (bSend.length + bSent.length) ? "warn" : "quiet") +
          mini("ชุดต้องดู", bRev.length + bStuck.length, "รอคนดูหรือค้างเกินเกณฑ์", "batches", { batchStuck: "1" }, (bRev.length + bStuck.length) ? "alert" : "quiet") +
        "</div>")
          : "") +
        '<div class="legend">' + (books ? "แถวบนเป็นสมุดร้าน ไม่ตัดวันที่ · การ์ดคิวเป็นใบค้าง ไม่ใช่ยอดใช้ได้" : "ตัวเลขนี้ไม่เปลี่ยนเมื่อกดวันนี้/7 วัน — เป็นคิวค้างในระบบตอนนี้ ไม่ใช่รายงานตามช่วง") + "</div>" +
      "</div></section>" +
      '<section class="zone"><h2>โซน 3 — ยอดช่วงที่เลือก</h2><div class="body">' +
        '<div class="cards kpis">' +
          card("จำนวนใบ", String(m.count), deltaHtml(m.count, pm.count)) +
          card("ยอดโอน", money(m.amount), deltaHtml(m.amount, pm.amount)) +
          card("สำเร็จ", m.completedCount + " · " + money(m.completedAmount), deltaHtml(m.completedAmount, pm.completedAmount)) +
          card("ล้ม", m.failedCount + " · " + money(m.failedAmount), "ไม่รับทำ " + m.rejectedCount + " · " + money(m.rejectedAmount)) +
          (admin ? ('<div class="card accent"><div class="k">ค่าธรรมเนียมโอนธนาคาร (บ้านจ่าย)</div><div class="v">' + money(m.incurred) +
            '</div><div class="s">' + m.incurredCount + " ใบข้ามธนาคาร × 5.00 · ในธนาคาร " + m.sameBank + " ใบ = 0.00</div>" +
            '<div class="s">ประมาณการคิวที่ยังไม่จบ ' + money(m.exposed) + " — ไม่รวมตัวเลขหลัก</div>" +
            '<div class="s">' + deltaHtml(m.incurred, pm.incurred) + "</div></div>") : "") +
          card("ค่าบริการร้าน", money(m.reservedFee, 4), admin ? "ห้ามบวกกับการ์ดซ้าย" : "ค่าที่สมุดกันตอนสร้างใบ") +
          (admin ? card("ชุดในช่วงนี้", String(bPeriod.length), "ปิดยอด " + bPeriod.filter(function (b) { return b.status === "SETTLED"; }).length + " · ยังไม่จบ " + bPeriod.filter(function (b) { return b.status !== "SETTLED" && b.status !== "FAILED"; }).length) : "") +
        "</div>" +
        '<div class="legend">อัตราสำเร็จ ' + pct(m.successRate) + " = สำเร็จ / (สำเร็จ+ล้ม) ไม่นับคิวและไม่รับทำ · ใบทั้งหมดในระบบ " + payouts.length + " · ชุด " + batches.length + "</div>" +
        '<div class="cards pair" style="margin-top:12px">' +
          '<div class="card"><div class="k">คู่ 1 — ยอดสำเร็จช่วงนี้ vs ช่วงก่อน</div><div class="bars">' +
            ts.map(function (x) {
              return '<div class="bar-col"><div class="bar prev" style="height:' + (x.previous / maxBar * 80) + '%"></div><div class="bar" style="height:' + (x.current / maxBar * 80) + '%"></div><span>' + x.label + "</span></div>";
            }).join("") +
          '</div><div class="legend">ทึบ = ช่วงนี้ · ฟ้าอ่อน = ช่วงก่อน</div></div>' +
          '<div class="card"><div class="k">คู่ 2 — ในธนาคาร vs ข้ามธนาคาร</div>' +
            '<table><thead><tr><th>เส้นทาง</th><th class="num">ใบ</th><th class="num">ยอด</th><th class="num">สำเร็จ</th>' + (admin ? '<th class="num">ค่าโอน</th>' : "") + "</tr></thead><tbody>" +
            routes.map(function (x) {
              return "<tr><td>" + (x.route === "INTERBANK" ? "ข้ามธนาคาร" : "ในธนาคาร") + '</td><td class="num">' + x.m.count + '</td><td class="num">' + money(x.m.amount) + '</td><td class="num">' + pct(x.m.successRate) + "</td>" + (admin ? '<td class="num">' + money(x.m.incurred) + "</td>" : "") + "</tr>";
            }).join("") +
          "</tbody></table></div>" +
          '<div class="card"><div class="k">คู่ 3 — กรวยสถานะ + อายุคิวตอนนี้</div>' +
            fn.map(function (x) {
              return '<div class="s" style="margin:4px 0">' + statusLabel(x.status) + " " + x.count + ' <span style="display:inline-block;height:8px;width:' + (x.count / fnMax * 160) + 'px;background:#9aa;vertical-align:middle;border-radius:2px"></span></div>';
            }).join("") +
            '<div class="s" style="margin-top:8px">อายุคิวที่ยังไม่จบ: ' + ages.map(function (a) { return a.label + " " + a.count; }).join(" · ") + "</div></div>" +
          (admin && src ? (
          '<div class="card"><div class="k">คู่ 4 — ยอดบัญชี vs คิว vs เพดานวัน</div>' +
            '<div class="s">ยอดธนาคาร ' + money(src.bankBalance) + '</div><div class="stack"><div style="width:37%;background:#8ab"></div></div>' +
            '<div class="s" style="margin-top:8px">คิวรอจ่าย ' + money(sumAmt(pending.concat(proc))) + '</div><div class="stack"><div style="width:' + Math.min(100, sumAmt(pending.concat(proc)) / (src.bankBalance || 1) * 100) + '%;background:#ccc"></div></div>' +
            '<div class="s" style="margin-top:8px">เพดานวัน ใช้ ' + money(src.dailyAmountUsed) + " / " + money(src.dailyAmountCap) + '</div><div class="stack"><div style="width:' + (src.dailyAmountUsed / src.dailyAmountCap * 100) + '%;background:#bbb"></div></div>' +
            (src.bankBalance < sumAmt(pending.concat(proc)) + src.minBalance ? '<div class="banner alert" style="margin-top:8px">บัญชีต้นทางไม่พอจ่ายทั้งคิว + เงินสำรอง</div>' : "") +
          "</div>") : "") +
        "</div>" + watchHtml + "</div></section>";

    bindFilters(document.getElementById("app"));
    bindQrows(document.getElementById("app"));
    document.querySelectorAll("[data-watch]").forEach(function (tr) {
      tr.onclick = function () { state.merchantId = tr.getAttribute("data-watch"); saveState(); render(); };
    });
  }


  function merchantWatch(periodRows, queueRows) {
    return directs.map(function (m) {
      const period = periodRows.filter(function (p) { return p.merchantId === m.id; });
      const qq = queueRows.filter(function (p) { return p.merchantId === m.id; });
      const met = metrics(period);
      const pending = qq.filter(function (p) { return p.status === "PENDING"; });
      const review = qq.filter(function (p) { return p.status === "NEEDS_REVIEW"; });
      const held = qq.filter(function (p) { return p.status === "PENDING" || p.status === "PROCESSING"; })
        .reduce(function (s, p) { return s + p.amount + p.reservedFee; }, 0);
      const oldest = pending.slice().sort(function (a, b) { return a.createdAt - b.createdAt; })[0];
      const oldestMin = oldest ? Math.round((NOW - oldest.createdAt) / 60000) : null;
      const alertScore = review.length * 100 + (oldestMin != null && oldestMin >= 30 ? 50 : 0) + met.failedCount * 10 + pending.length;
      return {
        id: m.id, name: m.name, code: m.code,
        completedCount: met.completedCount, completedAmount: met.completedAmount,
        failed: met.failedCount, review: review.length, pending: pending.length,
        held: held, oldestMin: oldestMin, alertScore: alertScore
      };
    }).sort(function (a, b) {
      if (b.alertScore !== a.alertScore) return b.alertScore - a.alertScore;
      return b.completedAmount - a.completedAmount;
    }).slice(0, 8);
  }

  function card(k, v, s) { return '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + "</div></div>"; }
  function sumAmt(rows) { return rows.reduce(function (s, p) { return s + p.amount; }, 0); }
  function mini(label, n, sub, page, patch, cls) {
    return '<div class="mini ' + (cls || "") + '" data-go="' + page + '" data-patch=\'' + JSON.stringify(patch) + "'><div class=\"h\">" + label + '</div><div class="n">' + n + '</div><div class="l">' + sub + "</div></div>";
  }
  function qrow(l, r, page, patch, cls) {
    return mini(l, r, "", page, patch, cls);
  }
  function bindQrows(root) {
    root.querySelectorAll("[data-go]").forEach(function (el) {
      el.onclick = function () {
        const patch = JSON.parse(el.getAttribute("data-patch") || "{}");
        Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
        if (el.getAttribute("data-go") === "list" && patch.statuses) applyPreset("d30");
        if (el.getAttribute("data-go") === "batches") applyPreset("d30");
        go(el.getAttribute("data-go"));
      };
    });
  }

  function renderList() {
    const rows = listFiltered();
    const m = metrics(rows);
    const limit = 20;
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    if (state.listPage > pages) state.listPage = pages;
    const slice = rows.slice((state.listPage - 1) * limit, state.listPage * limit);
    document.getElementById("app").innerHTML =
      "<h1>รายการใบถอน</h1>" +
      '<div class="sub">/payouts · พบ ' + rows.length + " ใบ ตามตัวกรอง · " + (isAdmin() ? "ทั้งระบบ " + payouts.length + " ใบ" : "Acme · ใบในสายนี้เท่านั้น") + "</div>" +
      filterBar(true) +
      '<div class="summary">' +
        '<div>ใบ<b>' + m.count + "</b></div>" +
        "<div>ยอดโอน<b>" + money(m.amount) + "</b></div>" +
        "<div>สำเร็จ<b>" + m.completedCount + " · " + money(m.completedAmount) + "</b></div>" +
        "<div>ล้ม<b>" + m.failedCount + " · " + money(m.failedAmount) + '</b><span style="color:var(--muted)"> ไม่รับทำ ' + m.rejectedCount + "</span></div>" +
        "<div>ค่าบริการร้าน<b>" + money(m.reservedFee, 4) + "</b></div>" +
        (isAdmin() ? "<div>ค่าโอนธนาคารที่เกิดแล้ว<b>" + money(m.incurred) + '</b><span style="color:var(--muted)"> ' + m.incurredCount + " × 5.00</span></div>" : "") +
      "</div>" +
      '<div class="zone"><h2>ตารางใบ</h2><div class="body" style="overflow:auto">' +
        (slice.length ? tablePayouts(slice) : '<div class="empty">ไม่พบรายการตามตัวกรอง</div>') +
        '<div class="pager"><span>หน้า ' + state.listPage + " / " + pages + "</span><span>" +
          '<button id="prevP">ก่อนหน้า</button> <button id="nextP">ถัดไป</button></span></div>' +
      "</div></div>";
    bindFilters(document.getElementById("app"));
    document.getElementById("prevP").onclick = function () { if (state.listPage > 1) { state.listPage--; render(); } };
    document.getElementById("nextP").onclick = function () { if (state.listPage < pages) { state.listPage++; render(); } };
    bindTableNav();
  }

  function tablePayouts(rows, opts) {
    opts = opts || {};
    const showFee = opts.showBankFee !== false && isAdmin();
    return '<table><thead><tr>' +
      "<th>เวลาสร้าง</th><th>ร้าน</th><th>อ้างอิง</th><th>ออเดอร์ร้าน</th><th class='num'>ยอด</th><th class='num'>ค่าบริการ</th><th>สถานะ</th><th>เส้นทาง</th>" +
      (showFee ? "<th class='num'>ค่าโอน</th>" : "") +
      "<th>ผู้รับ</th><th>ชื่อที่ธนาคารตอบ</th>" +
      (opts.hideBatch ? "" : "<th>ชุด</th>") + "<th>สาเหตุ</th></tr></thead><tbody>" +
      rows.map(function (p) {
        const fee = p.status === "COMPLETED" && p.route === "INTERBANK" ? "5.00" :
          p.route === "SAME_BANK" ? "0.00" :
          (p.status === "PENDING" || p.status === "PROCESSING") && p.route === "INTERBANK" ? '5.00 <span style="color:var(--muted)">(ประมาณ)</span>' : "—";
        return '<tr class="clickable" data-ref="' + p.referenceId + '">' +
          "<td>" + fmtDT(p.createdAt) + "</td>" +
          "<td>" + p.merchantName + " · " + p.merchantCode + "</td>" +
          '<td><a class="ref">' + p.referenceId + "</a></td>" +
          "<td>" + p.transactionId + "</td>" +
          '<td class="num">' + money4(p.amount) + "</td>" +
          '<td class="num">' + money4(p.reservedFee) + "</td>" +
          "<td>" + statusPill(p.status) + "</td>" +
          "<td>" + routePill(p.route) + "</td>" +
          (showFee ? '<td class="num">' + fee + "</td>" : "") +
          "<td>" + p.recipientBankName + " " + p.recipientBankCode + " · " + p.recipientAccountNo + " · " + p.recipientName + "</td>" +
          "<td" + (p.nameMismatch ? ' class="mismatch"' : "") + ">" + (p.accountToName || "—") + "</td>" +
          (opts.hideBatch ? "" : "<td>" + (p.batchId ? '<a class="ref" data-batch="' + p.batchId + '">' + p.batchId.replace("b-", "") + "</a>" : (p.status === "FAILED" && p.failureReason && p.failureReason.indexOf("บัญชี") >= 0 ? "ไม่เข้าชุด" : "ยังไม่เข้าชุด")) + "</td>") +
          "<td>" + (p.failureReason ? p.failureReason.slice(0, 42) : "—") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function bindTableNav() {
    document.querySelectorAll("[data-ref]").forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.getAttribute("data-batch")) {
          state.selectedBatch = e.target.getAttribute("data-batch");
          go("batch");
          return;
        }
        state.selectedRef = tr.getAttribute("data-ref");
        go("detail");
      };
    });
    document.querySelectorAll("[data-batch]").forEach(function (a) {
      a.onclick = function (e) {
        e.stopPropagation();
        if (!isAdmin()) {
          state.batchId = a.getAttribute("data-batch");
          state.listPage = 1;
          go("list");
          return;
        }
        state.selectedBatch = a.getAttribute("data-batch");
        go("batch");
      };
    });
  }

  function renderDetail() {
    const p = payouts.find(function (x) { return x.referenceId === state.selectedRef; });
    if (!p || (!isAdmin() && p.merchantId !== MOCK_DIRECT_USER)) {
      document.getElementById("app").innerHTML = "<h1>404</h1><div class=\"sub\">ไม่พบใบในสายร้านนี้</div>";
      return;
    }
    state.selectedRef = p.referenceId;
    const b = p.batchId ? batches.find(function (x) { return x.id === p.batchId; }) : null;
    const procSec = p.status === "COMPLETED" && p.confirmedAt ? Math.round((p.confirmedAt - p.createdAt) / 1000) : null;
    document.getElementById("app").innerHTML =
      "<h1>/" + "payouts/" + p.referenceId + "</h1>" +
      '<div class="sub">รายละเอียดหนึ่งใบ · อ่านอย่างเดียว</div>' +
      '<p><a class="ref" id="backList">← กลับรายการ</a></p>' +
      '<div class="row" style="margin-bottom:12px;gap:14px;align-items:center">' + statusPill(p.status) +
        '<strong style="font-size:22px">' + money4(p.amount) + "</strong><span>" + p.merchantName + " · " + p.merchantCode + "</span>" +
        '<span class="s">สร้าง ' + fmtDT(p.createdAt) + "</span></div>" +
      '<div class="grid2">' +
        block("1. ผู้รับ", dl([
          ["บัญชี", p.recipientAccountNo], ["ธนาคาร", p.recipientBankName + " · " + p.recipientBankCode],
          ["ชื่อที่ร้านส่ง", p.recipientName], ["ชื่อที่ธนาคารตอบ", p.accountToName || "—"],
          ["เบอร์", p.recipientPhone || "—"], ["เส้นทาง", p.route === "INTERBANK" ? "ข้ามธนาคาร" : "ในธนาคาร"]
        ].concat(isAdmin() ? [["ค่าโอนธนาคาร", p.route === "INTERBANK" ? (p.status === "COMPLETED" ? "5.00" : "5.00 (ประมาณ)") : "0.00"]] : []))) +
        block("2. บัญชีต้นทาง", dl([
          ["เลขบัญชี", p.sourceAccountNo], ["ธนาคาร", p.sourceBankName + " · " + p.sourceBankCode],
          ["ชื่อ", p.sourceAccountName], ["ผูกตอนสร้างใบ", "ไม่เปลี่ยนตาม config ภายหลัง"]
        ])) +
        block("3. เงิน", dl([
          ["ยอดโอน", money4(p.amount)], ["ค่าบริการร้าน", money4(p.reservedFee)],
          ["ที่กันไว้", money4(p.amount + p.reservedFee)]
        ].concat(isAdmin() ? [["ค่าโอนธนาคาร", (p.bankFee ? money2(p.bankFee) : (p.route === "INTERBANK" ? "5.00 ประมาณการ" : "0.00")) + " — ห้ามบวกเข้าค่าบริการ"]] : []))) +
        block("4. ชุดที่สังกัด", b ? dl([
          ["รหัสชุด", b.id], ["สถานะชุด", statusLabel(b.status)],
          ["package_ref_no", b.packageRefNo || "—"]
        ].concat(isAdmin() ? [["bank_bulk_order_id", b.bankBulkOrderId || "ยังไม่มี"]] : []).concat([["bank_item_id", p.bankItemId || "—"]])) +
          (isAdmin() ? '<p><a class="ref" data-batch="' + b.id + '">เปิดหน้าชุด</a></p>' : '<p><a class="ref" data-batch="' + b.id + '">ดูใบในชุดนี้ (เฉพาะสายร้าน)</a></p>') : '<div class="body"><div class="s">ยังไม่เข้าชุด หรือล้มก่อนเข้าชุด</div></div>') +
        block("5. ธนาคารระดับใบ", dl([
          ["bank_order_id", p.bankOrderId || "—"], ["confirmed_at", p.confirmedAt ? fmtDT(p.confirmedAt) : "—"],
          ["attempts", String(p.attempts)], ["next_attempt_at", p.nextAttemptAt ? fmtDT(p.nextAttemptAt) : "—"]
        ].concat(isAdmin() ? [["callbackUrl", p.callbackUrl]] : []))) +
        block("6. ไทม์ไลน์ / สมุด / สาเหตุ", '<div class="body">' +
          p.timeline.map(function (t) { return "<div>" + fmtDT(t.at) + " — " + t.status + (t.note ? " (" + t.note + ")" : "") + "</div>"; }).join("") +
          '<div class="legend">' + (procSec != null ? "processSeconds = " + procSec + " วินาที ถึงจุดรับคำสั่ง ไม่ใช่เงินเข้าบัญชีผู้รับ" : "ไม่โชว์ processSeconds เพราะใบยังไม่ COMPLETED") + "</div>" +
          p.journal.map(function (j) { return "<div>" + j.type + " " + fmtDT(j.at) + "</div>"; }).join("") +
          '<div class="legend">สาเหตุ: ' + (p.failureReason || "—") + "</div></div>") +
      "</div>";
    document.getElementById("backList").onclick = function (e) { e.preventDefault(); go("list"); };
    bindTableNav();
  }

  function block(title, inner) {
    if (inner.indexOf("body") >= 0 && inner.indexOf("dl") < 0 && inner.indexOf("<div class=\"body\"") >= 0)
      return '<section class="zone"><h2>' + title + "</h2>" + inner + "</section>";
    return '<section class="zone"><h2>' + title + "</h2>" + inner + "</section>";
  }
  function dl(pairs) {
    return '<div class="body dl">' + pairs.map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("") + "</div>";
  }

  function stuckNBanner() {
    const n = batches.filter(function (b) { return b.stuck; }).length;
    return n ? '<div class="banners"><div class="banner alert">มีชุด SENDING/SENT ค้างเกินเกณฑ์ ' + n + " ชุด</div></div>" : "";
  }

  function batchesFiltered() {
    const r = range();
    return batches.filter(function (b) {
      if (b.createdAt < r.from || b.createdAt >= r.to) return false;
      if (state.batchStatus && b.status !== state.batchStatus) return false;
      if (state.batchStuck === "1" && !b.stuck && b.status !== "NEEDS_REVIEW") return false;
      if (state.batchQ) {
        const q = state.batchQ.trim();
        if (b.id !== q && b.bankBulkOrderId !== q && b.packageRefNo !== q) return false;
      }
      return true;
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function renderBatches() {
    if (!isAdmin()) {
      document.getElementById("app").innerHTML = "<h1>404</h1><div class=\"sub\">หน้าชุดโอนสำหรับแพลตฟอร์มแอดมินเท่านั้น · ร้านไม่เห็นยอดรวมทั้งชุด</div>";
      return;
    }
    const rows = batchesFiltered();
    const items = rows.reduce(function (s, b) { return s + b.itemCount; }, 0);
    const amt = rows.reduce(function (s, b) { return s + b.totalAmount; }, 0);
    const fee = rows.reduce(function (s, b) { return s + b.bankFeeIncurred; }, 0);
    const open = rows.filter(function (b) { return ["PENDING", "SENDING", "SENT", "NEEDS_REVIEW"].indexOf(b.status) >= 0; }).length;
    document.getElementById("app").innerHTML =
      "<h1>รายการชุดโอน</h1>" +
      '<div class="sub">/payouts/batches · แพลตฟอร์มแอดมิน · หนึ่งแถว = หนึ่งออเดอร์ธนาคาร · ทั้งระบบ ' + batches.length + " ชุด</div>" +
      (stuckNBanner()) +
      '<div class="filters"><div class="row">' +
        '<div class="field"><label>จาก</label><input type="datetime-local" id="from" value="' + state.from + '"></div>' +
        '<div class="field"><label>ถึง</label><input type="datetime-local" id="to" value="' + state.to + '"></div>' +
        '<div class="field"><label>สถานะชุด</label><select id="bstatus">' +
          opt("", "ทั้งหมด", state.batchStatus) +
          ["PENDING", "SENDING", "SENT", "SETTLED", "NEEDS_REVIEW", "FAILED"].map(function (s) { return opt(s, statusLabel(s), state.batchStatus); }).join("") +
        "</select></div>" +
        '<div class="field grow"><label>id / เลขออเดอร์ / package</label><input id="bq" value="' + esc(state.batchQ) + '"></div>' +
        '<div class="field"><label>ค้างเกินเกณฑ์</label><select id="bstuck">' + opt("", "ทั้งหมด", state.batchStuck) + opt("1", "เฉพาะค้าง / รอคนดู", state.batchStuck) + "</select></div>" +
        '<button class="primary" id="apply">ใช้ตัวกรอง</button></div></div>' +
      '<div class="summary"><div>ชุด<b>' + rows.length + "</b></div><div>ใบในชุด<b>" + items + "</b></div><div>ยอดโอนในชุด<b>" + money(amt) + "</b></div><div>ยังไม่จบ<b>" + open + "</b></div><div>ค่าโอนธนาคารที่เกิดแล้ว<b>" + money(fee) + "</b></div></div>" +
      '<div class="zone"><h2>ตารางชุด</h2><div class="body" style="overflow:auto">' +
        (rows.length ? '<table><thead><tr><th>เปิดชุด</th><th>สถานะ</th><th class="num">ใบ</th><th class="num">ยอดโอน</th><th>ใน / ข้าม</th><th class="num">ค่าโอน</th><th>เลขออเดอร์ธนาคาร</th><th>package</th><th>สาเหตุชุด</th></tr></thead><tbody>' +
          rows.map(function (b) {
            return '<tr class="clickable" data-batch="' + b.id + '"><td>' + fmtDT(b.createdAt) + "</td><td>" + statusPill(b.status) +
              '</td><td class="num">' + b.itemCount + '</td><td class="num">' + money(b.totalAmount) + "</td><td>" + b.sameBankCount + " ใน · " + b.interbankCount + " ข้าม</td>" +
              '<td class="num">' + money(b.bankFeeIncurred) + (b.bankFeeEstimated ? ' <span style="color:var(--muted)">(ประมาณ)</span>' : "") + "</td>" +
              "<td>" + (b.bankBulkOrderId ? '<span class="pill warn">มีแล้ว ห้ามส่งซ้ำ</span> ' + b.bankBulkOrderId : '<span class="pill muted">ยังไม่มี — ส่งใหม่ได้</span>') + "</td>" +
              "<td>" + (b.packageRefNo || "—") + "</td><td>" + (b.failureReason ? b.failureReason.slice(0, 40) : "—") + "</td></tr>";
          }).join("") + "</tbody></table>" : '<div class="empty">ไม่พบชุดตามตัวกรอง</div>') +
        '<div class="legend">แถว FAILED ของชุด ≠ ใบล้ม · ใบถูกปล่อยกลับคิวรอส่ง</div></div></div>';
    const root = document.getElementById("app");
    const apply = function () {
      state.from = root.querySelector("#from").value;
      state.to = root.querySelector("#to").value;
      state.batchStatus = root.querySelector("#bstatus").value;
      state.batchQ = root.querySelector("#bq").value;
      state.batchStuck = root.querySelector("#bstuck").value;
      state.preset = "custom";
      render();
    };
    root.querySelector("#apply").onclick = apply;
    ["from", "to", "bstatus", "bstuck"].forEach(function (id) {
      root.querySelector("#" + id).addEventListener("change", apply);
    });
    root.querySelector("#bq").addEventListener("keydown", function (e) { if (e.key === "Enter") apply(); });
    bindTableNav();
  }

  function renderBatch() {
    if (!isAdmin()) {
      document.getElementById("app").innerHTML = "<h1>404</h1><div class=\"sub\">หน้าชุดโอนสำหรับแพลตฟอร์มแอดมินเท่านั้น · ร้านไม่เห็นยอดรวมทั้งชุด</div>";
      return;
    }
    const b = batches.find(function (x) { return x.id === state.selectedBatch; }) || batches[0];
    state.selectedBatch = b.id;
    const items = payouts.filter(function (p) { return b.itemRefs.indexOf(p.referenceId) >= 0; });
    const reserved = items.reduce(function (s, p) { return s + p.reservedFee; }, 0);
    document.getElementById("app").innerHTML =
      "<h1>/payouts/batches/" + b.id + "</h1>" +
      '<div class="sub">รายละเอียดหนึ่งชุด · อ่านอย่างเดียว · ไม่มีปุ่มส่งซ้ำ / ปิดยอด</div>' +
      '<p><a class="ref" id="backB">← กลับรายการชุด</a></p>' +
      '<div class="row" style="margin-bottom:12px;gap:12px;align-items:center">' + statusPill(b.status) +
        "<strong>" + b.itemCount + " ใบ · " + money(b.totalAmount) + "</strong>" +
        (b.bankBulkOrderId ? '<span class="pill warn" >ห้ามส่งซ้ำ</span>' : '<span class="pill muted">ยังไม่มีเลขออเดอร์ — ส่งใหม่ได้</span>') +
        '<span class="s">เปิด ' + fmtDT(b.createdAt) + "</span></div>" +
      '<div class="banner warn">ใบที่เช็คชื่อไม่ผ่านหรือคิวที่เงินไม่พอจะไม่โชว์ในชุดนี้ — ไปดูที่รายการใบ</div>' +
      '<div class="grid2" style="margin-top:10px">' +
        block("1. จุดห้ามส่งซ้ำ", dl([
          ["bank_bulk_order_id", b.bankBulkOrderId || "—"], ["package_ref_no", b.packageRefNo || "—"],
          ["confirmed_at", b.confirmedAt ? fmtDT(b.confirmedAt) + " — เงินอาจออกแล้ว" : "—"],
          ["failure_reason", b.failureReason || "—"]
        ])) +
        block("2. บัญชีต้นทางของชุด", dl([["เลขบัญชี", SOURCE.accountNo + " · " + SOURCE.bankName + " " + SOURCE.bankCode], ["ผูกตอนเปิดชุด", "bank_account_id ของแถวชุด"]])) +
        block("3. เงินสามก้อน ห้ามปน", dl([
          ["ยอดโอน", money(b.totalAmount)], ["ค่าบริการร้านในชุด", money(reserved, 4)],
          ["ค่าโอนธนาคารที่เกิดแล้ว", money(b.bankFeeIncurred) + " = ใบข้ามธนาคารที่คิดแล้ว × 5.00"],
          ["ค่าเสนอทั้งชุด total_fee", b.totalFeeQuoted == null ? "ยังไม่ทราบ" : money(b.totalFeeQuoted)]
        ])) +
        block("4. ความคืบหน้าใบในชุด", '<div class="body">' +
          (items.length ? ["PROCESSING", "COMPLETED", "FAILED", "NEEDS_REVIEW"].map(function (s) {
            const n = items.filter(function (p) { return p.status === s; }).length;
            return "<div>" + statusLabel(s) + " " + n + "</div>";
          }).join("") : '<div class="s">ตารางลูกว่าง — ชุด FAILED ปล่อยใบกลับคิวแล้ว</div>') +
        "</div>") +
      "</div>" +
      '<section class="zone"><h2>5. ใบในชุดนี้</h2><div class="body" style="overflow:auto">' +
        (items.length ? tablePayouts(items, { hideBatch: true }) : '<div class="empty">ไม่มีใบค้างในชุดนี้</div>') +
      "</div></section>" +
      '<section class="zone"><h2>6. ไทม์ไลน์ชุด</h2><div class="body">' +
        "<div>" + fmtDT(b.createdAt) + " เปิดชุด PENDING</div>" +
        (b.sentAt ? "<div>" + fmtDT(b.sentAt) + " เริ่มส่ง SENDING</div>" : "") +
        (b.bankBulkOrderId ? "<div>เขียน bank_bulk_order_id — จุดห้ามส่งซ้ำ</div>" : "") +
        (b.confirmedAt ? "<div>" + fmtDT(b.confirmedAt) + " ธนาคารรับชุด</div>" : "") +
        (b.settledAt ? "<div>" + fmtDT(b.settledAt) + " ปิดชุด SETTLED</div>" : '<div class="legend">ยังไม่มี settled_at</div>') +
      "</div></section>";
    document.getElementById("backB").onclick = function (e) { e.preventDefault(); go("batches"); };
    bindTableNav();
  }


  const PAGE_FILES = {
    overview: "overview.html",
    list: "payouts.html",
    detail: "payout-detail.html",
    batches: "batches.html",
    batch: "batch-detail.html"
  };
  const PAGE = document.body.getAttribute("data-page") || "overview";

  function saveState() {
    try {
      sessionStorage.setItem("p7a-mock", JSON.stringify({
        from: state.from, to: state.to, merchantId: state.merchantId, route: state.route,
        statuses: state.statuses, q: state.q, recipientAccount: state.recipientAccount,
        nameMismatch: state.nameMismatch, batchQ: state.batchQ, batchStatus: state.batchStatus,
        batchStuck: state.batchStuck, listPage: state.listPage, batchPage: state.batchPage,
        selectedRef: state.selectedRef, selectedBatch: state.selectedBatch, preset: state.preset,
        role: state.role, batchId: state.batchId,
        demoSendOff: state.demoSendOff, demoStale: state.demoStale, demoNoSource: state.demoNoSource, demoShort: state.demoShort
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      const raw = sessionStorage.getItem("p7a-mock");
      if (!raw) return;
      const s = JSON.parse(raw);
      Object.keys(s).forEach(function (k) { if (s[k] !== undefined) state[k] = s[k]; });
    } catch (e) {}
  }

  function chromeNav() {
    const on = PAGE === "detail" ? "list" : (PAGE === "batch" ? "batches" : PAGE);
    const admin = isAdmin();
    return '<div class="topbar"><span>MaxPay BO · ต้นแบบ HTML · ข้อมูลจำลอง ไม่ใช่ของจริง</span>' +
      '<div class="viewer">' +
        (admin ? ('<div class="demo-wrap">' +
          '<button type="button" class="demo-btn" id="demoBtn">จำลอง</button>' +
          '<div class="demo-panel" id="demoPanel">' +
            '<div class="demo-panel-k">สถานะจำลอง · ไม่ใช่ตัวกรองของคนใช้จริง</div>' +
            '<label><input type="checkbox" id="demoSendOff"' + (state.demoSendOff ? " checked" : "") + "> send ปิด</label>" +
            '<label><input type="checkbox" id="demoStale"' + (state.demoStale ? " checked" : "") + "> ยอดเก่า</label>" +
            '<label><input type="checkbox" id="demoNoSource"' + (state.demoNoSource ? " checked" : "") + "> ไม่มีบัญชีต้นทาง</label>" +
            '<label><input type="checkbox" id="demoShort"' + (state.demoShort ? " checked" : "") + "> ยอดไม่พอคิว</label>" +
          "</div></div>") : "") +
        '<label class="role">มุมมอง <select id="roleSel">' +
          '<option value="admin"' + (admin ? " selected" : "") + ">แพลตฟอร์มแอดมิน</option>" +
          '<option value="merchant"' + (!admin ? " selected" : "") + ">ร้าน Acme (DIRECT)</option>" +
        "</select></label>" +
        '<span id="clock"></span></div></div>' +
      '<div class="shell"><aside class="nav">' +
        '<div class="brand">MaxPay BO</div>' +
        '<a href="overview.html" class="nav-main">โอนออก</a>' +
        '<a href="overview.html" class="sub' + (on === "overview" ? " active" : "") + '">ภาพรวม</a>' +
        '<a href="payouts.html" class="sub' + (on === "list" ? " active" : "") + '">รายการใบถอน</a>' +
        (admin ? '<a href="batches.html" class="sub' + (on === "batches" ? " active" : "") + '">ชุดโอน</a>' : "") +
        '<div class="dim">เฟสถัดไป</div><span class="ghost">รับเงิน</span><span class="ghost">สมุดบัญชี</span>' +
      '</aside><main id="app"></main></div>';
  }

  function go(page) {
    state.page = page;
    state.comboOpen = false;
    saveState();
    let q = "";
    if (page === "detail" && state.selectedRef) q = "?ref=" + encodeURIComponent(state.selectedRef);
    if (page === "batch" && state.selectedBatch) q = "?id=" + encodeURIComponent(state.selectedBatch);
    location.href = PAGE_FILES[page] + q;
  }

  function render() {
    saveState();
    const clock = document.getElementById("clock");
    if (clock) clock.textContent = "ขณะนี้จำลอง " + fmtDT(NOW) + " น. (เวลาไทย) · ใบ " + payouts.length + " · ชุด " + batches.length + " · ร้าน " + directs.length;
    if (PAGE === "overview") renderOverview();
    if (PAGE === "list") renderList();
    if (PAGE === "detail") renderDetail();
    if (PAGE === "batches") renderBatches();
    if (PAGE === "batch") renderBatch();
  }

  loadState();
  const params = new URLSearchParams(location.search);
  if (params.get("ref")) state.selectedRef = params.get("ref");
  if (params.get("id")) state.selectedBatch = params.get("id");
  if (params.get("role") === "merchant" || params.get("role") === "admin") state.role = params.get("role");
  document.body.insertAdjacentHTML("afterbegin", chromeNav());
  document.querySelectorAll(".nav a").forEach(function (a) {
    a.addEventListener("click", function () { saveState(); });
  });
  function demoCount() {
    return [state.demoSendOff, state.demoStale, state.demoNoSource, state.demoShort].filter(Boolean).length;
  }
  function refreshDemoBtn() {
    const btn = document.getElementById("demoBtn");
    if (!btn) return;
    const n = demoCount();
    btn.textContent = n ? "จำลอง · " + n : "จำลอง";
    btn.classList.toggle("on", n > 0);
  }
  const roleSel = document.getElementById("roleSel");
  if (roleSel) roleSel.onchange = function () { state.role = roleSel.value; saveState(); location.reload(); };
  const demoBtn = document.getElementById("demoBtn");
  const demoPanel = document.getElementById("demoPanel");
  if (demoBtn && demoPanel) {
    demoBtn.onclick = function (e) { e.stopPropagation(); demoPanel.classList.toggle("open"); };
  }
  refreshDemoBtn();
  ["demoSendOff", "demoStale", "demoNoSource", "demoShort"].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.onchange = function () { state[id] = el.checked; saveState(); refreshDemoBtn(); render(); };
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".combo-wrap")) { if (state.comboOpen) { state.comboOpen = false; render(); } }
    if (demoPanel && !e.target.closest(".demo-wrap")) demoPanel.classList.remove("open");
  });
  if (!sessionStorage.getItem("p7a-mock")) applyPreset("today");
  render();

})();
