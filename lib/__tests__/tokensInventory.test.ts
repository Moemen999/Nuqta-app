import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * جرد التوكنز (موجة البريميم 2 — الدفعة الأخيرة): التطبيق كله (`app/**` و`components/**`، ملفات `.tsx`)
 * مفيش فيه `fontSize` ولا `borderRadius` ولا `lineHeight` برقم حرفي — المقاسات من `typeScale` و`radius` و`glyphSize` و`leading`
 * في `lib/tokens.ts`. المسح تلقائي، فأي ملف جديد بيتفحص من غير ما حد يضيفه لقايمة.
 */
const root = join(__dirname, '..', '..');

/** استثناءات صريحة (ملف ← السبب). فاضية دلوقتي: `HeroAmount`/`Money` مفيهمش أرقام حرفية أصلاً، و`tabLabelStyle` في `lib/`. */
const ALLOWLIST: Record<string, string> = {};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p);
    return p.endsWith('.tsx') ? [relative(root, p).split('\\').join('/')] : [];
  });
}

const FILES = [...walk(join(root, 'app')), ...walk(join(root, 'components'))].filter((f) => !(f in ALLOWLIST));

it('المسح لاقى ملفات', () => {
  expect(FILES.length).toBeGreaterThan(50);
});

describe.each(FILES)('%s', (file) => {
  const src = readFileSync(join(root, file), 'utf8');
  it('مفيش fontSize حرفي', () => {
    expect(src.match(/fontSize:\s*[0-9]/g)).toBeNull();
  });
  it('مفيش borderRadius حرفي', () => {
    expect(src.match(/borderRadius:\s*[0-9]/g)).toBeNull();
  });
  it('مفيش lineHeight حرفي', () => {
    expect(src.match(/lineHeight:\s*[0-9]/g)).toBeNull();
  });
  // درجة السطر من نفس مقاس الخط اللي جنبها: `leading.caption` مع `typeScale.caption`، و`leading.body` مع
  // `typeScale.body` (أو `font.subtitle` = 14). الأوسع (`loose`) لجملة الترحيب بس.
  it('درجة السطر مطابقة لمقاس الخط', () => {
    const bad = src.split('\n').filter((l) =>
      (/lineHeight: leading\.caption/.test(l) && !/typeScale\.caption/.test(l)) ||
      (/lineHeight: leading\.body/.test(l) && !/typeScale\.body|font\.subtitle/.test(l)) ||
      (/lineHeight: leading\.loose/.test(l) && file !== 'components/OnboardingScreen.tsx'));
    expect(bad).toEqual([]);
  });
});
