import fs from 'fs';
import path from 'path';
import { selectionA11y } from '@/lib/selection';

/**
 * بند E (مراجعة المشروع 2026-11-05): أي عنصر بياخد `selectionStyle` (شكل "مختار") لازم يقول لقارئ الشاشة إنه
 * مختار — `selectionA11y(...)` أو `accessibilityState` في نفس الـtag. قبل كده حوالي 40 شريحة كانت باللون بس.
 * جرد على الكود نفسه زي `appFont.test.tsx`: شريحة جديدة من غير حالة ← الاختبار يقع.
 *
 * **مستثنى مؤقتًا:** `lock.tsx` و`SetLockModal.tsx` — بيتعدّلوا على فرع بند A (مش مدموج)؛ يتشالوا من هنا بعد دمجه.
 */
// شاشات القفل كانت مستثناة لحد دمج بند A (اتدمج 1a19f46) — الاستثناء اتشال

const ROOT = path.join(__dirname, '..', '..');
function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(rel);
    return rel.endsWith('.tsx') ? [rel] : [];
  });
}

it('selectionA11y بيدّي الدور والحالة', () => {
  expect(selectionA11y(true)).toEqual({ accessibilityRole: 'button', accessibilityState: { selected: true } });
  expect(selectionA11y(false, 'tab')).toEqual({ accessibilityRole: 'tab', accessibilityState: { selected: false } });
});

it('كل TouchableOpacity فيه selectionStyle عنده حالة لقارئ الشاشة', () => {
  const offenders: string[] = [];
  let checked = 0;
  for (const f of [...files('app'), ...files('components')]) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let idx: number;
    // `quietSelectionStyle(colors` كمان (دراسة الشكل) — `indexOf` بالـcase، فالـS الكبيرة كانت هتفلت منه
    const re = /[sS]electionStyle\(colors/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(s)) !== null) {
      idx = mm.index;
      const tagStart = s.lastIndexOf('<TouchableOpacity', idx);
      // آخر الـtag = أول '>' برّه الأقواس ({ } و( )) — '=>' جوه onPress مش نهايته
      let tagClose = tagStart, depth = 0;
      for (; tagClose < s.length; tagClose++) {
        const ch = s[tagClose];
        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') depth--;
        else if (ch === '>' && depth === 0) break;
      }
      if (tagStart !== -1) {
        const tag = s.slice(tagStart, tagClose + 1);
        // الـselectionStyle جوه نفس الـtag (مفيش عنصر تاني بدأ بينهم)
        if (!/\n\s*<[A-Za-z]/.test(s.slice(tagStart + 17, idx))) {
          checked++;
          if (!tag.includes('selectionA11y(') && !tag.includes('accessibilityState')) offenders.push(`${f}:${s.slice(0, idx).split('\n').length}`);
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(40);
  expect(offenders).toEqual([]);
});

it('بند E جولة 2: كل TouchableOpacity ليه دور لقارئ الشاشة (أو accessible={false} بقصد)', () => {
  const offenders: string[] = [];
  let checked = 0;
  for (const f of [...files('app'), ...files('components')]) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let idx = 0;
    while ((idx = s.indexOf('<TouchableOpacity', idx)) !== -1) {
      const next = s[idx + '<TouchableOpacity'.length];
      if (next !== ' ' && next !== '\n' && next !== '>') { idx++; continue; }
      let end = idx, depth = 0;
      for (; end < s.length; end++) {
        const ch = s[end];
        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') depth--;
        else if (ch === '>' && depth === 0) break;
      }
      const tag = s.slice(idx, end + 1);
      checked++;
      if (!/accessibilityRole|selectionA11y\(|accessible=\{false\}/.test(tag)) offenders.push(`${f}:${s.slice(0, idx).split('\n').length}`);
      idx = end;
    }
  }
  expect(checked).toBeGreaterThan(150);
  expect(offenders).toEqual([]);
});

it('بند E جولة 2: زرار أيقونة الفئة و"حذف" المحفظة ليهم اسم بيقول بيعملوا إيه، و"حذف" بطول اللمس', () => {
  const cat = fs.readFileSync(path.join(ROOT, 'app/settings-screens/categories.tsx'), 'utf8');
  const wal = fs.readFileSync(path.join(ROOT, 'app/settings-screens/wallets.tsx'), 'utf8');
  expect(cat).toContain('accessibilityLabel={`غيّر أيقونة ${c.name}`}');
  expect(wal).toContain('accessibilityLabel={`امسح محفظة ${w.name}`}');
  expect(wal).toMatch(/deleteBtn: \{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH/);
});
