import { DataProvider, useData } from '@/context/DataContext';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

type DataApi = ReturnType<typeof useData>;

/**
 * بيركّب DataProvider الحقيقي (بكل الـ onSnapshot بتوعه) وبيرجّع مقبض للدوال
 * والبيانات اللي جواه. بنستخدم البروفايدر نفسه مش نسخة مقلّدة عشان الاختبار
 * يعدّي على نفس الكود اللي التطبيق بيستخدمه — بما فيه إن دوال التنسيق بتقرا من
 * الحالة اللي جاية من onSnapshot.
 */
export async function renderDataProvider() {
  const holder: { current: DataApi | null } = { current: null };

  function Probe() {
    holder.current = useData();
    return null;
  }

  // في نسخة 14 من مكتبة الاختبار، render بترجع Promise ولازم تتنتظر
  const view = await render(
    <DataProvider>
      <Probe />
    </DataProvider>
  );

  /** آخر نسخة من الـ context — بتتقري من هنا كل مرة بعد أي انتظار */
  function api(): DataApi {
    if (!holder.current) throw new Error('البروفايدر لسه ما اشتغلش');
    return holder.current;
  }

  /** بيستنى لحد ما شرط معين يتحقق على البيانات الجاية من المحاكي */
  function waitForData(check: (api: DataApi) => boolean, timeout = 15000) {
    return waitFor(
      () => {
        if (!holder.current || !check(holder.current)) {
          throw new Error('لسه البيانات ما وصلتش للشرط المطلوب');
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
  function waitForReady(minWallets = 3) {
    return waitForData(api => api.wallets.length >= minWallets && api.serverReachable);
  }

  return { view, api, waitForData, waitForReady, unmount: () => view.unmount() };
}
