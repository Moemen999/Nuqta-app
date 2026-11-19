import WalletsScreen from '@/app/settings-screens/wallets';
import CategoriesScreen from '@/app/settings-screens/categories';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { DATA_LOADING_BODY, DATA_OFFLINE_BODY } from '@/lib/listenerErrors';
import { WALLET_AMOUNT_MAX, planWalletOpeningCommit, roundMoney, walletAmountRejectReason } from '@/lib/finance';
import { lowAlertGoneNotice, openingGoneNotice, walletAmountRejectNotice } from '@/lib/walletCopy';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { warmUp } from '@/test-utils/warmUp';

/** الميزة 10 — آخر البواقي (الجولة 2 على 0ec5c3a): النت سبب المنع، السقف، الأسامي الفاضية، والرجوع الساكت */

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));

const cash = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const bank = { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 0 };
const food = { id: 'c1', name: 'أكل' };
const trips = { id: 'c2', name: 'مواصلات' };

function seed(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [cash, bank], categories: [food, trips], transactions: [], brokenTransactions: [], budgets: {}, debts: [],
    subscriptions: [], gamiyas: [], incomes: [], serverReachable: true, loadErrors: [], figuresPending: [], undelivered: [],
    updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(async () => ({ outcome: 'done' })),
    archiveWallet: jest.fn(async () => ({ outcome: 'done' })), restoreWallet: jest.fn(),
    updateCategory: jest.fn(), addCategory: jest.fn(), deleteCategory: jest.fn(async () => ({ outcome: 'done' })),
    archiveCategory: jest.fn(async () => ({ outcome: 'done' })), restoreCategory: jest.fn(),
    ...over,
  });
}

const wrap = (el: React.ReactElement) => (
  <ThemeProvider><NoticeProvider><PrivacyProvider><ConfirmProvider>{el}</ConfirmProvider></PrivacyProvider></NoticeProvider></ThemeProvider>
);
const wallets = () => wrap(<WalletsScreen />);
const cats = () => wrap(<CategoriesScreen />);
warmUp(() => { seed(); return wallets(); });
beforeEach(() => { seed(); jest.clearAllMocks(); });

const noticeTitle = () => screen.getByTestId('notice_title').props.children;
const noticeBody = () => screen.getByTestId('notice_body').props.children;
const pressText = async (t: string) => { await act(async () => { fireEvent.press(screen.getByText(t)); }); };
const press = async (id: string) => { await act(async () => { fireEvent.press(screen.getByTestId(id)); }); };
const type = async (id: string, v: string) => {
  await act(async () => { fireEvent.changeText(screen.getByTestId(id), v); });
  await act(async () => { fireEvent(screen.getByTestId(id), 'blur'); });
};

describe('1: البيانات لسه بتوصل ومفيش نت ← السبب النت', () => {
  it('النص نفسه', () => {
    expect(DATA_OFFLINE_BODY).toBe('مفيش نت دلوقتي، فمقدرناش نتأكد إيه اللي مربوط بيها، وما اتعملش حاجة. جرّب لما النت يرجع.');
    expect(DATA_LOADING_BODY).toBe('بياناتك لسه بتوصل، فما اتعملش حاجة. استنى شوية وجرّب تاني.');
  });
  it('المحافظ: فتح المسح', async () => {
    seed({ figuresPending: ['transactions'], serverReachable: false });
    await render(wallets());
    await press('wallet_delete_w1');
    expect(noticeBody()).toBe(DATA_OFFLINE_BODY);
  });
  it('المحافظ: الدوسة على التأكيد بعد ما النت قطع', async () => {
    await render(wallets());
    await press('wallet_delete_w1');
    mockData.undelivered = ['debts'];
    mockData.serverReachable = false;
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
    expect(noticeBody()).toBe(DATA_OFFLINE_BODY);
  });
  it('الفئات: فتح المسح والدوسة', async () => {
    seed({ undelivered: ['budgets'], serverReachable: false });
    await render(cats());
    await press('category_delete_c1');
    expect(noticeBody()).toBe(DATA_OFFLINE_BODY);
  });
  it('الفئات: الدوسة', async () => {
    await render(cats());
    await press('category_delete_c1');
    mockData.figuresPending = ['transactions'];
    mockData.serverReachable = false;
    await screen.rerender(cats());
    await press('confirm_action_0');
    expect(mockData.deleteCategory).not.toHaveBeenCalled();
    expect(noticeBody()).toBe(DATA_OFFLINE_BODY);
  });
});

