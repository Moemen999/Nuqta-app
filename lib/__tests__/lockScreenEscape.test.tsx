import LockScreen, {
  FORGOT_BODY, FORGOT_CONFIRM, FORGOT_LABEL,
  FORGOT_OFFLINE_CONTINUE, FORGOT_OFFLINE_TITLE, FORGOT_TITLE,
} from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

/**
 * القفل بيتحط قدام التطبيق كله قبل حتى شاشة الدخول. يعني المستخدم اللي بينسى
 * كوده مكانش قدامه أي طريق غير إنه يمسح التطبيق — وعلى آيفون الكيتشين ممكن
 * يعيش بعد المسح، فحتى ده مش مضمون.
 *
 * مفيش بصمة في التطبيق أصلاً (`LockType` = pin أو password بس)، فالمخرج
 * الوحيد الممكن هو الربط بباسورد الحساب.
 */

const mockLock = {
  lockType: 'pin' as 'pin' | 'password',
  verify: jest.fn(async () => false),
  unlock: jest.fn(),
  clearLock: jest.fn(async () => {}),
};
const mockAuth = { logOut: jest.fn(async () => {}) };
const mockData = { serverReachable: true };

jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

/** RNTL بترجّع host elements من غير `findAll`، فبنمشي على الشجرة بنفسنا */
function hasDescendant(node: any, testID: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.props?.testID === testID) return true;
  return (node.children ?? []).some((c: any) => hasDescendant(c, testID));
}

async function renderLock() {
  return render(<ThemeProvider><LockScreen /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLock.lockType = 'pin';
  mockData.serverReachable = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('مخرج "نسيت الكود؟"', () => {
  it('موجود مع القفل الرقمي', async () => {
    await renderLock();
    expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
    expect(screen.getByText(FORGOT_LABEL)).toBeTruthy();
  });

  it('موجود مع الباسورد النصي كمان', async () => {
    mockLock.lockType = 'password';
    await renderLock();
    expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
  });

  it('بيسأل الأول — مبيشلش القفل من غير تأكيد', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    expect(Alert.alert).toHaveBeenCalled();
    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe(FORGOT_TITLE);
    expect(mockLock.clearLock).not.toHaveBeenCalled();
    expect(mockAuth.logOut).not.toHaveBeenCalled();
  });

  it('التأكيد بيشيل القفل **و**بيخرج من الحساب', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    const buttons = (Alert.alert as unknown as jest.Mock).mock.calls[0][2];
    const confirm = buttons.find((b: any) => b.text === FORGOT_CONFIRM);
    expect(confirm).toBeDefined();
    await act(async () => { await confirm.onPress(); });

    expect(mockLock.clearLock).toHaveBeenCalled();
    expect(mockAuth.logOut).toHaveBeenCalled();
  });

  it('الإلغاء مبيعملش حاجة', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    const buttons = (Alert.alert as unknown as jest.Mock).mock.calls[0][2];
    const cancel = buttons.find((b: any) => b.style === 'cancel');
    expect(cancel).toBeDefined();
    expect(mockLock.clearLock).not.toHaveBeenCalled();
  });
});

describe('المخرج لازم يفضل واصل والكيبورد مفتوح', () => {
  /**
   * الشاشة دي كانت `TextInput` مع `autoFocus` جوه `View` مركزي، من غير
   * `KeyboardAvoidingView` ومن غير تمرير. يعني على موبايل قصير الكيبورد
   * بيغطي "دخول" و"نسيت الكود؟" ومفيش أي طريق توصلهم — المخرج الوحيد من
   * الحبسة بيبقى هو نفسه محبوس.
   */
  it('الشاشة ملفوفة بـKeyboardAvoidingView', async () => {
    mockLock.lockType = 'password';
    await renderLock();
    expect(screen.getByTestId('lock_kav')).toBeTruthy();
  });

  it('فيه ScrollView فالفورم بيتمرّر لو طال', async () => {
    mockLock.lockType = 'password';
    await renderLock();
    expect(screen.getByTestId('lock_scroll')).toBeTruthy();
  });

  it('زرار "نسيت الكود؟" برّه الـScrollView — مش بيتمرّر بعيد ولا بيتغطى', async () => {
    mockLock.lockType = 'password';
    await renderLock();
    const scroll = screen.getByTestId('lock_scroll');
    expect(hasDescendant(scroll, 'lock_forgot_button')).toBe(false);
    expect(screen.getByTestId('lock_footer')).toBeTruthy();
    expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
    // وزرار "دخول" نفسه جوه المنطقة اللي بتتمرّر، فبيتوصل بالتمرير
    expect(hasDescendant(scroll, 'lock_submit_button')).toBe(true);
  });

  it('نفس الكلام مع القفل الرقمي', async () => {
    await renderLock();
    const scroll = screen.getByTestId('lock_scroll');
    expect(hasDescendant(scroll, 'lock_forgot_button')).toBe(false);
    expect(screen.getByTestId('lock_forgot_button')).toBeTruthy();
  });
});

describe('من غير نت', () => {
  /**
   * شيل القفل + خروج من غير نت = المستخدم برّه التطبيق ومش قادر يرجع.
   * بنحذّره الأول بدل ما يكتشف بنفسه.
   */
  it('بيحذّر إن النت مطلوب قبل أي حاجة', async () => {
    mockData.serverReachable = false;
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe(FORGOT_OFFLINE_TITLE);
    expect(mockLock.clearLock).not.toHaveBeenCalled();
    expect(mockAuth.logOut).not.toHaveBeenCalled();
  });

  it('مبيمنعوش — `serverReachable` بتبدأ false حتى والنت شغال، فلازم يفضل قدامه مخرج', async () => {
    mockData.serverReachable = false;
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });

    const offlineButtons = (Alert.alert as unknown as jest.Mock).mock.calls[0][2];
    const carryOn = offlineButtons.find((b: any) => b.text === FORGOT_OFFLINE_CONTINUE);
    expect(carryOn).toBeDefined();

    // "كمّل" بتوديه على رسالة التأكيد العادية، مش بتشيل القفل على طول
    await act(async () => { carryOn.onPress(); });
    expect((Alert.alert as unknown as jest.Mock).mock.calls[1][0]).toBe(FORGOT_TITLE);
    expect(mockLock.clearLock).not.toHaveBeenCalled();

    const confirm = (Alert.alert as unknown as jest.Mock).mock.calls[1][2]
      .find((b: any) => b.text === FORGOT_CONFIRM);
    await act(async () => { await confirm.onPress(); });
    expect(mockLock.clearLock).toHaveBeenCalled();
    expect(mockAuth.logOut).toHaveBeenCalled();
  });

  it('مع النت شغال بيروح على رسالة التأكيد على طول', async () => {
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); });
    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe(FORGOT_TITLE);
  });
});

describe('نص رسالة "نسيت الكود؟"', () => {
  it('مبيقولش "بإيميلك وباسوردك" — اللي داخل بجوجل معندهوش باسورد أصلاً', () => {
    expect(FORGOT_BODY).not.toContain('ترجع تدخل بإيميلك وباسوردك');
    expect(FORGOT_BODY).toContain('بجوجل');
  });

  it('بيقول إن فيه "نسيت الباسورد؟" في شاشة الدخول', () => {
    expect(FORGOT_BODY).toContain('نسيت الباسورد؟');
  });

  it('بيقول إن النت مطلوب عشان يرجع يدخل', () => {
    expect(FORGOT_BODY).toContain('محتاج نت عشان ترجع تدخل');
  });
});
