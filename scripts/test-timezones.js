/**
 * بيشغّل اختبارات الحسابات في كذا توقيت حقيقي مختلف.
 *
 * ليه سكريبت لوحده؟ لأن التوقيت بيتقري مرة واحدة وقت ما البروسيس يشتغل — وتغيير
 * process.env.TZ جوه الاختبار نفسه مبيأثرش (جيست بيدي كل ملف نسخة معزولة من
 * process فالتغيير مبيوصلش للنظام). فالطريقة الوحيدة الصادقة إننا نشغّل جيست
 * نفسه من الأول وكل مرة بتوقيت مختلف.
 *
 * التوقيتات المختارة: القاهرة (المستخدمين الحقيقيين + توقيت صيفي)، UTC (أجهزة
 * الـ CI)، توقيت قبل UTC، وتوقيت بفرق نص ساعة.
 */
const { spawnSync } = require('child_process');
const path = require('path');

// السكريبت بيتشغّل من npm فمجلد التشغيل هو جذر المشروع
const projectRoot = process.cwd();

const TIMEZONES = ['Africa/Cairo', 'UTC', 'America/New_York', 'Asia/Kathmandu'];
// بننادي ملف جيست مباشرةً بدل require.resolve لأن باكدج جيست مش مصدّر المسار ده
const jestBin = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
const target = process.argv[2] || 'lib/__tests__';

let failed = false;
for (const TZ of TIMEZONES) {
  process.stdout.write(`\n=== الاختبارات بتوقيت ${TZ} ===\n`);
  const res = spawnSync(process.execPath, [jestBin, target, '--silent'], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env, TZ },
  });
  if (res.status !== 0) failed = true;
}

if (failed) {
  process.stdout.write('\nفيه اختبارات فشلت في توقيت واحد على الأقل\n');
  process.exit(1);
}
process.stdout.write('\nكل الاختبارات عدّت في كل التوقيتات\n');
