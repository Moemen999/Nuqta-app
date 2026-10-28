import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NotificationsScreen, {
  EXACT_ALARM_BODY, EXACT_ALARM_FAILED_BODY, EXACT_ALARM_FAILED_TITLE, EXACT_ALARM_STATUS_UNKNOWN,
} from '@/app/settings-screens/notifications';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * كارت "المنبهات والتذكيرات" في إعدادات الإشعارات (2026-10-28): ظاهر بس على أندرويد 12+
 * والإشعارات شغالة، بيقول إن الحالة مش معروفة (مش "مفعّل" ولا "مقفول")، والزرار بيفتح
 * الإعداد مرة واحدة، ولو الفتح فشل بيقول تعمل إيه.
 */
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockNotifs: Record<string, unknown> = {};
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => mockNotifs }));

let alertSpy: jest.SpyInstance;
const setPlatform = (os: string, version: number) => {
  jest.replaceProperty(Platform, 'OS', os as typeof Platform.OS);
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version as never);
};
beforeEach(() => {
  Object.assign(mockNotifs, {
    enabled: true, dailyEnabled: true, dailyHour: 20, loading: false,
    enableNotifications: jest.fn(), disableNotifications: jest.fn(), setDailyEnabled: jest.fn(), setDailyHour: jest.fn(),
    refreshPermission: jest.fn(), openExactAlarmSettings: jest.fn(async () => true),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { alertSpy.mockRestore(); jest.restoreAllMocks(); });

const mount = async () => { await render(<ThemeProvider><NotificationsScreen /></ThemeProvider>); await act(async () => {}); };
const card = () => screen.queryByTestId('exact_alarm_card');

describe('ظهور الكارت', () => {
  it('أندرويد 14 والإشعارات شغالة ← ظاهر، والحالة "مش معروفة" مش مفعّل/مقفول', async () => {
    setPlatform('android', 34);
    await mount();
    expect(card()).toBeTruthy();
    expect(screen.getByText(EXACT_ALARM_BODY)).toBeTruthy();
    expect(screen.getByTestId('exact_alarm_status').props.children).toBe(EXACT_ALARM_STATUS_UNKNOWN);
  });
  it('أندرويد 12 بالظبط (31) ← ظاهر', async () => {
    setPlatform('android', 31);
    await mount();
    expect(card()).toBeTruthy();
  });
  it.each([['ios', 17], ['android', 30]])('%s %s ← مش ظاهر', async (os, v) => {
    setPlatform(os, v as number);
    await mount();
    expect(card()).toBeNull();
  });
  it('الإشعارات مقفولة ← مش ظاهر', async () => {
    setPlatform('android', 34);
    mockNotifs.enabled = false;
    await mount();
    expect(card()).toBeNull();
  });
});

describe('الزرار', () => {
  beforeEach(() => setPlatform('android', 34));
  it('بيفتح الإعداد مرة واحدة، ومفيش رسالة لو اتفتح', async () => {
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('exact_alarm_open')); });
    expect(mockNotifs.openExactAlarmSettings).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('exact_alarm_open').props.accessibilityRole).toBe('button');
  });
  it('الفتح فشل ← رسالة بتقول تعمل إيه', async () => {
    mockNotifs.openExactAlarmSettings = jest.fn(async () => false);
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('exact_alarm_open')); });
    expect(alertSpy).toHaveBeenCalledWith(EXACT_ALARM_FAILED_TITLE, EXACT_ALARM_FAILED_BODY);
  });
  it('دوستين ورا بعض والأولى لسه شغالة ← فتحة واحدة', async () => {
    let resolve!: (v: boolean) => void;
    mockNotifs.openExactAlarmSettings = jest.fn(() => new Promise<boolean>(r => { resolve = r; }));
    await mount();
    const btn = screen.getByTestId('exact_alarm_open');
    await act(async () => { fireEvent.press(btn); fireEvent.press(btn); });
    await act(async () => { resolve(true); });
    expect(mockNotifs.openExactAlarmSettings).toHaveBeenCalledTimes(1);
  });
});
