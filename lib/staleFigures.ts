import { useEffect, useState } from 'react';

/**
 * بانر "النت قطع — الأرقام ممكن تكون قديمة" (2026-09-29).
 *
 * لما النت يقطع والأرقام على الشاشة، مكانش فيه حاجة بتقول إنها ممكن تكون قديمة
 * — "مفيش نت" كان بيظهر بس لو ولا محفظة وصلت. فالمستخدم يقرا رصيد عدّى عليه
 * دقايق وهو مطمن، وده بالظبط اللي المعيار بيقول ميحصلش أبدًا.
 *
 * بس الاتصال بيتقلب في قطع قصير، وتحذير بيولّع على حالة سليمة بيعلّم الناس
 * يتجاهلوا كل التحذيرات. عشان كده:
 * - **بيظهر بعد مهلة بس** (`STALE_FIGURES_DELAY_MS`): قطع أقصر منها مبيرسمش حاجة.
 * - **مبيختفيش أول ما النت يرجع**: بيختفي لما الأرقام نفسها تتحدّث من السيرفر
 *   (`figuresFromServer` في DataContext — المحافظ **والعمليات** الاتنين). رجوع
 *   الاتصال مش هو إن الأرقام اتحدّثت.
 */
export const STALE_FIGURES_DELAY_MS = 10_000;

/**
 * الأرقام متزامنة؟ آخر fromCache للمحافظ وللعمليات (`null` = الـlistener لسه
 * مرماش snapshot — مجموعة فاضية ممكن متبعتش خالص، فمبيمنعش). لازم الاتنين
 * يكونوا من السيرفر: واحد رجع والتاني لسه من الكاش = الرصيد لسه ممكن يكون قديم.
 */
export function figuresFresh(wallets: boolean | null, transactions: boolean | null): boolean {
  return wallets !== true && transactions !== true && (wallets === false || transactions === false);
}

export const STALE_FIGURES_TEXT = 'النت قطع — الأرقام ممكن تكون قديمة';

/**
 * @param figuresFromServer الأرصدة متزامنة مع السيرفر دلوقتي
 * @param hasFigures فيه أرقام على الشاشة أصلاً (من غيرها ده "مفيش نت" التاني)
 */
export function useStaleFigures(figuresFromServer: boolean, hasFigures: boolean): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // اتحدّثت ← البانر يختفي (ده الطريق الوحيد إنه يختفي وفيه أرقام)
    if (figuresFromServer) { setStale(false); return; }
    if (!hasFigures) { setStale(false); return; }
    // مش متزامنة وفيه أرقام: نستنى المهلة الأول — لو اتحدّثت قبلها الـcleanup بيلغيها
    const t = setTimeout(() => setStale(true), STALE_FIGURES_DELAY_MS);
    return () => clearTimeout(t);
  }, [figuresFromServer, hasFigures]);

  return stale;
}
