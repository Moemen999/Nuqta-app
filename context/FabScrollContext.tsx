import { usePathname } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { FAB_SETTLE_MS, fabScrollStep, fabScrollStopped } from '@/lib/fabScroll';

/**
 * الزرار العايم "+" بيختفي وانت بتمرّر لتحت وبيرجع أول ما التمرير يقف (قرار مؤمن 2026-11-16).
 * الشاشات بتبلّغ بالتمرير عبر `useFabScroll()`، والزرار (في `app/(tabs)/_layout.tsx`)
 * بيقرا الحالة من `useFabVisible()`. عن قصد في Contextين: الأولى ثابتة فالشاشات
 * مبتتعملش render تاني مع كل تغيير حالة.
 *
 * من غير Provider (اختبارات الشاشات) الهوك بيرجّع no-op.
 */

type ScrollProps = {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
  scrollEventThrottle: number;
};

type Actions = {
  /** كل اللي الـScrollView محتاجه — `{...scrollProps}` */
  scrollProps: ScrollProps;
  /** ظهّر الزرار (تغيير تاب فرعي مثلاً) وصفّر المرساة */
  show: () => void;
};

const noopFn = () => {};
const noopProps: ScrollProps = { onScroll: noopFn, onScrollBeginDrag: noopFn, onScrollEndDrag: noopFn, onMomentumScrollBegin: noopFn, onMomentumScrollEnd: noopFn, scrollEventThrottle: 16 };
const noop: Actions = { scrollProps: noopProps, show: noopFn };

const ActionsContext = createContext<Actions>(noop);
const VisibleContext = createContext<boolean>(true);

export function FabScrollProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  // null = "مش متحددة": بتتظبط على أول حدث تمرير (بعد show() التاب بيرجع في مكان تمريره القديم)
  const anchor = useRef<number | null>(null);
  const dragging = useRef(false);
  const screenReader = useRef(false);
  const visibleRef = useRef(true);

  const apply = useCallback((v: boolean) => {
    visibleRef.current = v;
    setVisible(v);
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // التمرير وقف ← الزرار يرجع
  const armSettle = useCallback((ms: number) => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (anchor.current !== null) anchor.current = fabScrollStopped(anchor.current).anchorY;
      apply(true);
    }, ms);
  }, [apply, clearTimer]);

  const show = useCallback(() => {
    clearTimer();
    dragging.current = false;
    anchor.current = null;
    apply(true);
  }, [apply, clearTimer]);

  // قارئ الشاشة شغّال ← الزرار ظاهر دايمًا ومن غير أي منطق تمرير (مستخدم TalkBack/VoiceOver
  // مبيشوفش اختفاء بصري، ولازم يلاقي الزرار في أي لحظة)
  useEffect(() => {
    let alive = true;
    const set = (v: boolean) => { screenReader.current = v; if (v) show(); };
    try {
      AccessibilityInfo.isScreenReaderEnabled?.()?.then((v) => { if (alive) set(!!v); }).catch(() => {});
    } catch { /* مفيش إعداد ← بمنطق التمرير */ }
    let sub: { remove: () => void } | undefined;
    try { sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', (v: boolean) => { if (alive) set(!!v); }); } catch { /* زي فوق */ }
    return () => { alive = false; sub?.remove?.(); };
  }, [show]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (screenReader.current) return;
    const y = e?.nativeEvent?.contentOffset?.y;
    if (typeof y !== 'number') return;
    // أول حدث بعد show(): نظبط المرساة على مكانه بس — مفيش حركة اتعملت لسه
    if (anchor.current === null) { anchor.current = Math.max(0, y); return; }
    const next = fabScrollStep(anchor.current, y, visibleRef.current);
    anchor.current = next.anchorY;
    if (next.visible !== visibleRef.current) apply(next.visible);
    // مستخبي ← كل حدث بيأجّل الرجوع (debounce): الرجوع أول ما الأحداث تقف — إلا والإصبع ماسك (بيتسلّح عند endDrag)
    if (!next.visible && !dragging.current) armSettle(FAB_SETTLE_MS); else clearTimer();
  }, [apply, armSettle, clearTimer]);

  const onScrollBeginDrag = useCallback(() => { dragging.current = true; clearTimer(); }, [clearTimer]);
  const onScrollEndDrag = useCallback(() => {
    dragging.current = false;
    if (!screenReader.current && !visibleRef.current) armSettle(FAB_SETTLE_MS);
  }, [armSettle]);
  // momentum بدأ: مفيش مسح للمهلة هنا — أحداث onScroll أثناء الـmomentum بتعيد تسليحها، ومسحها كان بيسيب الزرار مستخبي للأبد لو الـmomentum مخلّصش بحدث
  const onMomentumScrollBegin = noopFn;
  const onMomentumScrollEnd = useCallback(() => { dragging.current = false; if (!visibleRef.current) armSettle(FAB_SETTLE_MS); }, [armSettle]);

  useEffect(() => clearTimer, [clearTimer]);

  // تغيير التاب ← ظاهر (كل تاب ليه موضع تمرير تاني)
  useEffect(() => { show(); }, [pathname, show]);

  const actions = useMemo<Actions>(() => ({
    scrollProps: { onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, scrollEventThrottle: 16 },
    show,
  }), [onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, show]);

  return (
    <ActionsContext.Provider value={actions}>
      <VisibleContext.Provider value={visible}>{children}</VisibleContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useFabScroll(): Actions {
  return useContext(ActionsContext);
}

export function useFabVisible(): boolean {
  return useContext(VisibleContext);
}
