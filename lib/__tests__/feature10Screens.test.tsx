import WalletsScreen from '@/app/settings-screens/wallets';
import CategoriesScreen from '@/app/settings-screens/categories';
import ArchiveSheet from '@/components/ArchiveSheet';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { DATA_LOADING_BODY } from '@/lib/listenerErrors';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { warmUp } from '@/test-utils/warmUp';

/**
 * الميزة 10 (المحافظ والفئات والأرشفة) — الجولة الأخيرة، على الشاشات نفسها:
 * H1 البيانات لسه بتوصل، والفحص التاني لحظة الدوسة، والنقل لمكان اتأرشف، وحد التنبيه، والرصيد السالب، والكلام.
 */

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));
// eslint-disable-next-line import/first
import { reportAtomicFailure } from '@/lib/atomicFailure';

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

const title = () => screen.getByTestId('confirm_title').props.children;
const noticeBody = () => screen.getByTestId('notice_body').props.children;
const pressText = async (t: string) => { await act(async () => { fireEvent.press(screen.getByText(t)); }); };
const press = async (id: string) => { await act(async () => { fireEvent.press(screen.getByTestId(id)); }); };

describe('H1: البيانات لسه بتوصل ← مفيش مسح ولا أرشفة', () => {
  it('العمليات لسه ما وصلتش ← المسح بيقف قبل التأكيد', async () => {
    seed({ figuresPending: ['transactions'] });
    await render(wallets());
    await press('wallet_delete_w1');
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(noticeBody()).toBe(DATA_LOADING_BODY);
  });

  it('الديون لسه ما وصلتش (undelivered) ← نفس الحاجة', async () => {
    seed({ undelivered: ['debts'] });
    await render(wallets());
    await press('wallet_delete_w1');
    expect(noticeBody()).toBe(DATA_LOADING_BODY);
  });

  it('التأكيد اتفتح وبعدين البيانات بقت "لسه بتوصل" (حساب اتبدّل/جرّب تاني) ← الدوسة مبتمسحش', async () => {
    await render(wallets());
    await press('wallet_delete_w1');
    expect(title()).toBe('تمسح المحفظة؟');
    mockData.figuresPending = ['transactions'];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
    expect(noticeBody()).toBe(DATA_LOADING_BODY);
  });

  it('الفئات: الميزانية لسه ما وصلتش ← المسح بيقف', async () => {
    seed({ undelivered: ['budgets'] });
    await render(cats());
    await press('category_delete_c1');
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(noticeBody()).toBe(DATA_LOADING_BODY);
  });

  it('الفئات: التأكيد مفتوح والعمليات بقت لسه بتوصل ← مفيش مسح', async () => {
    await render(cats());
    await press('category_delete_c1');
    mockData.figuresPending = ['transactions'];
    await screen.rerender(cats());
    await press('confirm_action_0');
    expect(mockData.deleteCategory).not.toHaveBeenCalled();
  });
});

