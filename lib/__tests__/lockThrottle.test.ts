import {
  FREE_ATTEMPTS, lockDelayMs, lockWaitMessage, parseLockFails, parseStoredHash, formatStoredHash, recordFailure, remainingWaitMs,
} from '@/lib/lockThrottle';

describe('حد محاولات القفل — المنطق الصافي', () => {
  it('أول 3 غلط من غير تأخير، والتالت بيبدأ 30 ثانية، وبيزيد لحد ساعة ويقف', () => {
    expect(FREE_ATTEMPTS).toBe(3);
    expect([0, 1, 2].map(lockDelayMs)).toEqual([0, 0, 0]);
    expect(lockDelayMs(3)).toBe(30_000);
    expect(lockDelayMs(4)).toBe(60_000);
    expect(lockDelayMs(5)).toBe(300_000);
    expect(lockDelayMs(6)).toBe(900_000);
    expect(lockDelayMs(7)).toBe(3_600_000);
    expect(lockDelayMs(500)).toBe(3_600_000);
  });

  it('العدّاد البايظ في التخزين = صفر (مبيقفلش صاحب الموبايل)', () => {
    for (const raw of [null, '', 'x', '{"count":"3"}', '{"count":-1,"until":-5}', '{"count":1e999}', '[]']) {
      expect(parseLockFails(raw)).toEqual({ count: 0, until: 0 });
    }
    expect(parseLockFails('{"count":4,"until":123}')).toEqual({ count: 4, until: 123 });
  });

  it('غلط جديد: العدّ بيزيد والانتظار من دلوقتي', () => {
    const a = recordFailure({ count: 2, until: 0 }, 1000);
    expect(a).toEqual({ count: 3, until: 31_000 });
    expect(remainingWaitMs(a, 1000)).toBe(30_000);
    expect(remainingWaitMs(a, 40_000)).toBe(0);
    expect(recordFailure({ count: 0, until: 0 }, 1000)).toEqual({ count: 1, until: 0 });
  });

  it('الرسالة بالعامية والعدد بصيغته', () => {
    expect(lockWaitMessage(30_000)).toBe('استنى 30 ثانية وجرّب تاني');
    expect(lockWaitMessage(1_500)).toBe('استنى ثانيتين وجرّب تاني');
    expect(lockWaitMessage(500)).toBe('استنى ثانية وجرّب تاني');
    expect(lockWaitMessage(5_000)).toBe('استنى 5 ثواني وجرّب تاني');
    expect(lockWaitMessage(60_000)).toBe('استنى دقيقة وجرّب تاني');
    expect(lockWaitMessage(299_000)).toBe('استنى 5 دقايق وجرّب تاني');
    expect(lockWaitMessage(900_000)).toBe('استنى 15 دقيقة وجرّب تاني');
    expect(lockWaitMessage(3_600_000)).toBe('استنى ساعة وجرّب تاني');
  });

  it('الهاش المتخزّن: v2 بملح، والقديم من غير ملح بيتقري زي ما هو', () => {
    expect(parseStoredHash(formatStoredHash('ab', 'cd'))).toEqual({ salt: 'ab', hash: 'cd' });
    expect(parseStoredHash('deadbeef')).toEqual({ salt: null, hash: 'deadbeef' });
  });
});
