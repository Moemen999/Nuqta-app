import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * «تقليل الحركة» من إعدادات النظام، ويتابع التغيير وهو شغّال. **مصدر واحد** للزرار العايم ومؤشر التابات الفرعية:
 * كان منسوخ في كل مكان بيتحرّك. الافتراضي false لحد ما الإجابة توصل (أول رسمة من غير حركة أصلًا)، وأي فشل في السؤال
 * ← بالحركة (زينة بس).
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    try {
      AccessibilityInfo.isReduceMotionEnabled?.()?.then((v) => { if (alive) setReduceMotion(!!v); }).catch(() => {});
    } catch { /* مفيش إعداد ← بالحركة */ }
    let sub: { remove: () => void } | undefined;
    try { sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { if (alive) setReduceMotion(!!v); }); } catch { /* زي فوق */ }
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduceMotion;
}
