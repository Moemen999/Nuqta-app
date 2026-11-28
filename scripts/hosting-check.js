#!/usr/bin/env node
// فحص صفحات Firebase Hosting قبل النشر (بيتنادى لوحده من `predeploy` في firebase.json).
// بيرفض النشر لو فيه خانة لسه ما اتملتش ({{DEVELOPER_NAME}} أو {{CONTACT_EMAIL}}):
// الصفحتين دول بيتحطوا في Google Play، وصفحة بخانة فاضية = رفض أو مستخدم مش عارف يوصل لنا.
// الأسامي والإيميل مش في الريبو عن قصد — مؤمن بيحطهم وقت النشر (CLAUDE.md: البيانات الشخصية).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'hosting', 'public');
let bad = 0;
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.html'))) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const left = [...new Set(text.match(/\{\{[A-Z_]+\}\}/g) || [])];
  if (left.length) { bad++; console.error(`✗ ${f}: لسه فيه ${left.join('، ')}`); }
}
if (bad) {
  console.error('\nاملا الخانات دي قبل النشر (شوف reports/2026-11-26-play-store-privacy.md).');
  process.exit(1);
}
console.log('✓ صفحات الاستضافة مفيهاش خانات فاضية');
