import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * سطر خطأ في فورم بيتقال كل مرة (مراجعة التطبيق كله، الميزة 8 — الجولة 2، بند 3):
 * - **متركّب دايمًا** (فاضي من غير خطأ): منطقة أندرويد الحية (`accessibilityLiveRegion`) على عنصر لسه متركّب مش مضمون تتقري.
 * - **نفس الرسالة مرتين بتتقال تاني**: كل `setError` بنص بيزوّد عدّاد. أندرويد: الاسم (`accessibilityLabel`) بيتغيّر بحرف
 *   مش بيتنطق (U+200B) كل مرة، فالمنطقة الحية بتشوف تغيير؛ iOS: الإعلان مربوط بالعدّاد مش بالنص.
 */
const ZW = '​';
export function useFormError() {
  const [state, setState] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const setError = useCallback((text: string) => {
    setState(s => (text ? { text, n: s.n + 1 } : s.text ? { text: '', n: s.n } : s));
  }, []);
  useEffect(() => {
    if (state.text && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(state.text);
  }, [state.n, state.text]);
  const errorA11y = {
    accessibilityLiveRegion: 'polite' as const,
    accessibilityLabel: state.text ? (state.n % 2 ? state.text : state.text + ZW) : '',
  };
  return { error: state.text, setError, errorA11y };
}
