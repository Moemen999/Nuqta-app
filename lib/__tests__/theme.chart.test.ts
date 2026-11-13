import { DARK, LIGHT, type ThemeColors } from '@/context/ThemeContext';
import { validate, type PaletteCheck } from '@/test-utils/validatePalette';

/**
 * ألوان الرسوم متقاسة مش متشافة بالعين.
 *
 * الباليتة القديمة كانت فاشلة في أربع فحوصات:
 * - 6 من 8 ألوان تحت حد التشبّع (بتتقري رمادي)
 * - التفريق عند عمى الألوان 4.2 والحد 8
 * - وحتى بعين سليمة تمامًا أقرب لونين بينهم 10.3 والحد 15
 * - وكلهم تحت 3:1 على الخلفية الفاتحة
 */

type Mode = 'light' | 'dark';

/** CIE76 ΔE في Lab (D65) — أصغر مسافة بين أي لونين في الباليتة */
function lab(hex: string): number[] {
  const lin = [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const x = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function minPairDeltaE(p: string[]): number {
  let min = Infinity;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const a = lab(p[i]), b = lab(p[j]);
    min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return min;
}

/** كل خلفية بتتعرض عليها ألوان الرسوم فعلاً — شرايح التقارير والنقط */
const SURFACES: Record<Mode, { colors: ThemeColors; surfaces: string[] }> = {
  light: { colors: LIGHT, surfaces: [LIGHT.bg, LIGHT.surface, LIGHT.surface2] },
  dark: { colors: DARK, surfaces: [DARK.bg, DARK.surface, DARK.surface2] },
};

function report(mode: Mode, surface: string) {
  return validate(SURFACES[mode].colors.chartPalette, { mode, surface });
}

/**
 * الفاحص بيرجّع { report, ok } و report مصفوفة [الاسم، الحالة، التفاصيل].
 * الحالة بتيجي بوليان في بعض الفحوصات ونص في التانية، فبنوحّدها.
 */
type State = 'pass' | 'fail' | 'warn';

function stateOf(raw: boolean | string): State {
  if (raw === true || raw === 'pass') return 'pass';
  if (raw === false || raw === 'fail') return 'fail';
  return 'warn'; // relief / floor
}

const rows = (r: any): PaletteCheck[] => r.report;
const failures = (r: any) => rows(r).filter(([, st]) => stateOf(st) === 'fail').map(([n, , d]) => `${n}: ${d}`);
const notPassing = (r: any) => rows(r).filter(([, st]) => stateOf(st) !== 'pass').map(([n, st, d]) => `${n} (${st}): ${d}`);

describe.each(['light', 'dark'] as Mode[])('باليتة الرسوم — الوضع %s', mode => {
  const { colors, surfaces } = SURFACES[mode];

  it.each(surfaces)('بتعدّي كل الفحوصات على خلفية %s', surface => {
    const r = report(mode, surface);
    expect(failures(r)).toEqual([]);
  });

  it.each(surfaces)('ولا حتى تحذير على خلفية %s', surface => {
    // التباين تحت 3:1 بيعدّي كتحذير مش فشل، بس إحنا عايزينه نضيف خالص
    expect(notPassing(report(mode, surface))).toEqual([]);
  });

  it('فيها 12 لون', () => {
    expect(colors.chartPalette).toHaveLength(12);
  });

  it('أي لونين (مش الجيران بس) بينهم CIE76 ΔE ≥ 15 — الباليتة الأكبر مخلّتش لونين يشبهوا بعض', () => {
    expect(minPairDeltaE(colors.chartPalette)).toBeGreaterThanOrEqual(15);
  });

  it('مفيش لون مكرر', () => {
    expect(new Set(colors.chartPalette).size).toBe(colors.chartPalette.length);
  });
});

describe('الثيمين مختلفين عن بعض', () => {
  it('الغامق مش نسخة من الفاتح', () => {
    // القلب الآلي بيطلّع ألوان مش متقاسة — كل نسخة متختارة لخلفيتها
    expect(DARK.chartPalette).not.toEqual(LIGHT.chartPalette);
  });
});
