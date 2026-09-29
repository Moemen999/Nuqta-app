import { DARK, LIGHT, type ThemeColors } from '@/context/ThemeContext';

/**
 * نسبة التباين بمعادلة WCAG. الهدف مننا: العنصر المختار يبان بالتأكيد،
 * مش "شكله باين" بالعين — عشان كده النسب مكتوبة كاختبارات هنا.
 *
 * الحدود اللي بنمشي عليها:
 * - إطار المختار ضد أي خلفية بيقف عليها: 3:1 (حد WCAG للعناصر غير النصية)
 * - إطار المختار ضد إطار غير المختار: 3:1 — عشان الفرق نفسه يبان
 * - إطار المختار ضد خلفية المختار: 3:1 — عشان الإطار ميضيعش في التينت
 * - النص فوق خلفية المختار: 4.5:1 (حد النص العادي)
 */
function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const NON_TEXT_MIN = 3;
const TEXT_MIN = 4.5;

/** الخلفيات اللي عناصر الاختيار بتقف عليها فعلاً في التطبيق */
const surfacesOf = (c: ThemeColors) => ({ bg: c.bg, nav: c.nav, surface: c.surface, surface2: c.surface2 });

const TONES = ['accent', 'success', 'danger'] as const;

function toneColors(c: ThemeColors, tone: (typeof TONES)[number]) {
  if (tone === 'success') return { border: c.selectedSuccessBorder, bg: c.selectedSuccessBg };
  if (tone === 'danger') return { border: c.selectedDangerBorder, bg: c.selectedDangerBg };
  return { border: c.selectedBorder, bg: c.selectedBg };
}

describe.each([
  ['الفاتح', LIGHT],
  ['الغامق', DARK],
])('تباين الاختيار — الوضع %s', (_label, colors) => {
  describe.each(TONES)('نبرة %s', tone => {
    const { border, bg } = toneColors(colors, tone);

    it.each(Object.entries(surfacesOf(colors)))('الإطار باين على خلفية %s', (_name, surface) => {
      expect(contrast(border, surface)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    });

    it('الإطار مختلف بوضوح عن إطار العنصر غير المختار', () => {
      expect(contrast(border, colors.borderStrong)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    });

    it('الإطار مش ضايع في خلفية المختار', () => {
      expect(contrast(border, bg)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    });

    it('النص مقروء فوق خلفية المختار', () => {
      expect(contrast(colors.text, bg)).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  });
});

describe('اللي كان قبل الإصلاح', () => {
  it('الإطار الدهبي القديم كان أقل من الحد في الوضع الفاتح', () => {
    // موثّق كاختبار عشان ما نرجعش له بالغلط
    expect(contrast(LIGHT.accent, LIGHT.bg)).toBeLessThan(NON_TEXT_MIN);
    expect(contrast(LIGHT.accent, LIGHT.borderStrong)).toBeLessThan(NON_TEXT_MIN);
  });

  it('والوضع الغامق مكانش فيه المشكلة دي', () => {
    expect(contrast(DARK.accent, DARK.bg)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });
});

/**
 * الدهبي كنص (2026-09-29): كلام البانرات ومبلغ السحب. `accent` نفسه على الكريمي
 * كان 2.2:1 — `accentText` لازم يعدّي حد النص على كل خلفية بيقف عليها.
 */
describe('accentText — الدهبي كنص', () => {
  it.each([['DARK', DARK], ['LIGHT', LIGHT]] as const)('%s: فوق 4.5:1 على bg وsurface وnav', (_n, c) => {
    for (const bgc of [c.bg, c.surface, c.nav]) expect(contrast(c.accentText, bgc)).toBeGreaterThanOrEqual(TEXT_MIN);
  });
  it('مش لون جديد: في الفاتح هو selectedBorder، وفي الغامق هو accent', () => {
    expect(LIGHT.accentText).toBe(LIGHT.selectedBorder);
    expect(DARK.accentText).toBe(DARK.accent);
  });
});

/**
 * حارس المصدر: الدهبي **كنص** بـ`accentText` بس. `accent` للتعبئة والإطار
 * والأيقونة — كنص على الكريمي 2.2:1. اتلقى في 15 مكان بعد ما اتصلح في 3.
 */
it('مفيش color: accent في app/ وcomponents/ — النص الدهبي accentText', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e: any) =>
    e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.tsx') ? [path.join(d, e.name)] : []);
  const offenders = ['app', 'components'].flatMap(d => walk(path.join(root, d)))
    .filter(f => /color: (c|colors).accent/.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(root, f));
  expect(offenders).toEqual([]);
});

/**
 * مبالغ المصروف والدخل (2026-09-29): كانت 2.99:1 و2.59:1 في الفاتح. لازم تعدّي
 * حد النص في الثيمين، والغامق مايتغيرش، ومن الباليتة الموجودة بس.
 */
describe('expenseText / incomeText — مبالغ كل سطر', () => {
  it.each([['DARK', DARK], ['LIGHT', LIGHT]] as const)('%s: فوق 4.5:1 على bg وsurface وnav', (_n, c) => {
    for (const bgc of [c.bg, c.surface, c.nav]) {
      expect(contrast(c.expenseText, bgc)).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(contrast(c.incomeText, bgc)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });
  it('مش ألوان جديدة: الفاتح من الباليتة، والغامق زي ما كان', () => {
    expect(LIGHT.expenseText).toBe(LIGHT.selectedDangerBorder);
    expect(LIGHT.incomeText).toBe(LIGHT.selectedSuccessBorder);
    expect(DARK.expenseText).toBe('#D97878');
    expect(DARK.incomeText).toBe('#7FA98F');
  });
  it('transactionAmountColor من الثيم للأنواع التلاتة — مش من TYPE_LABELS', () => {
    const { transactionAmountColor } = require('@/lib/finance');
    for (const c of [DARK, LIGHT]) {
      expect(transactionAmountColor('expense', c)).toBe(c.expenseText);
      expect(transactionAmountColor('income', c)).toBe(c.incomeText);
      expect(transactionAmountColor('withdraw', c)).toBe(c.accentText);
    }
  });
  it('الرئيسية والأرشيف بياخدوا لون المبلغ من transactionAmountColor بس', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..');
    for (const f of ['app/(tabs)/index.tsx', 'app/archive.tsx']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect({ f, usesHelper: src.includes('transactionAmountColor(t.type, colors)'), usesConst: /\bT\.color\b/.test(src) })
        .toEqual({ f, usesHelper: true, usesConst: false });
    }
  });
});