describe('تأكيد الأرشفة البسيط بيفحص تاني لحظة الدوسة', () => {
  const withHistory = { transactions: [{ id: 't1', type: 'expense', amount: 0, walletId: 'w1', date: '2026-01-01' }] };

  async function openSimpleArchive() {
    await render(wallets());
    await press('wallet_delete_w1');
    await pressText('أرشفها');
    expect(title()).toBe('أرشفة محفظة');
  }

  it('عملية نزلت على المحفظة والتأكيد مفتوح ← مفيش أرشفة، ورسالة الرصيد', async () => {
    seed(withHistory);
    await openSimpleArchive();
    mockData.transactions = [...withHistory.transactions, { id: 't2', type: 'income', amount: 120, walletId: 'w1', date: '2026-01-02' }];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.archiveWallet).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_title').props.children).toBe('رصيدها لسه مش صفر');
  });

  it('اشتراك شغال اتربط بيها والتأكيد مفتوح ← الشيت بيفتح بدل الأرشفة', async () => {
    seed(withHistory);
    await openSimpleArchive();
    mockData.subscriptions = [{ id: 's1', name: 'نتفليكس', walletId: 'w1', active: true }];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.archiveWallet).not.toHaveBeenCalled();
    expect(screen.getByTestId('archive_sheet_confirm')).toBeTruthy();
  });

  it('الفئة: اشتراك اتربط بيها والتأكيد مفتوح ← الشيت', async () => {
    seed({ transactions: [{ id: 't1', type: 'expense', amount: 5, walletId: 'w1', categoryId: 'c1', date: '2026-01-01' }] });
    await render(cats());
    await press('category_delete_c1');
    await pressText('أرشفها');
    mockData.subscriptions = [{ id: 's1', name: 'نتفليكس', walletId: 'w1', categoryId: 'c1', active: true }];
    await screen.rerender(cats());
    await press('confirm_action_0');
    expect(mockData.archiveCategory).not.toHaveBeenCalled();
    expect(screen.getByTestId('archive_sheet_confirm')).toBeTruthy();
  });

  it('الفئة: بقت آخر فئة شغالة والتأكيد مفتوح ← مفيش أرشفة', async () => {
    seed({ transactions: [{ id: 't1', type: 'expense', amount: 5, walletId: 'w1', categoryId: 'c1', date: '2026-01-01' }] });
    await render(cats());
    await press('category_delete_c1');
    await pressText('أرشفها');
    mockData.categories = [food, { ...trips, archived: true }];
    await screen.rerender(cats());
    await press('confirm_action_0');
    expect(mockData.archiveCategory).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_title').props.children).toBe('دي آخر فئة شغالة');
  });
});

describe('النقل لمكان اتأرشف والشيت مفتوح (بند 3)', () => {
  it('المحفظة: البنك اتأرشف بعد ما اتختار ← مفيش أرشفة', async () => {
    seed({
      wallets: [cash, bank, { id: 'w3', name: 'توفير', openingBalance: 0, lowAlert: 0 }],
      subscriptions: [{ id: 's1', name: 'نتفليكس', walletId: 'w1', active: true }],
    });
    await render(wallets());
    await press('wallet_delete_w1');
    await pressText('أرشفها');
    await act(async () => { fireEvent.press(screen.getAllByText('البنك').at(-1)!); });
    mockData.wallets = [cash, { ...bank, archived: true }, { id: 'w3', name: 'توفير', openingBalance: 0, lowAlert: 0 }];
    await screen.rerender(wallets());
    await press('archive_sheet_confirm');
    expect(mockData.archiveWallet).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_title').props.children).toBe('فيه حاجة اتغيّرت');
  });

  it('الفئة: الفئة الجديدة اتأرشفت بعد ما اتختارت ← مفيش أرشفة', async () => {
    seed({
      categories: [food, trips, { id: 'c3', name: 'بيت' }],
      subscriptions: [{ id: 's1', name: 'نتفليكس', walletId: 'w1', categoryId: 'c1', active: true }],
    });
    await render(cats());
    await press('category_delete_c1');
    await pressText('أرشفها');
    await act(async () => { fireEvent.press(screen.getAllByText('مواصلات').at(-1)!); });
    mockData.categories = [food, { ...trips, archived: true }, { id: 'c3', name: 'بيت' }];
    await screen.rerender(cats());
    await press('archive_sheet_confirm');
    expect(mockData.archiveCategory).not.toHaveBeenCalled();
  });
});

