import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { amountFormatter, type AmountFormatter } from '@/lib/money';

/**
 * إخفاء المبالغ — **على الجهاز بس** (AsyncStorage) مش في فايرستور: ده تفضيل
 * للشاشة اللي في إيدك، والتليفون التاني ممكن يبقى في مكان محدش بيبص فيه.
 *
 * **النطاق: الرئيسية بس** (قرار مؤمن 2026-09-27، رجوع عن "كل الشاشات"). العين
 * بتغطي الأرصدة في الرئيسية — غطا سريع من حد بيبص على الشاشة، مش خصوصية
 * كاملة: اللي ماسك التليفون يقدر يفتح الإعدادات أو الديون ويشوف الأرقام.
 * الرئيسية ملفوفة في `AmountsMaskScope`، وبرّه النطاق `amountsHidden` بـfalse
 * و`money()` بيرجّع الرقم — فكل الشاشات التانية بتعرض أرقامها من غير ما
 * نلمس كل شاشة لوحدها. الإشعارات بتقرا `hidePreference` (التفضيل نفسه):
 * بتظهر برّه التطبيق على شاشة القفل، ودي أكتر مكان مكشوف.
 */
export const HIDE_AMOUNTS_KEY = 'nuqta-hide-amounts';

type PrivacyValue = {
  /**
   * المبالغ مخفية **هنا**: التفضيل مفعّل **و**الكومبوننت جوه `AmountsMaskScope`
   * (الرئيسية). برّه النطاق دايمًا `false`.
   *
   * جوه النطاق `true` لحد ما التفضيل يتقري: اللي اختار الإخفاء مينفعش أرقامه
   * تلمع لحظة أول ما التطبيق يفتح.
   */
  amountsHidden: boolean;
  /** التفضيل نفسه (العين) من غير النطاق — للزرار وللإشعارات */
  hidePreference: boolean;
  /** التفضيل اتقري من الجهاز — الإشعارات مستنياه قبل ما تتجدول */
  loaded: boolean;
  toggleAmounts: () => void;
  /** للجمل اللي فيها مبلغ: `money(500)` ← «500» أو «••••» */
  money: AmountFormatter;
};

const PrivacyContext = createContext<PrivacyValue | null>(null);
const MaskScopeContext = createContext(false);

/** اللي جوّاه بيتخبّى لما العين مقفولة. بيتلف حوالين الرئيسية بس */
export function AmountsMaskScope({ children }: { children: ReactNode }) {
  return <MaskScopeContext.Provider value>{children}</MaskScopeContext.Provider>;
}

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
    () => ({ amountsHidden, hidePreference: amountsHidden, loaded: stored !== null, toggleAmounts, money: amountFormatter(amountsHidden) }),
    [amountsHidden, stored, toggleAmounts],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyValue {
  const ctx = useContext(PrivacyContext);
  const inScope = useContext(MaskScopeContext);
  // نفس المرجع بين الرسمات (react-reviewer): أي حد يحط النتيجة كلها في deps
  // ميتنادالوش effect مع كل رسمة
  const value = useMemo(
    () => (ctx && !inScope && ctx.amountsHidden ? { ...ctx, amountsHidden: false, money: amountFormatter(false) } : ctx),
    [ctx, inScope],
  );
  if (!value) throw new Error('usePrivacy must be used within PrivacyProvider');
  return value;
}
