import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import FirstRunSetup from '@/components/FirstRunSetup';
import { ThemeProvider } from '@/context/ThemeContext';
import { SETUP_FAIL_MESSAGE, SETUP_OTHER_MESSAGE, SKIP_SETUP, normalizeAmountInput, setupFingerprint, validateSetupChoice } from '@/lib/firstRunSetup';
import { Alert } from 'react-native';
import { warmUp } from '@/test-utils/warmUp';

/**
 * شاشة "نبدأ بإيه؟". الحفظ نفسه متختبر على المحاكي
 * (context/__tests__/firstRunSetup.emulator.test.tsx)؛ هنا الشاشة: إنها
 * بتبعت الصح، وإن الفشل بيتقال وفيه "جرّب تاني"، وإن مفيش طريق يطلّع حساب
 * من غير محافظ.
 */

const mockCompleteSetup = jest.fn();
jest.mock('@/context/DataContext', () => ({ useData: () => ({ completeSetup: mockCompleteSetup }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mount = () => render(<ThemeProvider><FirstRunSetup /></ThemeProvider>);
warmUp(() => <ThemeProvider><FirstRunSetup /></ThemeProvider>);

beforeEach(() => { mockCompleteSetup.mockReset(); });
const press = async (id: string) => { await act(async () => { fireEvent.press(screen.getByTestId(id)); }); };

describe('"تخطي"', () => {
  it('بيحفظ المجموعة الصغيرة المعقولة بنفس الطريق', async () => {
    mockCompleteSetup.mockResolvedValue('done');
    await mount();
    await press('setup_skip');
    expect(mockCompleteSetup).toHaveBeenCalledWith(SKIP_SETUP);
    expect(SKIP_SETUP.wallets.length).toBeGreaterThan(0);
  });
});

describe('الفشل بيتقال', () => {
  it.each([['no-connection'], ['failed']] as const)('%s ← رسالة واضحة و"جرّب تاني" بيبعت نفس الاختيارات تاني', async (kind) => {
    mockCompleteSetup.mockResolvedValueOnce(kind).mockResolvedValueOnce('done');
    await mount();
    await press('setup_skip');
    expect(screen.getByTestId('setup_error')).toBeTruthy();
    expect(screen.getByText(SETUP_FAIL_MESSAGE[kind].title)).toBeTruthy();
    expect(screen.getByText(SETUP_FAIL_MESSAGE[kind].body)).toBeTruthy();
    await press('setup_retry');
    expect(mockCompleteSetup).toHaveBeenCalledTimes(2);
    expect(mockCompleteSetup.mock.calls[1][0]).toEqual(mockCompleteSetup.mock.calls[0][0]);
  });

  it('"رجوع للاختيارات" بيرجّع الشاشة من غير ما يحفظ حاجة', async () => {
    mockCompleteSetup.mockResolvedValueOnce('failed');
    await mount();
    await press('setup_skip');
    await press('setup_error_back');
    expect(screen.getByTestId('setup_start')).toBeTruthy();
    expect(mockCompleteSetup).toHaveBeenCalledTimes(1);
  });
});

describe('الطريق الكامل', () => {
  it('كاش برصيد + حساب بنكي + فئة زيادة ← بيتبعتوا بالأرصدة', async () => {
    mockCompleteSetup.mockResolvedValue('done');
    await mount();
    await press('setup_start');
    await act(async () => { fireEvent.changeText(screen.getByTestId('setup_balance_cash'), '1500'); });
    await press('setup_wallet_bank');
    await act(async () => { fireEvent.changeText(screen.getByTestId('setup_balance_bank'), '-250.5'); });
    await press('setup_next');
    await act(async () => { fireEvent.changeText(screen.getByTestId('setup_custom_cat_input'), 'قهوة'); });
    await press('setup_custom_cat_add');
    await press('setup_finish');
    const sent = mockCompleteSetup.mock.calls[0][0];
    expect(sent.wallets).toEqual([{ name: 'كاش', openingBalance: 1500 }, { name: 'حساب بنكي', openingBalance: -250.5 }]);
    expect(sent.categories).toContain('قهوة');
    expect(validateSetupChoice(sent)).toBeNull();
  });

  it('مفيش حساب من غير محافظ: شيل الكاش ودوس "التالي" ← رسالة، ومفيش حفظ', async () => {
    await mount();
    await press('setup_start');
    await press('setup_wallet_cash');
    await press('setup_next');
    expect(screen.getByText(/اختار محفظة واحدة على الأقل/)).toBeTruthy();
    expect(screen.queryByTestId('setup_finish')).toBeNull();
    expect(mockCompleteSetup).not.toHaveBeenCalled();
  });

  it('رصيد مش رقم ← رسالة بالاسم، ومفيش حفظ', async () => {
    await mount();
    await press('setup_start');
    await act(async () => { fireEvent.changeText(screen.getByTestId('setup_balance_cash'), 'مية'); });
    await press('setup_next');
    expect(screen.getByText('رصيد "كاش" مش رقم.')).toBeTruthy();
    expect(mockCompleteSetup).not.toHaveBeenCalled();
  });

  it('مفيش فئة ← رسالة، ومفيش حفظ', async () => {
    await mount();
    await press('setup_start');
    await press('setup_next');
    for (const i of [0, 1, 2, 3, 7]) await press(`setup_cat_${i}`); // المختارين من الأول
    await press('setup_finish');
    expect(screen.getByText('اختار فئة واحدة على الأقل.')).toBeTruthy();
    expect(mockCompleteSetup).not.toHaveBeenCalled();
  });
});

describe('validateSetupChoice', () => {
  it('اسمين متشابهين ← مرفوض', () => {
    expect(validateSetupChoice({ wallets: [{ name: 'كاش', openingBalance: 0 }, { name: ' كاش ', openingBalance: 0 }], categories: ['أكل'] }))
      .toBe('فيه محفظتين بنفس الاسم.');
  });
});

describe('الحساب اتجهّز باختيارات تانية', () => {
  it('already-done-other ← Alert بيقول إن الأرقام اللي اتحفظت مش اللي قدامك', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCompleteSetup.mockResolvedValue('already-done-other');
    await mount();
    await press('setup_skip');
    expect(alert).toHaveBeenCalledWith(SETUP_OTHER_MESSAGE.title, SETUP_OTHER_MESSAGE.body, expect.anything());
    alert.mockRestore();
  });
});

describe('normalizeAmountInput — أول شاشة بتقبل اللي الناس بتكتبه', () => {
  it.each([['١٥٠٠', '1500'], ['1,500', '1500'], ['١٬٥٠٠٫٥', '1500.5'], ['−٥٠٠', '-500'], [' 250 ', '250']])('%s ← %s', (a, b) => {
    expect(normalizeAmountInput(a)).toBe(b);
  });

  it('رصيد بأرقام عربية بيتبعت رقم صح', async () => {
    mockCompleteSetup.mockResolvedValue('done');
    await mount();
    await press('setup_start');
    await act(async () => { fireEvent.changeText(screen.getByTestId('setup_balance_cash'), '١٬٥٠٠'); });
    await press('setup_next');
    await press('setup_finish');
    expect(mockCompleteSetup.mock.calls[0][0].wallets).toEqual([{ name: 'كاش', openingBalance: 1500 }]);
  });
});

describe('setupFingerprint', () => {
  it('الترتيب والمسافات مش بيفرقوا؛ الرصيد بيفرق', () => {
    const a = { wallets: [{ name: 'كاش', openingBalance: 10 }, { name: 'بنك', openingBalance: 5 }], categories: ['أكل', 'فواتير'] };
    const b = { wallets: [{ name: ' بنك', openingBalance: 5 }, { name: 'كاش ', openingBalance: 10 }], categories: ['فواتير', 'أكل'] };
    expect(setupFingerprint(a)).toBe(setupFingerprint(b));
    expect(setupFingerprint(a)).not.toBe(setupFingerprint({ ...a, wallets: [{ name: 'كاش', openingBalance: 11 }, a.wallets[1]] }));
  });
});