describe('المسح: الرصيد اللي هيختفي، والأسامي', () => {
  it('محفظة من غير تاريخ بس رصيدها 500 ← التأكيد بيقول الإجمالي هيقل', async () => {
    seed({ wallets: [{ ...cash, openingBalance: 500 }, bank] });
    await render(wallets());
    await press('wallet_delete_w1');
    expect(title()).toBe('تمسح المحفظة؟');
    expect(screen.getByTestId('confirm_body').props.children).toContain('إجمالي فلوسك هيقل 500 ج.م');
    expect(screen.getByTestId('confirm_cancel')).toHaveTextContent('سيبها');
    expect(screen.getByTestId('confirm_action_0')).toHaveTextContent('امسحها');
  });

  it('زرار الصف «امسح» وبيقول نفس الكلمة لقارئ الشاشة', async () => {
    await render(wallets());
    expect(screen.getByTestId('wallet_delete_w1')).toHaveTextContent('امسح');
    expect(screen.getByTestId('wallet_delete_w1').props.accessibilityLabel).toBe('امسح محفظة كاش');
  });

  it('أرشفة محفظة رصيدها سالب ← الكلام بالسالب ومن غير علامة', async () => {
    seed({
      wallets: [{ ...cash, openingBalance: -300 }, bank],
      transactions: [{ id: 't1', type: 'expense', amount: 0, walletId: 'w1', date: '2026-01-01' }],
    });
    await render(wallets());
    await press('wallet_delete_w1');
    await pressText('أرشفها');
    expect(noticeBody()).toContain('رصيدها سالب 300');
    expect(noticeBody()).not.toMatch(/-300/);
  });

  it('الفئة: «تمسح الفئة؟» و«امسحها» و«سيبها»', async () => {
    await render(cats());
    await press('category_delete_c1');
    expect(title()).toBe('تمسح الفئة؟');
    expect(screen.getByTestId('confirm_cancel')).toHaveTextContent('سيبها');
    expect(screen.getByTestId('confirm_action_0')).toHaveTextContent('امسحها');
  });

  it('الفئة: آخر فئة شغالة مبتتمسحش', async () => {
    seed({ categories: [food] });
    await render(cats());
    await press('category_delete_c1');
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(screen.getByTestId('notice_title').props.children).toBe('دي آخر فئة شغالة');
  });

  it('الفئة: المسح رمى ← reportAtomicFailure ورسالة باسمها', async () => {
    mockData.deleteCategory = jest.fn(async () => { throw new Error('boom'); });
    await render(cats());
    await press('category_delete_c1');
    await press('confirm_action_0');
    expect(reportAtomicFailure).toHaveBeenCalledWith('مسح الفئة', expect.anything());
    expect(noticeBody()).toContain('أكل');
  });

  it('الفئة: DataContext رفض (آخر شغالة) ← الرسالة', async () => {
    mockData.deleteCategory = jest.fn(async () => ({ outcome: 'blocked', block: { kind: 'last-active' } }));
    await render(cats());
    await press('category_delete_c1');
    await press('confirm_action_0');
    expect(screen.getByTestId('notice_title').props.children).toBe('دي آخر فئة شغالة');
  });
});