describe('2: سقف خانات المحفظة', () => {
  it('السقف تحت 2^53/100 عشان القرش يفضل مضبوط', () => {
    expect(WALLET_AMOUNT_MAX).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER / 100);
    expect(WALLET_AMOUNT_MAX).toBe(9e13);
    const near = WALLET_AMOUNT_MAX - 0.01;
    expect(roundMoney(near)).toBe(near);
    expect(planWalletOpeningCommit(String(WALLET_AMOUNT_MAX), 0)).toEqual({ action: 'reject' });
  });
  it('أسباب الرفض', () => {
    expect(walletAmountRejectReason('0.004')).toBe('too-small');
    expect(walletAmountRejectReason('-1e16')).toBe('negative');
    expect(walletAmountRejectReason('1e16')).toBe('too-large');
  });
  it('الكلام: «كبير أوي» و«صغير أوي»', () => {
    expect(walletAmountRejectNotice('حد التنبيه', 'كاش', 'too-large')[0]).toBe('الرقم ده كبير أوي');
    expect(walletAmountRejectNotice('حد التنبيه', 'كاش', 'too-small')[0]).toBe('الرقم ده صغير أوي');
    // too-small = بيتقرّب لصفر (أقل من نص قرش)، مش «أقل من قرش» (0.007 بيتحفظ 0.01)
    expect(walletAmountRejectNotice('حد التنبيه', 'كاش', 'too-small')[1]).toContain('أقل من نص قرش فبيتقرّب لصفر');
    expect(walletAmountRejectReason('0.007')).not.toBe('too-small');
    expect(roundMoney(0.007)).toBe(0.01);
  });
  it('حد التنبيه 0.004 ← «صغير أوي» على الشاشة', async () => {
    await render(wallets());
    await type('wallet_alert_input_w1', '0.004');
    expect(noticeTitle()).toBe('الرقم ده صغير أوي');
    expect(mockData.updateWallet).not.toHaveBeenCalled();
  });
});

