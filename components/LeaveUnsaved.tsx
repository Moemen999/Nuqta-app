import { useConfirmDismiss } from '@/components/ConfirmProvider';
import { NavigationContext, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { useContext, useEffect } from 'react';

/** هوية سؤال «تخرج؟» في `ConfirmProvider` — عشان يتشال لو مابقاش له لازمة */
export const LEAVE_CONFIRM_KEY = 'leave_unsaved';

/**
 * الخروج بعد ما غيّر حاجة (قرار مؤمن 2026-11-19): رجوع أندرويد، سحب المودال، و«إلغاء» (`router.back()`) كلهم بيعدّوا
 * من `beforeRemove` ← السؤال (`ask`)، و«اخرج من غير حفظ» بيكمّل نفس الرجوع (`data.action`).
 *
 * **القفل:** التطبيق اتقفل والسؤال مفتوح ← `ConfirmProvider` بيلغيه، بس الشاشة كلها بتتشال ورا شاشة القفل، فالمسوّدة
 * **بتضيع** — ده قرار مؤمن (اختيار أ): القفل بيرمي العملية اللي ما اتحفظتش، ودليل الاستخدام بيقول كده صريح.
 *
 * **سؤال قديم:** الشاشة اتشالت أو `when` بقى false (الحفظ بدأ) والسؤال لسه في الطابور ← بيتشال (الميزة 10) — من غيره كان
 * بيظهر بعدين على شاشة تانية، و«اخرج» كان هيرجع خطوة زيادة.
 *
 * كومبوننت لوحده عشان محتاج navigator (`usePreventRemove`)، ومش مع `BlockLeave` في نفس الوقت.
 */
export function LeaveUnsaved({ when, ask }: { when: boolean; ask: (proceed: () => void) => void }) {
  const nav = useContext(NavigationContext);
  const dismiss = useConfirmDismiss();
  usePreventRemove(when, ({ data }: { data: { action: NavigationAction } }) => {
    ask(() => nav?.dispatch(data.action));
  });
  useEffect(() => {
    if (!when) dismiss(LEAVE_CONFIRM_KEY);
    return () => dismiss(LEAVE_CONFIRM_KEY);
  }, [when, dismiss]);
  return null;
}
