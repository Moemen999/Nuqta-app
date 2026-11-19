import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * نمط واحد لإعلان البانرات اللي بتظهر متأخر في الرئيسية (مراجعة التطبيق كله، الميزة 7 — a11y-architect):
 * مفيش نت، الأرقام ممكن تكون قديمة، الكاش البارد، عمليات/محافظ بايظة، مسح الحساب ما خلصش، «مقدرناش نجيب بياناتك»،
 * وسطر العمليات اللي لسه ما اترفعتش.
 *
 * **iOS بس بنعلن** (VoiceOver مبيقراش عنصر جديد لوحده)، **وأندرويد على `accessibilityLiveRegion="polite"`** اللي على
 * البانر نفسه — نفس نمط `IncomeAutoNotices`. الاتنين مع بعض على أندرويد كانوا بيتقروا مرتين (بانر الكاش كان كده).
 *
 * بيتقال لما النص يظهر أو يتغيّر لنص جديد — مش مع كل رسمة. `null`/فاضي = البانر مش ظاهر.
 */
export function useAnnounceOnAppear(text: string | null | false | undefined, opts: { silent?: boolean } = {}): void {
  const last = useRef<string | null>(null);
  const silent = !!opts.silent;
  useEffect(() => {
    const now = text || null;
    // `silent`: النص اتغيّر وفيه إعلان تاني بيقول نفس الحاجة (نتيجة «جرّب تاني») — بيتسجّل إنه اتقال من غير ما يتقال
    if (now && now !== last.current && !silent && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(now);
    last.current = now;
  }, [text, silent]);
}
