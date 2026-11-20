import { hourLabel, notificationsStatus, timeLabel, whenPhrase } from '@/lib/notificationStatus';

/**
 * سطر الحالة في صف الإعدادات لازم يقول الحقيقة: المستخدم بيبص عليه عشان
 * يعرف الإشعارات شغالة ولا لأ من غير ما يفتح الشاشة.
 */

describe('hourLabel', () => {
  it('الصبح بـص', () => {
    expect(hourLabel(8)).toBe('8 ص');
    expect(hourLabel(11)).toBe('11 ص');
  });

  it('بعد الضهر بـم', () => {
    expect(hourLabel(14)).toBe('2 م');
    expect(hourLabel(20)).toBe('8 م');
    expect(hourLabel(22)).toBe('10 م');
  });

  it('الساعة 12: الضهر م ونص الليل ص', () => {
    expect(hourLabel(12)).toBe('12 م');
    expect(hourLabel(0)).toBe('12 ص');
  });
});

describe('notificationsStatus', () => {
  it('مقفولة لما تكون متعطلة — حتى لو التذكير اليومي محفوظ مفعّل', () => {
    expect(notificationsStatus({ enabled: false, dailyEnabled: true, dailyHour: 20 }))
      .toBe('مقفولة');
  });

  it('بتقول معاد التذكير اليومي لما يكون مفعّل', () => {
    expect(notificationsStatus({ enabled: true, dailyEnabled: true, dailyHour: 20 }))
      .toBe('تذكير يومي 8 م');
  });

  it('مفعّلة من غير تفاصيل لما مفيش تذكير يومي', () => {
    expect(notificationsStatus({ enabled: true, dailyEnabled: false, dailyHour: 20 }))
      .toBe('مفعّلة');
  });
});

describe('whenPhrase (عدد الأيام بالعربي)', () => {
  it.each([
    [0, 'النهاردة'], [1, 'بكرة'], [2, 'بعد يومين'], [3, 'بعد 3 أيام'],
    [10, 'بعد 10 أيام'], [11, 'بعد 11 يوم'], [100, 'بعد 100 يوم'],
  ])('%i ← %s', (n, text) => expect(whenPhrase(n)).toBe(text));
  it('سالب أو NaN أو كسر ما بيطلعش جملة غلط', () => {
    expect(whenPhrase(-3)).toBe('النهاردة');
    expect(whenPhrase(NaN)).toBe('النهاردة');
    expect(whenPhrase(2.4)).toBe('بعد يومين');
  });
});

describe('timeLabel (بالدقيقة)', () => {
  it('الدقيقة 0 ← زي hourLabel، وغير كده بتبان', () => {
    expect(timeLabel(20, 0)).toBe('8 م');
    expect(timeLabel(21, 13)).toBe('9:13 م');
    expect(timeLabel(9, 5)).toBe('9:05 ص');
    expect(timeLabel(0, 30)).toBe('12:30 ص');
    expect(timeLabel(12, 55)).toBe('12:55 م');
  });
  it('سطر الحالة بيقول الدقيقة لما تكون مش صفر', () => {
    expect(notificationsStatus({ enabled: true, dailyEnabled: true, dailyHour: 21, dailyMinute: 13 })).toBe('تذكير يومي 9:13 م');
    expect(notificationsStatus({ enabled: true, dailyEnabled: true, dailyHour: 20 })).toBe('تذكير يومي 8 م');
  });
});

import { parseDailyMinute } from '@/context/NotificationsContext';
describe('parseDailyMinute', () => {
  it('0–59 بس، غير كده 0 (والمستخدم القديم من غير مفتاح ← :00)', () => {
    expect(parseDailyMinute('13')).toBe(13);
    expect(parseDailyMinute(59)).toBe(59);
    for (const bad of [null, undefined, '', '60', '-1', 'x', '1.5']) expect(parseDailyMinute(bad as any)).toBe(0);
  });
});
