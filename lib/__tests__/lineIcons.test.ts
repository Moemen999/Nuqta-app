import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * الأيقونات في الواجهة (قرار مؤمن 2026-11-07: «الأيقونات في الواجهة بس»): التابات وصفوف الإعدادات من `LineIcon` —
 * مفيش إيموجي يرجع فيهم. أيقونة الفئة **برّه** القرار (إيموجي المستخدم)، فالفحص على الملفين دول بس.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const code = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

it.each(['app/(tabs)/_layout.tsx', 'app/(tabs)/settings.tsx'])('%s: مفيش إيموجي في الكود، والأيقونات من LineIcon', (f) => {
  const src = code(read(f));
  expect(src.match(/\p{Extended_Pictographic}/gu) ?? []).toEqual([]);
  expect(src).toContain("from '@/components/LineIcon'");
});

it('التابة المختارة مليانة والباقي خطي (كل تابة ليها الاتنين)', () => {
  const pairs = [...read('app/(tabs)/_layout.tsx').matchAll(/name=\{\['([\w-]+)', '([\w-]+)'\]\}/g)].map(m => [m[1], m[2]]);
  expect(pairs).toHaveLength(5);
  for (const [outline, filled] of pairs) expect(outline).toBe(`${filled}-outline`);
});

it('سهم الخروج بيتقلب مع RTL (visual-identity-reviewer)', () => {
  const { MIRRORED_ICONS } = require('@/components/LineIcon');
  expect(MIRRORED_ICONS.has('log-out-outline')).toBe(true);
  expect(read('app/(tabs)/settings.tsx')).toContain('mirrored={MIRRORED_ICONS.has(ROW_ICON[row.key])}');
});
