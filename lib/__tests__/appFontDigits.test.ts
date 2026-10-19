import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { APP_FONT } from '@/lib/appFont';

/**
 * أرقام المبالغ لازم تقف تحت بعض: كل رقم من 0 لـ9 بنفس العرض في ملف الخط نفسه.
 *
 * ليه من الملف ومش من `fontVariant: ['tabular-nums']`: الطلب ده بيتجاهَل ساكت لو
 * الخط مفيهوش `tnum` — Tajawal مثلاً مكانش فيه، وأرقامه من 375 لـ553 وحدة، فكان
 * "1,111" و"8,888" هيطلعوا بعرضين مختلفين في عمود المبالغ. التطبيق بيعرض أرقام
 * لاتيني بس (`fmt` بـ'en-US'، lib/finance.ts)، فده اللي بيتقاس.
 *
 * الملفات بتتلاقي من `lib/appFontSources.ts` نفسه (الاستيراد ← ملف الـttf)،
 * فأي تبديل خط جاي بيتقاس هنا من غير ما حد يفتكر يعدّل الاختبار.
 */

/** عرض كل حرف من الخط (cmap 4/12 + hmtx) — قراية بس */
function advanceWidths(ttf: Buffer, codePoints: number[]): (number | null)[] {
  const u16 = (o: number) => ttf.readUInt16BE(o), i16 = (o: number) => ttf.readInt16BE(o), u32 = (o: number) => ttf.readUInt32BE(o);
  const tables: Record<string, number> = {};
  for (let i = 0; i < u16(4); i++) tables[ttf.toString('ascii', 12 + i * 16, 16 + i * 16)] = u32(20 + i * 16);
  const cmap = tables.cmap;
  let f4 = 0, f12 = 0;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const sub = cmap + u32(cmap + 8 + i * 8), fmt = u16(sub);
    if (fmt === 4 && !f4) f4 = sub;
    if (fmt === 12 && !f12) f12 = sub;
  }
  const glyph = (cp: number): number => {
    if (f12) {
      for (let i = 0; i < u32(f12 + 12); i++) {
        const o = f12 + 16 + i * 12;
        if (cp >= u32(o) && cp <= u32(o + 4)) return u32(o + 8) + cp - u32(o);
      }
      return 0;
    }
    const segX2 = u16(f4 + 6), ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ro = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      if (cp > u16(ends + 2 * i)) continue;
      const start = u16(starts + 2 * i);
      if (cp < start) return 0;
      const delta = i16(deltas + 2 * i), rOff = u16(ro + 2 * i);
      if (!rOff) return (cp + delta) & 0xffff;
      const g = u16(ro + 2 * i + rOff + 2 * (cp - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const numHMetrics = u16(tables.hhea + 34);
  return codePoints.map(cp => {
    const g = glyph(cp);
    return g ? u16(tables.hmtx + 4 * Math.min(g, numHMetrics - 1)) : null;
  });
}

const ROOT = join(__dirname, '..', '..');
const sources = readFileSync(join(ROOT, 'lib', 'appFontSources.ts'), 'utf8');
/** اسم ملف الخط ← مساره، من سطور الاستيراد في appFontSources.ts */
const shipped = [...sources.matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'([^']+)'/g)]
  .filter(([, , from]) => !from.startsWith('@/'))
  .map(([, name, from]) => ({ name, file: join(dirname(require.resolve(`${from}/index.js`)), `${name}.ttf`) }));

const LATIN_DIGITS = Array.from({ length: 10 }, (_, d) => 0x30 + d);

describe('ملفات الخط اللي بتتشحن', () => {
  it('كل اسم في APP_FONT ليه ملف مستورد في appFontSources.ts', () => {
    expect(shipped.map(s => s.name).sort()).toEqual(Object.values(APP_FONT).sort());
  });

  it.each(shipped.map(s => [s.name, s.file]))('%s: الأرقام اللاتيني من 0 لـ9 كلها بنفس العرض', (_name, file) => {
    const widths = advanceWidths(readFileSync(file), LATIN_DIGITS);
    expect(widths.every(w => w !== null)).toBe(true);
    expect(new Set(widths).size).toBe(1);
  });
});
