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

/**
 * نفس الفكرة بس لقوايم فيها زرار لكل عنصر (زي شهور الجمعية أو كروت الاشتراكات):
 * بنحتفظ بمفتاح العنصر اللي شغال دلوقتي عشان نقفل زراره هو بالذات.
 */
export function useBusyKey() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async (key: string, action: () => Promise<any> | any) => {
    if (running.current) return;
    running.current = true;
    setBusyKey(key);
    try {
      await action();
    } finally {
      running.current = false;
      setBusyKey(null);
    }
  }, []);

  return { busyKey, busy: busyKey !== null, run };
}
