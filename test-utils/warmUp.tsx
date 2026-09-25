import type React from 'react';
import { render } from '@testing-library/react-native';

/**
 * أول render في كل ملف بيدفع تمن تحميل مكونات react-native الكسولة (getters
 * في `react-native/index.js`) وتحويلها بـ babel لو الكاش فاضي. اتقاس
 * 2026-09-25 على 16 worker: **~7–8.5 ثانية باردة** (بعد `--clearCache`)
 * و~1–1.5 ثانية دافية — والسقف 5 ثواني. فالاختبار الأول في الملف كان بيقع
 * من البطء مش من غلطة.
 *
 * الحل: render واحد في `beforeAll` بسقف واسع لوحده، فالتمن ده يتدفع **هنا**
 * باسمه، والاختبارات نفسها تفضل على الـ5 ثواني — لو واحد فيهم وقع، يبقى
 * هو اللي بطيء أو معلّق فعلاً.
 *
 * ليه مش `testTimeout` أعلى لكل حاجة: كان هيخبّي أي اختبار بقى بطيء بجد.
 *
 * ملحوظة: التايم آوت بتاع jest `setTimeout` عادي، فمبيقدرش يقاطع render
 * متزامن. عشان كده ملفات تقيلة زي كده كانت "بتنجح" في 6.7 ثانية — بالصدفة
 * مش لأنها تحت السقف. الملفات دي كمان بتاخد الـwarm-up.
 */
export const COLD_START_TIMEOUT_MS = 30_000;

export function warmUp(tree: () => React.ReactElement) {
  beforeAll(async () => {
    const r = await render(tree());
    r.unmount();
  }, COLD_START_TIMEOUT_MS);
}
