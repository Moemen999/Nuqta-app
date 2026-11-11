import { useLayoutEffect } from 'react';

/**
 * عدّاد رسم مؤقت لقياس بند D على الموبايل (`adb logcat -s ReactNativeJS`) — فرع `perf/render-probe` بس، **مش للدمج**.
 * كل رسمة بتطبع: الاسم، رقمها، والوقت من أول الرسمة لحد ما الشجرة اتركّبت (layout effect).
 */
const counts: Record<string, number> = {};
export function useRenderProbe(name: string) {
  const n = (counts[name] = (counts[name] ?? 0) + 1);
  const t0 = Date.now();
  useLayoutEffect(() => {
    console.log(`[perf] ${name} #${n} ${Date.now() - t0}ms`);
  });
}
