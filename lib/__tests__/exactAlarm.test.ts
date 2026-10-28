import fs from 'fs';
import path from 'path';
import { Linking } from 'react-native';
import { EXACT_ALARM_ACTION, exactAlarmStatus, openExactAlarmSettings } from '@/lib/exactAlarm';

/**
 * إذن "المنبهات والتذكيرات" (2026-10-28): أندرويد 12+ من غيره التذكير تقريبي.
 * الحالة مبتتقريش من التطبيق (مفيش module بيعرض canScheduleExactAlarms) ← unknown.
 */

describe('exactAlarmStatus', () => {
  it('iOS والويب ← مش محتاج', () => {
    expect(exactAlarmStatus({ os: 'ios', apiLevel: 17 })).toBe('not-needed');
    expect(exactAlarmStatus({ os: 'web', apiLevel: undefined })).toBe('not-needed');
  });
  it('أندرويد 30 ← مش محتاج، و31 ← محتاج (حالته مش معروفة)', () => {
    expect(exactAlarmStatus({ os: 'android', apiLevel: 30 })).toBe('not-needed');
    expect(exactAlarmStatus({ os: 'android', apiLevel: 31 })).toBe('unknown');
    expect(exactAlarmStatus({ os: 'android', apiLevel: 34 })).toBe('unknown');
  });
  it('لو اتقرت في يوم: true ← granted، false ← denied', () => {
    expect(exactAlarmStatus({ os: 'android', apiLevel: 34, canSchedule: true })).toBe('granted');
    expect(exactAlarmStatus({ os: 'android', apiLevel: 34, canSchedule: false })).toBe('denied');
  });
  it('مستوى API غريب ← مبيرميش', () => {
    for (const v of [undefined, NaN, 'abc', null]) expect(() => exactAlarmStatus({ os: 'android', apiLevel: v })).not.toThrow();
    expect(exactAlarmStatus({ os: 'android', apiLevel: '33' })).toBe('unknown');
  });
});

describe('openExactAlarmSettings', () => {
  afterEach(() => jest.restoreAllMocks());
  it('بيفتح الإعداد بالأكشن ده بالظبط', async () => {
    const send = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    expect(await openExactAlarmSettings()).toBe(true);
    expect(send).toHaveBeenCalledWith(EXACT_ALARM_ACTION);
    expect(EXACT_ALARM_ACTION).toBe('android.settings.REQUEST_SCHEDULE_EXACT_ALARM');
    expect(settings).not.toHaveBeenCalled();
  });
  it('الأكشن اترفض ← تفاصيل التطبيق', async () => {
    jest.spyOn(Linking, 'sendIntent').mockRejectedValue(new Error('no activity'));
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    expect(await openExactAlarmSettings()).toBe(true);
    expect(settings).toHaveBeenCalled();
  });
  it('الاتنين اترفضوا ← false من غير رمي', async () => {
    jest.spyOn(Linking, 'sendIntent').mockRejectedValue(new Error('x'));
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('y'));
    await expect(openExactAlarmSettings()).resolves.toBe(false);
  });
});

describe('app.json', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app.json'), 'utf8'));
  const perms: string[] = app.expo.android.permissions;
  it('فيه SCHEDULE_EXACT_ALARM جنب POST_NOTIFICATIONS', () => {
    expect(perms).toEqual(expect.arrayContaining(['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM']));
  });
  it('مفيش USE_EXACT_ALARM (سياسة Play: للمنبّه والتقويم بس) في أي ملف إعداد', () => {
    for (const f of ['app.json', 'app.config.js']) {
      expect(fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')).not.toMatch(/USE_EXACT_ALARM/);
    }
  });
  it('app.config.js مبيمسحش أذونات app.json (بيعمل spread لـconfig.android)', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', '..', 'app.config.js'), 'utf8')).toMatch(/\.\.\.config\.android/);
  });
});
