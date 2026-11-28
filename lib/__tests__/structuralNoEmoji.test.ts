import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 9.5-5: إيموجي الهيكل (العلامات جنب التاريخ، عناوين كروت «مستنيين ردك»، علامة «اتسجل») بقى `LineIcon`.
 * الإيموجي بيترسم بخط الموبايل وألوانه مش ألوان الثيم، وقارئ الشاشة بيقرا اسمه قبل الكلام.
 * **مش هنا:** أيقونة الفئة (إيموجي اختاره المستخدم — `CATEGORY_ICONS`)، وأيقونات أقسام دليل الاستخدام.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
// إيموجي الصور + الرموز المتنوعة (ساعة رملية، ترس، سهم الاتجاهين، علامة صح) — الأسهم العادية في التعليقات مسموحة.
// ✕ (U+2715) برّه عن قصد: التعليقات بتسمّي بيه زرار الإغلاق (`DismissButton`)
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2194}\u{2300}-\u{23FF}\u{2600}-\u{2714}\u{2716}-\u{27BF}\u{2B00}-\u{2BFF}\u{200D}\u{FE0F}]/u;

const FILES = [
  'components/MutedMark.tsx',
  'components/PendingSyncMark.tsx',
  'components/AutoRecordedMark.tsx',
  'components/TransferMark.tsx',
  'components/ChargeHomeCards.tsx',
  'components/IncomeHomeCards.tsx',
];

describe('مفيش إيموجي في الهيكل', () => {
  it.each(FILES)('%s: مفيش إيموجي', (f) => {
    const hit = read(f).match(EMOJI);
    expect(hit?.[0] ?? null).toBeNull();
  });
  it.each(['PendingSyncMark', 'AutoRecordedMark', 'TransferMark'])('%s على MutedMark (أيقونة خطية)', (name) => {
    expect(read(`components/${name}.tsx`)).toContain('<MutedMark icon=');
  });
  it('عناوين الكروت وعلامة «اتسجل» بـLineIcon', () => {
    for (const f of ['components/ChargeHomeCards.tsx', 'components/IncomeHomeCards.tsx']) {
      const src = read(f);
      expect(src).toContain('checkmark-circle-outline');
      expect(src).toMatch(/<View style=\{styles\.titleRow\}>\s*<View style=\{styles\.titleIcon\}><LineIcon/);
    }
  });
});
