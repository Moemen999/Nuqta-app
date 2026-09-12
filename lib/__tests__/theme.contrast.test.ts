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
