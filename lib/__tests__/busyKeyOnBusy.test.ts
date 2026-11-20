import fs from 'fs';
import path from 'path';

/**
 * `useBusyKey()` من غير `onBusy` بيسقّط الدوسة التانية ساكت لو الأولى لسه بتلف (الجولة الأخيرة للدخل، 2026-11-18 —
 * `IncomeHomeCards` و`IncomesView` كانوا كده). كل نداء لازم يدّي `onBusy` (نمط `BUSY_NOTICE` في `lib/useBusy.ts`).
 */
const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['app', 'components', 'lib', 'context'];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

it('مفيش useBusyKey() من غير onBusy', () => {
  const offenders = DIRS.flatMap(d => walk(path.join(ROOT, d)))
    .filter(f => /useBusyKey\(\s*\)/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(ROOT, f));
  expect(offenders).toEqual([]);
});
