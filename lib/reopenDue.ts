import type { Debt, DebtEntry } from '@/context/DataContext';
import { dateText } from '@/lib/dateText';
import { debtRemaining, isDateStr, PIASTRE_EPS, todayStr } from '@/lib/finance';

/**
 * بند 12 (قرار مؤمن 2026-11-05): زيادة فتحت دين أقساط كان متسدد بتقدّم معاد القسط الجاي (`reopenedDueDate`) —
 * (1) ده بيتقال برسالة، و(2) المعاد القديم بيتخزّن **جوه الزيادة** (`reopenedFrom`، ومعاه `reopenedTo` اللي اتحط)
 * فمسح الزيادة (من شاشة الدين أو بمسح عمليتها) بيرجّعه. قبل كده زوّد/امسح/زوّد كان بيقدّمه كل مرة.
 */

/** «5 ديسمبر»، أو «5 ديسمبر 2027» لو السنة مش سنة `today` (افتراضيًا النهاردة) — `dateText` نفسها */
export function dueDateLabel(iso: string, today: string = todayStr()): string {
  return dateText(iso, today);
}

export const DUE_MOVED_TITLE = 'معاد القسط الجاي اتغيّر';

/** التأكيد قال المعاد هيرجع والذرة (من السيرفر) ما رجّعتوش — الدين اتغيّر من جهاز تاني */
export const DUE_NOT_RESTORED = {
  title: 'المعاد ما رجعش',
  body: 'الزيادة اتمسحت، بس معاد القسط الجاي فضل زي ما هو لأن الدين اتغيّر من جهاز تاني. راجع المعاد من تعديل الدين.',
};

export function reopenedDueMessage(due: string): string {
  return `الزيادة فتحت الدين تاني، فالمعاد الجاي بقى ${dueDateLabel(due)}.`;
}

/** سطر تأكيد المسح لما المعاد هيرجع */
export function dueRestoreLine(due: string): string {
  // من غير "و": سطر المحفظة اللي بعده بيبدأ بـ"والـ" (arabic-copy-reviewer)
  return `معاد القسط الجاي هيرجع ${dueDateLabel(due)}.`;
}

/**
 * المعاد اللي بيرجع لما زيادات تتشال، أو `null`. بيرجع بس لو:
 * - زيادة من اللي اتشالوا هي اللي فتحت الدين (عندها `reopenedFrom`)،
 * - **والمعاد لسه هو اللي هي حطّته** (`reopenedTo`) — لو المستخدم غيّره بإيده أو دفعة/تعديل حرّكه، مبنلمسوش،
 * - والدين بعد المسح **متسدد تاني** — لو لسه فيه باقي (زيادة تانية) المعاد الجديد هو الصح.
 */
export function dueDateAfterIncreaseRemoval(d: Debt, removed: DebtEntry[], increasesAfter: DebtEntry[]): string | null {
  if (!d.isInstallment || !d.dueDate) return null;
  const opener = removed.find(e => isDateStr(e.reopenedFrom) && e.reopenedTo === d.dueDate);
  if (!opener) return null;
  if (debtRemaining({ ...d, increases: increasesAfter }) > PIASTRE_EPS) return null;
  return opener.reopenedFrom!;
}
