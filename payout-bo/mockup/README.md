# HTML mock — ให้ AI อื่นใช้

เปิด `index.html` ก่อน

- หน้าโต้ตอบได้ (มีตัวกรอง / สลับบทบาท): `overview.html` `payouts.html` `payout-detail.html` `batches.html` `batch-detail.html` ใช้ `js/app.js`
- สแนปชอตมาร์กอัปเต็ม (อ่าน DOM ได้เลย ไม่ต้องรัน JS): `snapshots/`

สลับมุมร้าน: มุมบนขวา หรือ `overview.html?role=merchant`

ของบ้านที่ร้านห้ามเห็น: โซน 1, ค่าโอนธนาคาร 5 บาท, หน้าชุด, คู่ 4, ตารางร้านที่ต้องดู  
สมุดร้าน (DIRECT ร้านเดียว): ใช้ได้ = `MERCHANT_OPERATE` · กันถอน = `MERCHANT_PENDING_PAYOUT`

สูตรเงินหลักอยู่ใน `payout-bo/app/` (React) ไม่ใช่ใน `app.js`
