import {
  DEFAULT_INTERVAL, MAX_TIMER_MS, ROUTINE_INTERVALS, WARNING_BANNERS, WARNING_INTERVALS, bannerKey, hiddenUntil,
  intervalMs, isHidden, nextReturnAt, parseDismissals, parseIntervals, pruneExpired,
} from '@/lib/bannerDismiss';
import { DEFAULT_DAILY_HOUR, parseDailyHour } from '@/context/NotificationsContext';

/**
 * قفل البانرات بالـ✕ (قرار مؤمن 2026-10-28): بيرجع بعد المدة بالظبط مش قبلها، المدة
 * لكل نوع، والقفل عمره ما بيبقى للأبد. الوقت بيتبعت \`now\` (دوال صافية).
 */
const H = 3_600_000;
const T = 1_700_000_000_000;

describe('hiddenUntil / isHidden', () => {
  it('من غير ✕ ← ظاهر', () => expect(isHidden({}, 'offline', {}, T)).toBe(false));
  it('مقفول لحد آخر مللي ثانية قبل المدة، وظاهر عندها بالظبط', () => {
    const d = { offline: T };
    const chosen = { offline: '1h' };
    expect(isHidden(d, 'offline', chosen, T + H - 1)).toBe(true);
    expect(isHidden(d, 'offline', chosen, T + H)).toBe(false);
  });
  it('المدة لكل نوع: ساعة للتحذير ويوم للروتيني، الاتنين اتقفلوا مع بعض', () => {
    const d = { offline: T, [bannerKey('lowBalance', 'w1')]: T };
    const chosen = { offline: '1h', lowBalance: '1d' };
    expect(isHidden(d, 'offline', chosen, T + 2 * H)).toBe(false);
    expect(isHidden(d, 'lowBalance:w1', chosen, T + 2 * H)).toBe(true);
  });
  it('المدة اتغيّرت بعد الـ✕ ← بتتحسب من وقت الـ✕ بالمدة الجديدة', () => {
    const d = { lowBalance: T };
    expect(isHidden(d, 'lowBalance', { lowBalance: '7d' }, T + 2 * 24 * H)).toBe(true);
    expect(isHidden(d, 'lowBalance', { lowBalance: '1h' }, T + 2 * 24 * H)).toBe(false);
  });
  it('الساعة رجعت لورا (وقت الـ✕ في المستقبل) ← مبيفضلش مقفول أكتر من المدة', () => {
    expect(hiddenUntil({ offline: T + 10 * H }, 'offline', { offline: '1h' }, T)).toBe(T + H);
  });
  it('اختيار مش معروف أو بايظ ← الافتراضي', () => {
    expect(intervalMs('offline', { offline: 'zzz' })).toBe(H);
    expect(intervalMs('lowBalance', undefined)).toBe(24 * H);
    expect(DEFAULT_INTERVAL).toEqual({ warning: '1h', routine: '1d' });
  });
  it('تحذيرات الأرقام مددها ساعات بس (مفيش يوم)', () => {
    expect(WARNING_BANNERS).toEqual(['loadError', 'offline', 'stale']);
    expect(Math.max(...WARNING_INTERVALS.map(o => o.ms))).toBe(3 * H);
    expect(ROUTINE_INTERVALS.map(o => o.id)).toEqual(['1h', '1d', '3d', '7d']);
    // اختيار روتيني على نوع تحذير ← الافتراضي، مش أسبوع
    expect(intervalMs('stale', { stale: '7d' })).toBe(H);
  });
});

describe('nextReturnAt / pruneExpired', () => {
  it('أقرب رجوع جاي، و null لو مفيش', () => {
    expect(nextReturnAt({}, {}, T)).toBeNull();
    const d = { offline: T, lowBalance: T };
    expect(nextReturnAt(d, { offline: '15m', lowBalance: '1d' }, T + 1)).toBe(T + 15 * 60_000);
  });
  it('المنتهي بيتشال (مفاتيح محافظ ممسوحة ومعادات فاتت مبتتراكمش)', () => {
    const d = { offline: T, [bannerKey('subscriptionDue', 's1@2026-01-01')]: T + 2 * H };
    expect(pruneExpired(d, { offline: '1h', subscriptionDue: '1d' }, T + 3 * H)).toEqual({ 'subscriptionDue:s1@2026-01-01': T + 2 * H });
  });
  it('المؤقّت مبيعدّيش حد setTimeout (أسبوع وأكتر)', () => {
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1);
    expect(7 * 24 * H).toBeLessThan(MAX_TIMER_MS);
  });
});

describe('القراية من التخزين: أي حاجة بايظة ← فاضي (البانر يظهر)', () => {
  it.each([null, '', '{bad', '[]', '"x"', '42'])('%s', raw => {
    expect(parseDismissals(raw)).toEqual({});
    expect(parseIntervals(raw)).toEqual({});
  });
  it('قيمة مش رقم بتتشال والباقي فاضل', () => {
    expect(parseDismissals('{"offline":"x","stale":5}')).toEqual({ stale: 5 });
  });
});

describe('ساعة التذكير اليومي', () => {
  it('0 (12 بالليل) صالحة — `Number(x) || 20` كان بيقلبها 20', () => {
    expect(parseDailyHour('0')).toBe(0);
    expect(parseDailyHour(0)).toBe(0);
  });
  it.each([null, '', 'x', '24', '-1', '7.5', undefined])('%s ← الافتراضي', raw => {
    expect(parseDailyHour(raw as never)).toBe(DEFAULT_DAILY_HOUR);
  });
  it('23 صالحة', () => expect(parseDailyHour('23')).toBe(23));
});
