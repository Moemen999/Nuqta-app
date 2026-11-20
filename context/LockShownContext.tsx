import { createContext, useContext } from 'react';

/**
 * القفل ظاهر (أو لسه بنقرا إعداده) — للي متركّب **تحت** القفل (الميزة 11، security M1): الشجرة بتفضل متركّبة تحت
 * `LockGate`، فالتسجيل التلقائي (إشعار بالاسم والمبلغ) وإعلانات قارئ الشاشة كانوا بيشتغلوا والتطبيق مقفول.
 *
 * في ملف لوحده عن قصد: `AppLockProvider` هو اللي بيحط القيمة، بس الاختبارات اللي بتعمل mock لـ`AppLockContext`
 * (كتير) متتكسرش. برّه البروفايدر ← `false`
 */
export const LockShownContext = createContext(false);

export function useLockShown(): boolean {
  return useContext(LockShownContext);
}
