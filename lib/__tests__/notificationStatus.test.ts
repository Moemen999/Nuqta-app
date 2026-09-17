import { hourLabel, notificationsStatus } from '@/lib/notificationStatus';

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
