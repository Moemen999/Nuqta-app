import { usePathname } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
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
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
  scrollEventThrottle: number;
};

type Actions = {
  /** كل اللي الـScrollView محتاجه — `{...scrollProps}` */
  scrollProps: ScrollProps;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** ظهّر الزرار (تغيير تاب فرعي مثلاً) وصفّر المرساة */
  show: () => void;
  scrollEventThrottle: number;
};

const noopFn = () => {};
const noopProps: ScrollProps = { onScroll: noopFn, onScrollEndDrag: noopFn, onMomentumScrollBegin: noopFn, onMomentumScrollEnd: noopFn, scrollEventThrottle: 16 };
const noop: Actions = { scrollProps: noopProps, onScroll: noopFn, show: noopFn, scrollEventThrottle: 16 };

const ActionsContext = createContext<Actions>(noop);
const VisibleContext = createContext<boolean>(true);

export function FabScrollProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const anchor = useRef(0);
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
      anchor.current = fabScrollStopped(anchor.current).anchorY;
      apply(true);
    }, ms);
  }, [apply, clearTimer]);

  const show = useCallback(() => {
    clearTimer();
    anchor.current = 0;
    apply(true);
  }, [apply, clearTimer]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e?.nativeEvent?.contentOffset?.y;
    if (typeof y !== 'number') return;
    const next = fabScrollStep(anchor.current, y, visibleRef.current);
    anchor.current = next.anchorY;
    if (next.visible !== visibleRef.current) apply(next.visible);
    // مستخبي ← كل حدث بيأجّل الرجوع (debounce): الرجوع أول ما الأحداث تقف
    if (!next.visible) armSettle(FAB_SETTLE_MS); else clearTimer();
  }, [apply, armSettle, clearTimer]);

  const onScrollEndDrag = useCallback(() => { if (!visibleRef.current) armSettle(FAB_SETTLE_MS); }, [armSettle]);
  // momentum بدأ ← لسه بيتحرك، متفتحش الزرار
  const onMomentumScrollBegin = clearTimer;
  const onMomentumScrollEnd = useCallback(() => { if (!visibleRef.current) armSettle(FAB_SETTLE_MS); }, [armSettle]);

  useEffect(() => clearTimer, [clearTimer]);

  // تغيير التاب ← ظاهر (كل تاب ليه موضع تمرير تاني)
  useEffect(() => { show(); }, [pathname, show]);

  const actions = useMemo<Actions>(() => ({
    scrollProps: { onScroll, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, scrollEventThrottle: 16 },
    onScroll, show, scrollEventThrottle: 16,
  }), [onScroll, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, show]);

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
