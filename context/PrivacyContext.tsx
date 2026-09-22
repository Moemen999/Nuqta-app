import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { amountFormatter, type AmountFormatter } from '@/lib/money';

/**
 * إخفاء المبالغ — **على الجهاز بس** (AsyncStorage) مش في فايرستور: ده تفضيل
 * للشاشة اللي في إيدك، والتليفون التاني ممكن يبقى في مكان محدش بيبص فيه.
 */
export const HIDE_AMOUNTS_KEY = 'nuqta-hide-amounts';

type PrivacyValue = {
  /**
   * `true` لحد ما التفضيل يتقري: اللي اختار الإخفاء مينفعش أرقامه تلمع لحظة
   * أول ما التطبيق يفتح. اللي مختار الإظهار بيشوف القناع جزء من الثانية.
   */
  amountsHidden: boolean;
  /** التفضيل اتقري من الجهاز — الإشعارات مستنياه قبل ما تتجدول */
  loaded: boolean;
  toggleAmounts: () => void;
  /** للجمل اللي فيها مبلغ: `money(500)` ← «500» أو «••••» */
  money: AmountFormatter;
};

const PrivacyContext = createContext<PrivacyValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HIDE_AMOUNTS_KEY)
      .then(v => setStored(v === '1'))
      // لو القراية وقعت مش هنخمّن "مخفي" للأبد — ده كان هيخلي التطبيق كله قناع
      // من غير أي طريقة المستخدم يفهم ليه. بنرجع للافتراضي (ظاهر).
      .catch(() => setStored(false));
  }, []);

  const amountsHidden = stored !== false;

  const toggleAmounts = useCallback(() => {
    setStored(prev => {
      const next = !(prev !== false);
      AsyncStorage.setItem(HIDE_AMOUNTS_KEY, next ? '1' : '0').catch(() => {
        // الاختيار شغال في الجلسة دي؛ اللي ضاع إنه مش هيتفكر بعد إعادة التشغيل
        console.warn('[privacy] hide-amounts preference was not saved');
      });
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ amountsHidden, loaded: stored !== null, toggleAmounts, money: amountFormatter(amountsHidden) }),
    [amountsHidden, stored, toggleAmounts],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy must be used within PrivacyProvider');
  return ctx;
}
