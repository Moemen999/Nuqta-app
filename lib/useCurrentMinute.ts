import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

const minuteOfDay = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/**
 * الدقيقة دلوقتي من اليوم (0–1439 = ساعة×60 + دقيقة) وبتتحدّث لوحدها أول كل دقيقة
 * (مش كل ثانية) — عشان بانر "لسه ما سجلتش" يظهر من معاد التذكير بالظبط (9:13 مش 9:00).
 *
 * المؤقّت بيتعاد مع كل لفّة مش مع تغيّر القيمة بس (silent-failure-hunter): لو اشتغل
 * بدري (الساعة اترجعت لورا) والدقيقة ما اتغيّرتش، الإعادة كانت بتقف للأبد. ورجوع
 * التطبيق من الخلفية بيحدّث على طول (المؤقّتات بتتأخر في الخلفية).
 */
export function useCurrentMinute() {
  const [minute, setMinute] = useState(minuteOfDay);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);
    const t = setTimeout(() => {
      setMinute(minuteOfDay());
      setTick(x => x + 1);
    }, Math.max(next.getTime() - now.getTime(), 1000));
    return () => clearTimeout(t);
  }, [tick]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') { setMinute(minuteOfDay()); setTick(x => x + 1); }
    });
    return () => sub.remove();
  }, []);
  return minute;
}