describe('الخانات', () => {
  it('حد التنبيه بالسالب ← مرفوض برسالة باسم الخانة، ومفيش «رصيد بالسالب؟»', async () => {
    await render(wallets());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_alert_input_w1'), '-5'); });
    await act(async () => { fireEvent(screen.getByTestId('wallet_alert_input_w1'), 'blur'); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(noticeBody()).toContain('حد التنبيه');
    expect(noticeBody()).toContain('من صفر وطالع');
    expect(mockData.updateWallet).not.toHaveBeenCalled();
  });

  it('حد التنبيه فاضي مبيتحفظش لوحده، والخروج بيقول إنه اتشال', async () => {
    jest.useFakeTimers();
    try {
      seed({ wallets: [{ ...cash, lowAlert: 200 }, bank] });
      await render(wallets());
      await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_alert_input_w1'), ''); });
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(mockData.updateWallet).not.toHaveBeenCalled();
      await act(async () => { fireEvent(screen.getByTestId('wallet_alert_input_w1'), 'blur'); });
      expect(mockData.updateWallet).toHaveBeenCalledWith('w1', { lowAlert: 0 });
      expect(screen.getByTestId('notice_title').props.children).toContain('حد التنبيه');
    } finally { jest.useRealTimers(); }
  });

  it('رصيد ابتدائي كبير قوي ← رسالة «كبير قوي» ومفيش تأكيد', async () => {
    await render(wallets());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_opening_input_w1'), '1e300'); });
    await act(async () => { fireEvent(screen.getByTestId('wallet_opening_input_w1'), 'blur'); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(screen.getByTestId('notice_title').props.children).toBe('الرقم ده كبير قوي');
  });

  it('تأكيد الرصيد الابتدائي والمحفظة اتأرشفت وهو مفتوح ← مفيش كتابة', async () => {
    await render(wallets());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_opening_input_w1'), '100'); });
    await act(async () => { fireEvent(screen.getByTestId('wallet_opening_input_w1'), 'blur'); });
    expect(title()).toBe('تغيّر الرصيد الابتدائي؟');
    mockData.wallets = [{ ...cash, archived: true }, bank];
    await screen.rerender(wallets());
    await press('confirm_action_0');
    expect(mockData.updateWallet).not.toHaveBeenCalled();
  });

  it('مسحت الاسم وسبت الخانة ← رجع الاسم ورسالة قصيرة', async () => {
    await render(wallets());
    await act(async () => { fireEvent.changeText(screen.getByTestId('wallet_name_input_w1'), '  '); });
    await act(async () => { fireEvent(screen.getByTestId('wallet_name_input_w1'), 'blur'); });
    expect(mockData.updateWallet).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_dialog')).toBeTruthy();
  });

  it('الخانات ليها أسامي بالمحفظة لقارئ الشاشة', async () => {
    seed({ wallets: [{ ...cash, openingBalance: 500, lowAlert: 50 }, bank] });
    await render(wallets());
    expect(screen.getByTestId('wallet_opening_input_w1').props.accessibilityLabel).toBe('الرصيد الابتدائي، كاش');
    expect(screen.getByTestId('wallet_alert_input_w1').props.accessibilityLabel).toBe('حد التنبيه، كاش');
    expect(screen.getByTestId('wallet_name_input_w1').props.accessibilityLabel).toBe('اسم المحفظة كاش');
  });

  it('الفئة: الخانة ليها اسم', async () => {
    await render(cats());
    expect(screen.getByTestId('category_name_input_c1').props.accessibilityLabel).toBe('اسم الفئة أكل');
  });
});

describe('الحالة الفاضية', () => {
  it('من غير نت: الجملة بتتبدّل (مش بتتلزق)', async () => {
    seed({ wallets: [], serverReachable: false });
    await render(wallets());
    expect(screen.getByTestId('wallets_empty')).toHaveTextContent(
      'مفيش نت دلوقتي، فمحافظك ممكن تكون لسه ما وصلتش — مش ضايعة. استنى لحد ما النت يرجع قبل ما تعمل واحدة جديدة.');
  });
  it('المحافظ لسه ما وصلتش والنت شغال ← مفيش «فاضي»', async () => {
    seed({ wallets: [], figuresPending: ['wallets'] });
    await render(wallets());
    expect(screen.queryByTestId('wallets_empty')).toBeNull();
  });
  it('المحافظ اترفضت ← مبتقولش «اعمل واحدة»', async () => {
    seed({ wallets: [], loadErrors: ['wallets'] });
    await render(wallets());
    expect(screen.getByTestId('wallets_empty')).not.toHaveTextContent(/اعمل واحدة/);
  });
  it('الفئات من غير نت', async () => {
    seed({ categories: [], serverReachable: false });
    await render(cats());
    expect(screen.getByTestId('categories_empty')).toHaveTextContent(/فئاتك ممكن تكون لسه ما وصلتش/);
  });
});

describe('شيت الأرشفة', () => {
  it('دوستين على التأكيد ← مرة واحدة', async () => {
    const onConfirm = jest.fn();
    await render(wrap(<ArchiveSheet title="أرشفة محفظة" intro="x" items={[]} targets={[]} targetLabel="المحفظة الجديدة"
      confirmText="أرشفها" onConfirm={onConfirm} onClose={() => {}} />));
    await act(async () => {
      fireEvent.press(screen.getByTestId('archive_sheet_confirm'));
      fireEvent.press(screen.getByTestId('archive_sheet_confirm'));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('الشريحة بتقول هي لأنهي حاجة، والتأكيد المقفول بيقول ليه', async () => {
    await render(wrap(<ArchiveSheet title="أرشفة محفظة" intro="x" items={[{ id: 's1', name: 'نتفليكس', kind: 'اشتراك' }]}
      targets={[{ id: 'w2', name: 'البنك' }]} targetLabel="المحفظة الجديدة" confirmText="أرشفها" onConfirm={() => {}} onClose={() => {}} />));
    expect(screen.getByLabelText('البنك، لاشتراك نتفليكس')).toBeTruthy();
    expect(screen.getByTestId('archive_sheet_confirm').props.accessibilityHint).toBe('اختار المحفظة الجديدة لكل حاجة');
  });
});

describe('شيت التسوية', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useArchivedSettlement, SETTLE_GONE_NOTICE, SETTLE_TITLE_MANY } = require('@/components/ArchivedSettlement');
  const old = { id: 'w9', name: 'قديمة', openingBalance: 0, lowAlert: 0, archived: true };
  const old2 = { id: 'w8', name: 'قديمة 2', openingBalance: 0, lowAlert: 0, archived: true };
  let run: jest.Mock;
  function Host({ changes }: { changes: unknown[] }) {
    const settle = useArchivedSettlement();
    React.useEffect(() => { settle.request(changes, run); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return settle.sheet;
  }
  beforeEach(() => { run = jest.fn(); });

  it('المؤرشفة رجعت والشيت مفتوحة ← بتتقفل وبتقول «ما اتعملش حاجة»', async () => {
    seed({ wallets: [cash, old] });
    const changes = [{ before: { type: 'expense', amount: 100, walletId: 'w9' } }];
    await render(wrap(<Host changes={changes} />));
    expect(screen.getByTestId('settle_sheet')).toBeTruthy();
    mockData.wallets = [cash, { ...old, archived: undefined }];
    await screen.rerender(wrap(<Host changes={changes} />));
    expect(screen.queryByTestId('settle_sheet')).toBeNull();
    expect(screen.getByTestId('notice_title').props.children).toBe(SETTLE_GONE_NOTICE[0]);
    expect(run).not.toHaveBeenCalled();
  });

  it('محفظتين مؤرشفتين ← العنوان بالجمع، ونسخة المسح', async () => {
    seed({ wallets: [cash, old, old2] });
    const changes = [
      { before: { type: 'expense', amount: 100, walletId: 'w9' } },
      { before: { type: 'expense', amount: 50, walletId: 'w8' } },
    ];
    await render(wrap(<Host changes={changes} />));
    expect(screen.getByText(SETTLE_TITLE_MANY)).toBeTruthy();
    expect(screen.getAllByText(/مسح العملية دي/).length).toBe(2);
  });
});

describe('اختيار أيقونة الفئة لقارئ الشاشة', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CategoryIconPicker = require('@/components/CategoryIconPicker').default;
  it('الأيقونات بأسامي عربي وradio، والمخصصة «أيقونة مخصصة»، والعنوان header', async () => {
    await render(wrap(<CategoryIconPicker visible current="🦄" others={[]} onPick={() => {}} onClose={() => {}} />));
    const car = screen.getByTestId('icon_pick_🚗');
    expect(car.props.accessibilityLabel).toBe('أيقونة عربية');
    expect(car.props.accessibilityRole).toBe('radio');
    expect(car.props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('icon_pick_keyboard').props.accessibilityLabel).toContain('أيقونة مخصصة');
    expect(screen.getByTestId('icon_pick_keyboard').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByRole('header')).toHaveTextContent('اختار أيقونة');
  });
});
