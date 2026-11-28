// 9.5-6: الكروت دي كان عليها إطار ديكور واتشال (قرار مؤمن 2026-11-28: «الحدود على
// الكروت بس»، والجرد في reports/2026-11-28-borders-inventory.md — الفئة A).
// الكارت بيبان بفرق السطح عن الخلفية، وفي الفاتح بـcardElevation.
// الحارس بيقرا سطر الستايل نفسه: لو الإطار رجع، بيقع باسم الملف والستايل.
// ListEmptyState مش هنا عن قصد: في الفاتح surface2 تقريبًا نفس الخلفية، ومستنية الموبايل.
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

// [الملف، اسم الستايل، لازم فيه cardElevation؟]
const CARDS: [string, string, boolean][] = [
  ['app/dev-seed.tsx', 'card', true],
  ['app/person-ledger.tsx', 'debtBlock', true],
  ['app/user-guide.tsx', 'card', false],
  ['components/ArchivedSettlement.tsx', 'card', false],
  ['components/ArchiveSheet.tsx', 'itemCard', false],
  ['components/ChargeHomeCards.tsx', 'notice', true],
  ['components/IncomeHomeCards.tsx', 'notice', true],
];

// نص الستايل من `name: {` لحد القوس اللي بيقفله
function styleBody(src: string, name: string): string {
  const m = new RegExp(`\\n\\s+${name}: \\{`).exec(src);
  if (!m) throw new Error(`مش لاقي الستايل ${name}`);
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1);
  }
  throw new Error(`الستايل ${name} مش مقفول`);
}

describe('كروت الديكور من غير إطار (9.5-6)', () => {
  it.each(CARDS)('%s — %s', (file, name, elevated) => {
    const body = styleBody(readFileSync(join(ROOT, file), 'utf8'), name);
    expect(body).not.toMatch(/border(Width|Color)/);
    if (elevated) expect(body).toContain('cardElevation(c)');
  });

  it('رسالة الخطأ في «سجلنا لوحدنا» لسه بإطار أحمر — ده معنى مش ديكور', () => {
    for (const file of ['components/ChargeHomeCards.tsx', 'components/IncomeHomeCards.tsx']) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src).toContain("n.kind === 'error' && { borderWidth: 1, borderColor: colors.dangerBorder }");
    }
  });
});
