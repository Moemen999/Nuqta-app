import type { Debt, DebtEntry } from '@/context/DataContext';
import { debtRemaining, isDateStr, PIASTRE_EPS } from '@/lib/finance';
import { MONTH_NAMES } from '@/lib/recurringIncome';

/**
 * بند 12 (قرار مؤمن 2026-11-05): زيادة فتحت دين أقساط كان متسدد بتقدّم معاد القسط الجاي (`reopenedDueDate`) —
 * (1) ده بيتقال برسالة، و(2) المعاد القديم بيتخزّن **جوه الزيادة** (`reopenedFrom`، ومعاه `reopenedTo` اللي اتحط)
 * فمسح الزيادة (من شاشة الدين أو بمسح عمليتها) بيرجّعه. قبل كده زوّد/امسح/زوّد كان بيقدّمه كل مرة.
 */

/** "5 ديسمبر 2026" */
export function dueDateLabel(iso: string): string {
  if (!isDateStr(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export const DUE_MOVED_TITLE = 'معاد القسط الجاي اتغيّر';

export function reopenedDueMessage(due: string): string {
  return `الزيادة فتحت الدين تاني، فالمعاد الجاي بقى ${dueDateLabel(due)}.`;
}

/** سطر تأكيد المسح لما المعاد هيرجع */
export function dueRestoreLine(due: string): string {
  return `ومعاد القسط الجاي هيرجع ${dueDateLabel(due)}.`;
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
