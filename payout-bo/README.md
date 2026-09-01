# P7a — หน้า BO โอนออก

ชุดเอกสารและต้นแบบจอของภาพรวม / รายการใบ / ชุดโอน

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [docs/design.md](docs/design.md) | สเปกที่ยึดถือ |

สรุปเฟส: [`docs/spec-summaries/06-p7a-payout-bo-dashboard.md`](../docs/spec-summaries/06-p7a-payout-bo-dashboard.md)

## ต้นแบบที่ให้ agent ทำงานต่อ

Vite + React ใน [`app/`](app/) แยกไฟล์ตามหน้าและโซน

```
cd payout-bo/app
npm install
npm run dev
```

เปิด `http://localhost:5173` → `/payouts/overview`

| โฟลเดอร์ | ใครแก้ |
|---|---|
| `app/src/mock/` | ข้อมูลจำลอง + สูตรนับ |
| `app/src/lib/` | เงิน วันที่ สถานะ |
| `app/src/state/` | ตัวกรองร่วมภาพรวม/รายการใบ |
| `app/src/layout/` | ไซด์บาร์ แถบวันที่/ร้าน |
| `app/src/features/overview/` | โซน 1–3 + ร้านที่ต้องดู |
| `app/src/features/payouts/` | ตารางใบ สรุป ตัวกรองใบ |
| `app/src/features/batches/` | ตารางชุด ตัวกรองชุด |
| `app/src/pages/` | ประกอบหน้า ไม่คำนวณสูตรเอง |

## HTML เดิม (ของเทียบจอ — ไม่แก้ต่อ)

[`mockup/`](mockup/) เปิดไฟล์ตรงๆ ได้ แต่ **อย่าต่อโค้ดจาก `mockup/js/app.js`**
