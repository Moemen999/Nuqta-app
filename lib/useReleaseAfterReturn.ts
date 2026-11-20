import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** المستخدم رجع للتطبيق والزرار لسه بيلف بالمدة دي ← بيتفك */
export const RELEASE_AFTER_RETURN_MS = 5000;

/**
 * زرار شغال (تصدير) بيستنى وعد ممكن ميرجعش (`Sharing.shareAsync`: المستقبِل اتقفل غلط أو أندرويد قتل الـchooser) —
 * من غير ده كان بيفضل بيلف للأبد (Feature 9، الجولة الأخيرة). التطبيق رجع قدام (`active`) وهو لسه `busy` ←
 * بعد `RELEASE_AFTER_RETURN_MS` بينادي `release`. لو الوعد رجع بعدها، الـ`finally` بتاعه بيفك تاني — من غير ضرر.
 */
export function useReleaseAfterReturn(busy: boolean, release: () => void) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => {
    if (!busy) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active' || timer) return;
      timer = setTimeout(() => { timer = null; if (busyRef.current) releaseRef.current(); }, RELEASE_AFTER_RETURN_MS);
    });
    return () => { sub.remove(); if (timer) clearTimeout(timer); };
  }, [busy]);
}