describe('3: تأكيد الرصيد الابتدائي والمحفظة اتمسحت', () => {
  it('openingGoneNotice من غير اسم ← «المحفظة دي» مش «""»', () => {
    expect(openingGoneNotice('')[1]).not.toContain('""');
    expect(openingGoneNotice('')[1]).toContain('المحفظة دي');
  });
  it('المحفظة اتمسحت والتأكيد مفتوح ← رسالة «اتأرشفت أو اتمسحت» مش «اتغيّر من جهاز تاني»', async () => {
    seed({ wallets: [{ ...cash, openingBalance: 50 }, bank] });
    await render(wallets());
    await type('wallet_opening_input_w1', '100');
    mockData.wallets = [bank];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.updateWallet).not.toHaveBeenCalled();
    expect(noticeBody()).toBe(openingGoneNotice('')[1]);
  });
  it('money L1: بعد رسالة «اتأرشفت أو اتمسحت» والخروج من الشاشة ← مفيش رسالة «ما اتغيّرش» تانية', async () => {
    seed({ wallets: [{ ...cash, openingBalance: 50 }, bank] });
    await render(wallets());
    await type('wallet_opening_input_w1', '100');
    mockData.wallets = [bank];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(noticeBody()).toBe(openingGoneNotice('')[1]);
    // الشاشة بتتشال (البروفايدرز فاضلين) ← flush الخروج
    await screen.rerender(wrap(<></>));
    await press('notice_ok');
    expect(screen.queryByTestId('notice_title')).toBeNull();
  });
  it('silent L6: حد التنبيه اتكتب والمحفظة اتمسحت قبل الحفظ ← نفس رسالة «ما اتحفظش»، ومفيش كتابة', async () => {
    await render(wallets());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_alert_input_w1'), '300'); });
    mockData.wallets = [bank];
    await screen.rerender(wallets());
    await act(async () => { await new Promise(r => setTimeout(r, 1200)); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
    expect(noticeTitle()).toBe('ما اتحفظش');
    expect(noticeBody()).toBe(lowAlertGoneNotice('')[1]);
  });
});

describe('3: الرجوع الساكت لما الحاجة اتمسحت', () => {
  it('المحفظة اتمسحت والتأكيد البسيط مفتوح ← «اتمسحت من جهاز تاني»', async () => {
    await render(wallets());
    await press('wallet_delete_w1');
    mockData.wallets = [bank, { id: 'w3', name: 'توفير', openingBalance: 0, lowAlert: 0 }];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
    expect(noticeTitle()).toBe('المحفظة دي اتمسحت');
    expect(noticeBody()).toContain('من جهاز تاني');
  });
  it('الفئة اتمسحت والتأكيد مفتوح ← نفس الرسالة', async () => {
    await render(cats());
    await press('category_delete_c1');
    mockData.categories = [trips, { id: 'c3', name: 'بيت' }];
    await screen.rerender(cats());
    await press('confirm_action_0');
    expect(mockData.deleteCategory).not.toHaveBeenCalled();
    expect(noticeTitle()).toBe('الفئة دي اتمسحت');
  });
  it('حد التنبيه فاضي والمحفظة اتمسحت ← مفيش «اتشال»', async () => {
    seed({ wallets: [{ ...cash, lowAlert: 200 }, bank] });
    await render(wallets());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_alert_input_w1'), ''); });
    mockData.wallets = [bank];
    await act(async () => { fireEvent(screen.getByTestId('wallet_alert_input_w1'), 'blur'); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
    // silent L6: مش ساكت — رسالة «ما اتحفظش» (المحفظة مشيت)، مش «اتشال»
    expect(noticeTitle()).toBe('ما اتحفظش');
    expect(noticeBody()).toBe(lowAlertGoneNotice('')[1]);
  });
});

describe('3: الشيت بيتفتح من جديد ← سطر الأول', () => {
  it('اشتراك جديد اتربط والشيت مفتوح ← رسالة، وبعد «تمام» الشيت', async () => {
    seed({ subscriptions: [{ id: 's1', name: 'نتفليكس', walletId: 'w1', active: true }] });
    await render(wallets());
    await press('wallet_delete_w1');
    await pressText('أرشفها');
    await act(async () => { fireEvent.press(screen.getAllByText('البنك').at(-1)!); });
    mockData.subscriptions = [...mockData.subscriptions, { id: 's2', name: 'سبوتيفاي', walletId: 'w1', active: true }];
    await screen.rerender(wallets());
    await press('archive_sheet_confirm');
    expect(mockData.archiveWallet).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_dialog')).toBeTruthy();
    expect(screen.queryByTestId('archive_sheet_confirm')).toBeNull();
    await press('notice_ok');
    expect(screen.getByTestId('archive_sheet_confirm')).toBeTruthy();
  });
});

describe('3: الحالة الفاضية — المرفوض الأول، وبعدين «لسه بتوصل»، وبعدين النت', () => {
  it('لسه بتوصل ومفيش نت ← ولا حاجة لسه', async () => {
    seed({ wallets: [], figuresPending: ['wallets'], serverReachable: false });
    await render(wallets());
    expect(screen.queryByTestId('wallets_empty')).toBeNull();
  });
  it('مرفوضة ومفيش نت ← جملة المرفوض', async () => {
    seed({ wallets: [], loadErrors: ['wallets'], serverReachable: false, figuresPending: ['wallets'] });
    await render(wallets());
    expect(screen.getByTestId('wallets_empty')).toHaveTextContent(/ما وصلتش من السيرفر/);
  });
});

describe('نصوص arabic-copy-reviewer (الجولة دي)', () => {
  it('أسامي الأيقونات', () => {
    const { CATEGORY_ICON_LABELS } = require('@/lib/finance');
    expect(CATEGORY_ICON_LABELS['💡']).toBe('لمبة');
    expect(CATEGORY_ICON_LABELS['🐾']).toBe('حيوانات');
    expect(CATEGORY_ICON_LABELS['❓']).toBe('علامة استفهام');
  });
  it('SETTLE_GONE «راجع الشاشة وجرّب تاني»', () => {
    const { SETTLE_GONE_NOTICE } = require('@/components/ArchivedSettlement');
    expect(SETTLE_GONE_NOTICE[1]).toContain('راجع الشاشة وجرّب تاني');
  });
  it('«جرّب» بالشدّة في نصوص القفل', () => {
    const m = require('@/lib/lockMessages');
    for (const t of [m.LOCK_READ_FAILED, m.LOCK_RETRY, m.LOCK_STORAGE_ERROR, m.LOCK_SETTING_NOT_SAVED.body]) {
      expect(t).not.toMatch(/جرب /);
      expect(t).not.toMatch(/جرب$/);
    }
  });
});
