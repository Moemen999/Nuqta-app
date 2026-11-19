import { plainAmount } from '@/lib/money';

/** كلمة النوع اللي قارئ الشاشة بيبدأ بيها صف العملية */
export const TX_TYPE_WORD: Record<string, string> = { expense: 'مصروف', income: 'دخل', withdraw: 'تحويل' };

/**
 * اسم صف العملية لقارئ الشاشة — **عقدة واحدة** (الميزة 7 في الرئيسية، والميزة 9 في الأرشيف — a11y-architect): النوع،
 * العنوان، المحفظة والنوت، المبلغ بـ«جنيه»، اليوم والوقت، والعلامات (لسه بترفع / اتسجلت لوحدها / تحويل). نفس الدالة
 * للشاشتين عشان الصف يتقري بنفس الترتيب في الاتنين.
 */
export function txRowLabel(i: {
  type: string; title: string; walletLabel: string; note?: string; amount: number; when: string;
  pending?: boolean; autoRecorded?: boolean; transfer?: boolean;
}): string {
  const typeWord = TX_TYPE_WORD[i.type] ?? i.title;
  const marks = [i.pending && 'لسه بترفع', i.autoRecorded && 'اتسجلت لوحدها', i.transfer && 'تحويل'].filter(Boolean) as string[];
  return [
    i.title === typeWord ? typeWord : `${typeWord}: ${i.title}`,
    i.walletLabel, i.note || '', `${plainAmount(i.amount)} جنيه`, i.when, ...marks,
  ].filter(Boolean).join('، ');
}
