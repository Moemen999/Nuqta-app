import { DataProvider, useData } from '@/context/DataContext';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

type DataApi = ReturnType<typeof useData>;

/** نفس المحافظ والفئات اللي التعبئة الأوتوماتيك القديمة كانت بتعملها */
export const TEST_SETUP = {
  wallets: [{ name: 'CIB', openingBalance: 0 }, { name: 'NBE', openingBalance: 0 }, { name: 'CASH', openingBalance: 0 }],
  categories: ['المواصلات', 'الفطار', 'السوبرماركت', 'أكل', 'أخرى'],
};

/**
 * بيركّب DataProvider الحقيقي (بكل الـ onSnapshot بتوعه) وبيرجّع مقبض للدوال
 * والبيانات اللي جواه. بنستخدم البروفايدر نفسه مش نسخة مقلّدة عشان الاختبار
 * يعدّي على نفس الكود اللي التطبيق بيستخدمه — بما فيه إن دوال التنسيق بتقرا من
 * الحالة اللي جاية من onSnapshot.
 *
 * `extra` بيتركّب جوه نفس البروفايدر — لهوك أو شيت محتاج البيانات الحقيقية
 * (`useArchivedSettlement` مثلاً).
 */
export async function renderDataProvider(extra?: React.ReactNode) {
  const holder: { current: DataApi | null } = { current: null };

  function Probe() {
    holder.current = useData();
    return null;
  }

  // في نسخة 14 من مكتبة الاختبار، render بترجع Promise ولازم تتنتظر
  const tree = (
    <DataProvider>
      <Probe />
      {extra}
    </DataProvider>
  );
  const view = await render(tree);

  /** آخر نسخة من الـ context — بتتقري من هنا كل مرة بعد أي انتظار */
  function api(): DataApi {
    if (!holder.current) throw new Error('البروفايدر لسه ما اشتغلش');
    return holder.current;
  }

  /**
   * حالة البروفايدر في سطر — بتتلزق في رسالة الـtimeout (بند 10: الوقعات المتقلّبة كلها timeout من غير أي معلومة،
   * والمرة الجاية لازم تقول هي وقفت فين). من غير أرقام فلوس.
   */
  function stateLine(phase: string, startedAt: number): string {
    const a = holder.current;
    if (!a) return `[${phase}] بعد ${Date.now() - startedAt}ms — البروفايدر لسه ما اشتغلش`;
    return `[${phase}] بعد ${Date.now() - startedAt}ms — setupStatus=${a.setupStatus} wallets=${a.wallets.length} `
      + `transactions=${a.transactions.length} serverReachable=${a.serverReachable} figuresFromServer=${a.figuresFromServer} `
      + `figuresPending=${a.figuresPending.join(',') || '-'} loadErrors=${a.loadErrors.join(',') || '-'} pendingWrites=${a.pendingWrites}`;
  }

  /** بيستنى لحد ما شرط معين يتحقق على البيانات الجاية من المحاكي */
  function waitForData(check: (api: DataApi) => boolean, timeout = 15000, phase = 'waitForData') {
    const startedAt = Date.now();
    return waitFor(
      () => {
        if (!holder.current || !check(holder.current)) {
          throw new Error(`لسه البيانات ما وصلتش للشرط المطلوب ${stateLine(phase, startedAt)}`);
        }
      },
      { timeout, interval: 50 }
    );
  }

  /**
   * بيستنى البروفايدر يبقى جاهز فعلاً: البيانات وصلت **و**إحنا شايفين السيرفر.
   * الجزء التاني مهم عشان العمليات اللي بتقرا من السيرفر (تسديد اشتراك/شهر
   * جمعية) بترفض على طول لو لسه ما وصلناش لأول snapshot متأكد من السيرفر —
   * وده حصل فعلاً في الاختبارات: المحافظ الافتراضية بتظهر من الكاش المحلي قبل
   * ما السيرفر يأكدها، فالاختبار كان بيكمل والتطبيق لسه بيعتبر نفسه أوفلاين
   */
  async function waitForReady(minWallets = 3) {
    // الحساب الجديد مبقاش بيتعبّى لوحده (شاشة "نبدأ بإيه؟") — فالاختبار بيجهّزه
    // بنفس الطريق الحقيقي (completeSetup) وبنفس المحافظ والفئات اللي الاختبارات
    // القديمة متعودة عليها
    // كل مرحلة باسمها في رسالة الـtimeout (بند 10) — الوقعة كانت دايمًا في السطر الأخير ومن غير ما نعرف أي شرط فيه ناقص
    await waitForData(api => api.setupStatus !== 'checking', 15000, 'ready:setupStatus');
    if (holder.current?.setupStatus === 'needed') {
      const t = Date.now();
      const outcome = await holder.current.completeSetup(TEST_SETUP);
      if (outcome !== 'done' && outcome !== 'already-done') throw new Error(`تجهيز حساب الاختبار فشل: ${outcome} (بعد ${Date.now() - t}ms)`);
    }
    return waitForData(api => api.wallets.length >= minWallets && api.serverReachable, 15000, `ready:wallets>=${minWallets}+serverReachable`);
  }

  /**
   * رسمة تانية بعنصر **جديد** — عشان mock اتغيّر (مثلاً useAuth) يوصل للبروفايدر.
   * نفس العنصر (`tree`) كان React بيعدّيه من غير ما يعيد تشغيل البروفايدر
   * (نفس الـprops) — silent-failure-hunter اتأكد إن ده ما بيوصّلش حاجة.
   */
  const rerender = () => view.rerender(
    <DataProvider>
      <Probe />
      {extra}
    </DataProvider>
  );
  return { view, api, waitForData, waitForReady, rerender, unmount: () => view.unmount() };
}
