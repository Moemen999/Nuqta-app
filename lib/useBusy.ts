import { useCallback, useRef, useState } from 'react';

/**
 * بيمنع إن أي زرار بيكتب في قاعدة البيانات يشتغل أكتر من مرة في نفس الوقت.
 * الـ ref هو الحماية الحقيقية: الـ state بيتحدث بعد إعادة الرسم، فلو المستخدم دوس
 * مرتين بسرعة (أو النت بطيء) الضغطة التانية كانت هتعدّي قبل ما الزرار يتقفل.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(async (action: () => Promise<any> | any) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}

/** "فيه عملية تانية شغالة" — لما دوسة بتتسقط عشان كتابة تانية لسه بتلف */
export const BUSY_NOTICE = {
  title: 'ما اتنفّذش',
  body: 'فيه عملية تانية لسه شغالة، فمفيش حاجة اتسجلت أو اتغيّرت. استنى لحد ما تخلص وجرب تاني.',
};

/**
 * نفس الفكرة بس لقوايم فيها زرار لكل عنصر (زي شهور الجمعية أو كروت الاشتراكات):
 * بنحتفظ بمفتاح العنصر اللي شغال دلوقتي عشان نقفل زراره هو بالذات.
 *
 * **القفل واحد للشاشة كلها**، والزرار بيتقفل بمفتاحه هو بس — فدوسة على عنصر تاني والأولى لسه
 * بتلف (لحد ~10 ثواني) كانت بتتسقط ساكت بعد ما المستخدم أكّد (silent-failure-hunter). `onBusy`
 * بيتنادى في الحالة دي عشان الشاشة تقول كده، و`run` بيرجّع اتنفّذ ولا لأ
 */
export function useBusyKey(onBusy?: () => void) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const running = useRef(false);
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;

  const run = useCallback(async (key: string, action: () => Promise<any> | any): Promise<boolean> => {
    if (running.current) { onBusyRef.current?.(); return false; }
    running.current = true;
    setBusyKey(key);
    try {
      await action();
    } finally {
      running.current = false;
      setBusyKey(null);
    }
    return true;
  }, []);

  return { busyKey, busy: busyKey !== null, run };
}
