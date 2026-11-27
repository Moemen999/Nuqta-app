import MutedMark from '@/components/MutedMark';

/** نص العلامة (قرار مؤمن 2026-11-06 على الترشيح) — مصدر واحد للرئيسية والأرشيف */
export const TRANSFER_MARK = 'تحويل — مش محسوب';

/**
 * علامة جنب عملية **تحويل** (سلفة/استلاف وسدادهم، الجمعية — `transferTransactionIds`): ظاهرة في القايمة بفئتها وبتحرّك
 * الرصيد، بس **مش داخلة** في الدخل ولا المصروف ولا الميزانية. من غير العلامة سداد "عليا" القديم بفئة كان بينزل من
 * الميزانية والتقارير ساكت (silent-failure-hunter، لوب 3). نفس هدوء "اتسجلت لوحدها".
 */
export default function TransferMark() {
  return <MutedMark icon="swap-horizontal-outline" text={TRANSFER_MARK} label="تحويل، مش محسوب في الدخل ولا المصروف" />;
}
