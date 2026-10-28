import { useEffect, useState } from 'react';

/**
 * الساعة دلوقتي (0–23) وبتتحدّث لوحدها أول كل ساعة — عشان بانر "لسه ما سجلتش"
 * يظهر وقت الساعة اللي المستخدم اختارها من غير ما الشاشة تتفتح تاني.
 */
export function useCurrentHour() {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
    const t = setTimeout(() => setHour(new Date().getHours()), Math.max(next.getTime() - now.getTime(), 1000));
    return () => clearTimeout(t);
  }, [hour]);
  return hour;
}
