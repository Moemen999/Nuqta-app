import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * الساعة دلوقتي (0–23) وبتتحدّث لوحدها أول كل ساعة — عشان بانر "لسه ما سجلتش"
 * يظهر وقت الساعة اللي المستخدم اختارها من غير ما الشاشة تتفتح تاني.
 *
 * المؤقّت بيتعاد مع كل لفّة مش مع تغيّر الساعة بس (silent-failure-hunter): لو اشتغل
 * بدري (الساعة اترجعت لورا) والساعة ما اتغيّرتش، الإعادة كانت بتقف للأبد. ورجوع
 * التطبيق من الخلفية بيحدّث على طول (المؤقّتات بتتأخر في الخلفية).
 */
export function useCurrentHour() {
  const [hour, setHour] = useState(() => new Date().getHours());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
    const t = setTimeout(() => {
      setHour(new Date().getHours());
      setTick(x => x + 1);
    }, Math.max(next.getTime() - now.getTime(), 1000));
    return () => clearTimeout(t);
  }, [tick]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') { setHour(new Date().getHours()); setTick(x => x + 1); }
    });
    return () => sub.remove();
  }, []);
  return hour;
}
