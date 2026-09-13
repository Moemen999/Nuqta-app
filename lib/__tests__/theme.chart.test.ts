import { DARK, LIGHT, type ThemeColors } from '@/context/ThemeContext';
import { hashColor } from '@/lib/finance';
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

  it('فيها 8 ألوان', () => {
    expect(colors.chartPalette).toHaveLength(8);
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

describe('hashColor', () => {
  it('نفس الاسم بيدّي نفس اللون دايمًا', () => {
    expect(hashColor('المواصلات', LIGHT.chartPalette)).toBe(hashColor('المواصلات', LIGHT.chartPalette));
  });

  it('بيرجّع لون من الباليتة اللي اتبعتت بس', () => {
    for (const name of ['المواصلات', 'أكل', 'CIB', 'NBE', 'CASH', 'فاتورة', 'x', '']) {
      expect(LIGHT.chartPalette).toContain(hashColor(name, LIGHT.chartPalette));
      expect(DARK.chartPalette).toContain(hashColor(name, DARK.chartPalette));
    }
  });

  it('نفس الاسم بياخد نفس الخانة في الثيمين — فاللون بيفضل هو هو لما الثيم يتغيّر', () => {
    for (const name of ['المواصلات', 'أكل', 'السوبرماركت']) {
      const li = LIGHT.chartPalette.indexOf(hashColor(name, LIGHT.chartPalette));
      const di = DARK.chartPalette.indexOf(hashColor(name, DARK.chartPalette));
      expect(li).toBe(di);
    }
  });

  it('الأسماء العربية المختلفة بتتوزّع على أكتر من لون', () => {
    const names = ['المواصلات', 'الفطار', 'السوبرماركت', 'أكل', 'أخرى', 'مواصلات', 'فاتورة', 'إيجار'];
    const used = new Set(names.map(n => hashColor(n, LIGHT.chartPalette)));
    expect(used.size).toBeGreaterThan(1);
  });
});
