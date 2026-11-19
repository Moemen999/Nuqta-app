import LockSettingsScreen from '@/app/settings-screens/lock';
import SetLockModal from '@/components/SetLockModal';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { warmUp } from '@/test-utils/warmUp';

/**
 * الميزة 11: بند 9 (الرقم السري 4 أرقام بس)، بند 13 (تخفيف القفل بيطلب الكود الأول — زي الإلغاء)، ونصوص المودال.
 */

const mockLock = {
  enabled: true,
  lockType: 'pin' as 'pin' | 'password',
  frequency: 'everyResume' as 'onOpen' | 'everyResume',
  graceMinutes: 1,
  isLocked: false,
  waitUntil: 0,
  setupLock: jest.fn(async () => {}),
  disableLock: jest.fn(async () => 'ok'),
  changeCode: jest.fn(async () => 'ok'),
  setFrequency: jest.fn(async () => true),
  setGraceMinutes: jest.fn(async () => true),
  verify: jest.fn(async () => 'ok'),
};
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/components/BackButton', () => 'BackButton');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const wrap = (el: React.ReactElement) => <ThemeProvider><NoticeProvider>{el}</NoticeProvider></ThemeProvider>;
warmUp(() => wrap(<LockSettingsScreen />));
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockLock, { enabled: true, lockType: 'pin', frequency: 'everyResume', graceMinutes: 1 });
});
const press = async (id: string) => { await act(async () => { fireEvent.press(screen.getByTestId(id)); }); };
const type = async (id: string, v: string) => { await act(async () => { fireEvent.changeText(screen.getByTestId(id), v); }); };

describe('13: التخفيف بيطلب الكود', () => {
  it('«كل مرة» ← «عند الفتح»: مفيش حفظ قبل الكود، وبعد الكود الصح بيتحفظ', async () => {
    await render(wrap(<LockSettingsScreen />));
    await press('lock_freq_on_open');
    expect(mockLock.setFrequency).not.toHaveBeenCalled();
    await type('setlock_old_code', '1234');
    await press('setlock_submit');
    expect(mockLock.verify).toHaveBeenCalledWith('1234');
    expect(mockLock.setFrequency).toHaveBeenCalledWith('onOpen');
  });
  it('الكود غلط ← مفيش حفظ', async () => {
    mockLock.verify.mockResolvedValueOnce('wrong');
    await render(wrap(<LockSettingsScreen />));
    await press('lock_freq_on_open');
    await type('setlock_old_code', '0000');
    await press('setlock_submit');
    expect(mockLock.setFrequency).not.toHaveBeenCalled();
  });
  it('مهلة أطول ← بتطلب الكود؛ وأقصر ← على طول', async () => {
    await render(wrap(<LockSettingsScreen />));
    await press('lock_grace_0');
    expect(mockLock.setGraceMinutes).toHaveBeenCalledWith(0);
    await press('lock_grace_15');
    expect(mockLock.setGraceMinutes).toHaveBeenCalledTimes(1);
    await type('setlock_old_code', '1234');
    await press('setlock_submit');
    expect(mockLock.setGraceMinutes).toHaveBeenLastCalledWith(15);
  });
  it('التشديد («عند الفتح» ← «كل مرة») مبيطلبش كود', async () => {
    mockLock.frequency = 'onOpen';
    await render(wrap(<LockSettingsScreen />));
    await press('lock_freq_every_resume');
    expect(mockLock.setFrequency).toHaveBeenCalledWith('everyResume');
    expect(mockLock.verify).not.toHaveBeenCalled();
  });
});

describe('9: الرقم السري أرقام بس', () => {
  it('«12a4» ← رسالة ومفيش تفعيل', async () => {
    await render(wrap(<SetLockModal visible mode="enable" onClose={() => {}} />));
    await type('setlock_code1', '12a4');
    await type('setlock_code2', '12a4');
    await press('setlock_submit');
    expect(mockLock.setupLock).not.toHaveBeenCalled();
    expect(screen.getByText('الرقم السري لازم يكون 4 أرقام بس، من غير حروف ولا مسافات')).toBeTruthy();
  });
  it('التغيير: «1 23» ← رسالة ومفيش تغيير', async () => {
    await render(wrap(<SetLockModal visible mode="change" onClose={() => {}} />));
    await type('setlock_old_code', '1234');
    await type('setlock_code1', '1 23');
    await type('setlock_code2', '1 23');
    await press('setlock_submit');
    expect(mockLock.changeCode).not.toHaveBeenCalled();
  });
});

describe('النصوص', () => {
  it('زرار التأكيد حسب الوضع', async () => {
    const r = await render(wrap(<SetLockModal visible mode="enable" onClose={() => {}} />));
    expect(screen.getByTestId('setlock_submit')).toHaveTextContent('فعّل القفل');
    await r.rerender(wrap(<SetLockModal visible mode="change" onClose={() => {}} />));
    expect(screen.getByTestId('setlock_submit')).toHaveTextContent('غيّر الكود');
    expect(screen.getByText('تغيير الكود')).toBeTruthy();
    await r.rerender(wrap(<SetLockModal visible mode="disable" onClose={() => {}} />));
    expect(screen.getByTestId('setlock_submit')).toHaveTextContent('الغي القفل');
  });
  it('الكود الحالي فاضي ← «دخّل الرقم السري الحالي» / «دخّل الباسورد الحالي»', async () => {
    const r = await render(wrap(<SetLockModal visible mode="disable" onClose={() => {}} />));
    await press('setlock_submit');
    expect(screen.getByText('دخّل الرقم السري الحالي')).toBeTruthy();
    mockLock.lockType = 'password';
    await r.rerender(wrap(<SetLockModal visible mode="disable" onClose={() => {}} />));
    await press('setlock_submit');
    expect(screen.getByText('دخّل الباسورد الحالي')).toBeTruthy();
  });
  it('باسورد قصير', async () => {
    await render(wrap(<SetLockModal visible mode="enable" onClose={() => {}} />));
    await press('setlock_type_password');
    await type('setlock_code1', 'ab');
    await type('setlock_code2', 'ab');
    await press('setlock_submit');
    expect(screen.getByText('الباسورد لازم يكون 4 حروف أو أرقام على الأقل')).toBeTruthy();
  });
  it('شاشة القفل: «تغيير الكود» و«يطلب الكود إمتى؟»', async () => {
    await render(wrap(<LockSettingsScreen />));
    expect(screen.getByTestId('lock_change_button')).toHaveTextContent('تغيير الكود');
    expect(screen.getByText('يطلب الكود إمتى؟')).toBeTruthy();
  });
});
