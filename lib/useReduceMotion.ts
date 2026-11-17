import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * «تقليل الحركة» من إعدادات النظام، ويتابع التغيير وهو شغّال. **مصدر واحد** للزرار العايم ومؤشر التابات الفرعية:
 * كان منسوخ في كل مكان بيتحرّك. الافتراضي false لحد ما الإجابة توصل (أول رسمة من غير حركة أصلًا)، وأي فشل في السؤال
 * ← بالحركة (زينة بس).
 */
export function useReduceMotion(): boolean {
  return useReduceMotionKnown() ?? false;
}

/**
 * نفس الإعداد بس بيفرّق «لسه ما عرفناش» (`null`) عن false — لمين الأول رسمة بتفرق معاه (`ProgressRing`: مع «تقليل الحركة»
 * ممنوع أول ملء من صفر). الباقي يستخدم `useReduceMotion`.
 */
export function useReduceMotionKnown(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    try {
      const asked = AccessibilityInfo.isReduceMotionEnabled?.();
      if (asked && typeof asked.then === 'function') asked.then((v) => { if (alive) setReduceMotion(!!v); }).catch(() => { if (alive) setReduceMotion(false); });
      else setReduceMotion(false);
    } catch { setReduceMotion(false); /* مفيش إعداد ← بالحركة */ }
    let sub: { remove: () => void } | undefined;
    try { sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { if (alive) setReduceMotion(!!v); }); } catch { /* زي فوق */ }
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduceMotion;
}
