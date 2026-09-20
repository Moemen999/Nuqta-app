import LockSettingsScreen, { GRACE_OPTIONS, LOCK_TYPE_LABEL } from '@/app/settings-screens/lock';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * حارس ضد التراجع.
 *
 * إعادة تنظيم الإعدادات (3d46334) نقلت صف "قفل التطبيق" لمودال "تغيير
 * الباسورد" على طول، فاختفى **إلغاء القفل** ومعاه وقت الطلب ومهلة السماح
 * ونوع القفل. المستخدم اللي فعّل القفل مبقاش يقدر يقفله — حبسة مش أمان،
 * وعدّت من غير ما يلاحظها حد لأن مفيش اختبار كان بيسأل "الأزرار لسه هنا؟".
 *
 * الاختبارات دي بتسأل السؤال ده صراحةً: كل زرار ضاع مرة، ليه سطر هنا.
 * أي نقلة جاية للإعدادات هتفشّلهم لو رمت أي واحد منهم تاني.
 */

const mockLock = {
  enabled: true,
  lockType: 'pin' as 'pin' | 'password',
  frequency: 'onOpen' as 'onOpen' | 'everyResume',
  graceMinutes: 0,
  isLocked: false,
  loading: false,
  setupLock: jest.fn(),
  disableLock: jest.fn(),
  clearLock: jest.fn(),
  changeCode: jest.fn(),
  setFrequency: jest.fn(),
  setGraceMinutes: jest.fn(),
  verify: jest.fn(),
  unlock: jest.fn(),
};

jest.mock('@/context/AppLockContext', () => ({
  useAppLock: () => mockLock,
}));

jest.mock('@/components/BackButton', () => 'BackButton');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/SetLockModal', () => 'SetLockModal');

async function renderScreen() {
  // الثيم الحقيقي — الشاشة بتقرا منه كل ألوانها، وتقليده كان هيخفي أي
  // استخدام للون مش موجود
  return render(
    <ThemeProvider>
      <LockSettingsScreen />
    </ThemeProvider>
  );
}

beforeEach(() => {
  mockLock.enabled = true;
  mockLock.lockType = 'pin';
  mockLock.frequency = 'onOpen';
  mockLock.graceMinutes = 0;
  jest.clearAllMocks();
});

describe('القفل مفعّل: كل زرار ضاع في إعادة التنظيم لازم يكون موجود', () => {
  it('زرار إلغاء القفل موجود — ده اللي ضاع وسبّب الحبسة', async () => {
    await renderScreen();
    expect(screen.getByTestId('lock_disable_button')).toBeTruthy();
    expect(screen.getByText('إلغاء القفل')).toBeTruthy();
  });

  it('زرار تغيير الباسورد موجود', async () => {
    await renderScreen();
    expect(screen.getByTestId('lock_change_button')).toBeTruthy();
  });

  it('نوع القفل ظاهر للمستخدم', async () => {
    await renderScreen();
    expect(screen.getByTestId('lock_status')).toBeTruthy();
    expect(screen.getByText(`القفل مفعّل (${LOCK_TYPE_LABEL.pin})`)).toBeTruthy();
  });

  it('نوع الباسورد النصي بيتعرض باسمه كمان', async () => {
    mockLock.lockType = 'password';
    await renderScreen();
    expect(screen.getByText(`القفل مفعّل (${LOCK_TYPE_LABEL.password})`)).toBeTruthy();
  });

  it('اختيار وقت الطلب موجود بالخيارين', async () => {
    await renderScreen();
    expect(screen.getByTestId('lock_freq_onOpen')).toBeTruthy();
    expect(screen.getByTestId('lock_freq_everyResume')).toBeTruthy();
    expect(screen.getByText('يطلب الباسورد إمتى؟')).toBeTruthy();
  });

  it('اختيار وقت الطلب بيتحفظ فعلاً', async () => {
    await renderScreen();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_freq_everyResume')); });
    expect(mockLock.setFrequency).toHaveBeenCalledWith('everyResume');
  });
});

describe('مهلة السماح', () => {
  it('مخفية لما الطلب مرة واحدة بس — زي الأصل', async () => {
    mockLock.frequency = 'onOpen';
    await renderScreen();
    expect(screen.queryByTestId('lock_grace_0')).toBeNull();
  });

  it('كل الخيارات الأربعة بتظهر مع "كل مرة ترجع"', async () => {
    mockLock.frequency = 'everyResume';
    await renderScreen();
    expect(screen.getByText('يقفل بعد قد إيه من خروجك من التطبيق؟')).toBeTruthy();
    GRACE_OPTIONS.forEach(opt => {
      expect(screen.getByTestId(`lock_grace_${opt.m}`)).toBeTruthy();
      expect(screen.getByText(opt.label)).toBeTruthy();
    });
  });

  it('الخيارات هي نفسها اللي كانت قبل إعادة التنظيم', () => {
    expect(GRACE_OPTIONS.map(o => o.m)).toEqual([0, 1, 5, 15]);
    expect(GRACE_OPTIONS.map(o => o.label)).toEqual(['فورًا', 'بعد دقيقة', 'بعد 5 دقايق', 'بعد 15 دقيقة']);
  });

  it('اختيار المهلة بيتحفظ فعلاً', async () => {
    mockLock.frequency = 'everyResume';
    await renderScreen();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_grace_5')); });
    expect(mockLock.setGraceMinutes).toHaveBeenCalledWith(5);
  });
});

describe('القفل مقفول', () => {
  it('زرار التفعيل موجود', async () => {
    mockLock.enabled = false;
    await renderScreen();
    expect(screen.getByTestId('lock_enable_button')).toBeTruthy();
  });

  it('مفيش أزرار إلغاء أو تغيير وإحنا مش مفعّلين', async () => {
    mockLock.enabled = false;
    await renderScreen();
    expect(screen.queryByTestId('lock_disable_button')).toBeNull();
    expect(screen.queryByTestId('lock_change_button')).toBeNull();
  });
});
