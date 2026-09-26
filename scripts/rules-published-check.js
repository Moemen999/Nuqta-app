#!/usr/bin/env node
/**
 * القواعد المنشورة في الإنتاج = firestore.rules اللي في الريبو؟
 *
 * قراية بس — مبيغيّرش حاجة. بيستخدم تسجيل دخول Firebase CLI الموجود على الجهاز
 * (`firebase login`)، ومفيش أي بيانات دخول في الملف ده.
 *
 *   node scripts/rules-published-check.js
 *
 * بيطبع تاريخ آخر نشر، وبيخرج بـ 0 لو متطابقين و1 لو مختلفين (مع الفرق).
 *
 * ليه موجود: يوم 2026-09-26 اتضح إن المنشور كان نسخة 7 سبتمبر (7156983)،
 * وتسع تعديلات بعدها ما اتنشرتش — منهم مجموعة `incomes` كلها و`feedback`،
 * فالاتنين كانوا مرفوضين في الإنتاج والاختبارات المحلية خضرا.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = 'nuqta-711f2';
const lines = n => (n === 1 ? 'سطر واحد' : n === 2 ? 'سطرين' : n <= 10 ? `${n} سطور` : `${n} سطر`);
const norm = s => s.replace(/\r/g, '');

(async () => {
  const auth = require('firebase-tools/lib/auth');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const rules = require('firebase-tools/lib/gcp/rules');

  const acct = auth.getGlobalDefaultAccount();
  if (!acct) {
    console.error('مفيش تسجيل دخول لـ Firebase CLI — شغّل: npx firebase login');
    process.exit(2);
  }
  await requireAuth({ project: PROJECT, user: acct.user, tokens: acct.tokens });

  const release = (await rules.listAllReleases(PROJECT)).find(r => r.name.endsWith('/cloud.firestore'));
  if (!release) { console.error('مفيش قواعد Firestore منشورة خالص'); process.exit(1); }
  const [published] = await rules.getRulesetContent(release.rulesetName);
  const repo = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

  console.log(`آخر نشر: ${release.updateTime}`);
  if (norm(published.content) === norm(repo)) {
    console.log('✅ المنشور = firestore.rules اللي في الريبو');
    process.exit(0);
  }
  const a = norm(published.content).split('\n');
  const b = norm(repo).split('\n');
  const onlyPub = a.filter(l => !b.includes(l)).length;
  const onlyRepo = b.filter(l => !a.includes(l)).length;
  console.log(`❌ مختلفين: ${lines(onlyRepo)} في الريبو مش منشورين، و${lines(onlyPub)} منشورين مش في الريبو.`);
  console.log('   التفاصيل: احفظ المنشور وقارن — أو انشر بعد المراجعة (CLAUDE.md، firestore.rules).');
  process.exit(1);
})().catch(e => { console.error('خطأ:', e.message); process.exit(2); });
