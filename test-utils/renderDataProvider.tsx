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

  return { view, api, waitForData, unmount: () => view.unmount() };
}
