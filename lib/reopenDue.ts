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

/** نفس `DUE_NOT_RESTORED` للدفعة (الجولة 2، بند 2): تأكيد مسح الدفعة كمان بيوعد إن المعاد يرجع */
export const DUE_NOT_RESTORED_PAYMENT = {
  title: 'المعاد ما رجعش',
  body: 'الدفعة اتمسحت، بس معاد القسط الجاي فضل زي ما هو لأن الدين اتغيّر من جهاز تاني. راجع المعاد من تعديل الدين.',
};

export function dueNotRestoredNotice(kind: 'payment' | 'increase'): { title: string; body: string } {
  return kind === 'payment' ? DUE_NOT_RESTORED_PAYMENT : DUE_NOT_RESTORED;
}

export function reopenedDueMessage(due: string): string {
  return `الزيادة فتحت الدين تاني، فمعاد القسط الجاي بقى ${dueDateLabel(due)}.`;
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

/**
 * بند 3: المعاد اللي بيرجع لما دفعات تتشال، أو `null`. دفعة قسط مخلّصتش الدين بتقدّم المعاد شهر
 * (`addDebtPayment`) وبتخزّن من→لـ (`advancedFrom`/`advancedTo`). بيرجع بس لو:
 * - دفعة من اللي اتشالوا هي اللي قدّمته، **والمعاد لسه هو اللي هي حطّته** — غيّره المستخدم أو دفعة بعدها
 *   قدّمته تاني ← مبنلمسوش (مسح دفعات بالترتيب من الأحدث بيرجّعه خطوة خطوة)،
 * - والدين بعد المسح **مفتوح** — متسدد ملوش "قسط جاي".
 */
export function dueDateAfterPaymentRemoval(
  d: Debt, removed: { advancedFrom?: string; advancedTo?: string }[], paymentsAfter: Debt['payments'],
): string | null {
  if (!d.isInstallment || !d.dueDate) return null;
  const mover = removed.find(p => isDateStr(p.advancedFrom) && p.advancedTo === d.dueDate);
  if (!mover) return null;
  if (debtRemaining({ ...d, payments: paymentsAfter }) <= PIASTRE_EPS) return null;
  return mover.advancedFrom!;
}

/**
 * الجولة 2 (بند 6): الدفعات اللي فاضلة بعد مسح دفعات، **والسلسلة متوصّلة**. كل دفعة قدّمت المعاد بتخزّن من→لـ، والدفعة اللي
 * بعدها بتبدأ من حيث خلّصت (`advancedFrom` بتاعتها = `advancedTo` بتاعة اللي قبلها). مسح دفعة **مش آخر واحدة** (المعاد مش بتاعها
 * فمبيتلمسش — `dueDateAfterPaymentRemoval`) كان بيقطع السلسلة: مسح اللي بعدها يرجّع لنص الطريق (02-15) مش للأول (01-15).
 * فالدفعة اللي كانت بتبدأ من حيث خلّصت المحذوفة بتورث بدايتها. **بسيط عن قصد:** المعاد نفسه مبيتحركش مع مسح دفعة من النص
 * (زي قبل كده)، ومفيش إعادة حساب لتواريخ السلسلة كلها — بس المسح اللي بعده بيرجع للمكان الصح.
 */
export function paymentsAfterRemoval<P extends { advancedFrom?: string; advancedTo?: string }>(removed: P[], after: P[]): P[] {
  let out = after;
  for (const r of removed) {
    if (!isDateStr(r.advancedFrom) || !isDateStr(r.advancedTo)) continue;
    // أول دفعة بس بتبدأ من نهاية المحذوفة — لو المستخدم رجّع المعاد بإيده ودفعتين بدأوا من نفس اليوم، التانية مش وريثتها
    const i = out.findIndex(p => p.advancedFrom === r.advancedTo);
    if (i === -1) continue;
    out = out.map((p, k) => (k === i ? { ...p, advancedFrom: r.advancedFrom } : p));
  }
  return out;
}
