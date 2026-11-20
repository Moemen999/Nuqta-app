import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useLockShown } from '@/context/LockShownContext';

/**
 * إعلان لقارئ الشاشة **ميطلعش والتطبيق مقفول** (الميزة 11، security M1): الشجرة بتفضل متركّبة تحت `LockGate`، فإعلان
 * زي «اتسجل "نتفليكس"» كان بيتقال فوق شاشة القفل لأي حد ماسك الموبايل.
 *
 * `defer` (الافتراضي): بيتأجل لحد ما القفل يتفتح وبعدين بيتقال (من غير تكرار). `drop`: بيتشال — للإعلانات اللي بتقول
 * «العدد زاد»، اللي بعد الفتح بتبقى قديمة والسطر نفسه قدامه.
 */
export function useLockAwareAnnounce(): (text: string, mode?: 'defer' | 'drop') => void {
  const shown = useLockShown();
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const queue = useRef<string[]>([]);
  useEffect(() => {
    if (shown || queue.current.length === 0) return;
    const q = [...new Set(queue.current)];
    queue.current = [];
    q.forEach(t => AccessibilityInfo.announceForAccessibility(t));
  }, [shown]);
  return useCallback((text: string, mode: 'defer' | 'drop' = 'defer') => {
    if (!text) return;
    if (shownRef.current) {
      if (mode === 'defer') queue.current.push(text);
      return;
    }
    AccessibilityInfo.announceForAccessibility(text);
  }, []);
}
