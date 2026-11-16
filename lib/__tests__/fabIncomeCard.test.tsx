import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, ScrollView } from 'react-native';
import { useFabScroll } from '@/context/FabScrollContext';
import TabLayout from '@/app/(tabs)/_layout';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * الزرار العايم "+" **ظاهر دايمًا** في الرئيسية والتقارير والتخطيط (2026-09-29).
 * كان بيستخبّى طول ما فيه كارت "نزل؟"/"اتخصم؟" أو مفيش ولا محفظة، والمستخدم
 * اللي فاتح يسجل بسرعة مكانش لاقيه. الكروت هي اللي بتتنقل، مش الزرار.
 */

let mockPath = '/';
// شاشة تجريبية جوه التابات بتبلّغ بالتمرير زي الشاشات الحقيقية
function MockScreen() {
  const f = useFabScroll();
  return <ScrollView testID="mock_scroll" {...f.scrollProps} />;
}
jest.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}<MockScreen /></>;
  Tabs.Screen = () => null;
  return { Tabs, usePathname: () => mockPath, router: { push: jest.fn() } };
});

const today = todayStr();
const pendingIncome = {
  id: 'i1', name: 'المرتب', amount: 4000, walletId: 'w1', frequency: 'monthly', mode: 'confirm',
  status: 'active', dayOfMonth: Number(today.slice(8, 10)), startDate: `${today.slice(0, 7)}-01`, closed: {},
};
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mount = () => render(<ThemeProvider><TabLayout /></ThemeProvider>);

describe('الزرار العايم "+" ظاهر دايمًا', () => {
  beforeEach(() => {
    Object.assign(mockData, {
      incomes: [], subscriptions: [], gamiyas: [], wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
      serverReachable: true, setupStatus: 'done', loadErrors: [],
    });
    mockPath = '/';
  });

  it('مفيش كارت ← الزرار ظاهر في الرئيسية', async () => {
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('فيه كارت "نزل؟" ← الزرار لسه ظاهر في الرئيسية', async () => {
    mockData.incomes = [pendingIncome];
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('فيه كارت "اتخصم؟" ← الزرار لسه ظاهر في الرئيسية', async () => {
    mockData.subscriptions = [{ id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'monthly', nextDueDate: today, active: true, history: [] }];
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('مفيش ولا محفظة (متأكدين) ← الزرار ظاهر في الرئيسية والتقارير والتخطيط', async () => {
    mockData.wallets = [];
    for (const p of ['/', '/reports', '/planning']) {
      mockPath = p;
      await mount();
      expect(screen.getByTestId('tx_add_button')).toBeTruthy();
    }
  });

  it('الديون والإعدادات ← مفيش زرار (ليهم زراير إضافة بتاعتهم)', async () => {
    for (const p of ['/debts', '/settings']) {
      mockPath = p;
      await mount();
      expect(screen.queryByTestId('tx_add_button')).toBeNull();
    }
  });
});

describe('الزرار العايم "+" بيختفي وانت بتمرّر لتحت ويرجع بعد عُشر ثانية من ما التمرير يقف (قرار 2026-11-16)', () => {
  const scrollTo = (y: number) => fireEvent.scroll(screen.getByTestId('mock_scroll'), { nativeEvent: { contentOffset: { y } } });
  // أول حدث بعد الفتح/تغيير التاب بيظبط المرساة بس — زي المستخدم اللي بيبدأ من الأول
  const prime = () => scrollTo(0);
  const hidden = () => screen.getByTestId('tx_add_fab_wrap', { includeHiddenElements: true }).props.pointerEvents === 'none';

  beforeEach(() => {
    Object.assign(mockData, {
      incomes: [], subscriptions: [], gamiyas: [], wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
      serverReachable: true, setupStatus: 'done', loadErrors: [],
    });
    mockPath = '/';
  });

  it('ظاهر عند الفتح، ومستخبي بعد تمرير لتحت، ويرجع فورًا بتمرير لفوق', async () => {
    await mount();
    await prime();
    expect(hidden()).toBe(false);
    await scrollTo(200);
    expect(hidden()).toBe(true);
        await scrollTo(150);
    expect(hidden()).toBe(false);
  });

  it('رفع الصباع + momentum لتحت مستمر ← مستخبي طول ما onScroll شغال، وبعد آخر حدث بـ100ms يرجع', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(200);
      await fireEvent(sv, 'scrollEndDrag');
      await fireEvent(sv, 'momentumScrollBegin');
      for (const y of [260, 330, 400, 480, 560]) {
        await scrollTo(y);
        await act(async () => { jest.advanceTimersByTime(60); });
        expect(hidden()).toBe(true);
      }
      await act(async () => { jest.advanceTimersByTime(39); });
      expect(hidden()).toBe(true);
      await act(async () => { jest.advanceTimersByTime(2); });
      expect(hidden()).toBe(false);
      // سحب جديد لتحت ← يخبّيه تاني
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(650);
      await scrollTo(700);
      expect(hidden()).toBe(true);
    } finally { jest.useRealTimers(); }
  });

  it('momentumScrollEnd مجاش ← برضه يرجع بعد آخر onScroll بـ100ms', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(200);
      await fireEvent(sv, 'scrollEndDrag');
      await fireEvent(sv, 'momentumScrollBegin');
      await scrollTo(300);
      await act(async () => { jest.advanceTimersByTime(50); });
      await scrollTo(380);
      await act(async () => { jest.advanceTimersByTime(99); });
      expect(hidden()).toBe(true);
      await act(async () => { jest.advanceTimersByTime(2); });
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it('momentumScrollEnd بيسلّح المهلة كمان', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(200);
      await fireEvent(sv, 'scrollEndDrag');
      await fireEvent(sv, 'momentumScrollBegin');
      await scrollTo(300);
      await fireEvent(sv, 'momentumScrollEnd');
      await act(async () => { jest.advanceTimersByTime(101); });
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it('رفع الصباع من غير تزحليق ← يرجع بعد 100ms من الرفع', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(200);
      await fireEvent(sv, 'scrollEndDrag');
      await act(async () => { jest.advanceTimersByTime(99); });
      expect(hidden()).toBe(true);
      await act(async () => { jest.advanceTimersByTime(2); });
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it('تزحليق لفوق بعد رفع الصباع ← ظاهر', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await scrollTo(500);
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(400);
      await fireEvent(sv, 'scrollEndDrag');
      await fireEvent(sv, 'momentumScrollBegin');
      await scrollTo(300);
      expect(hidden()).toBe(false);
      await scrollTo(200);
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it('beginDrag جديد في نص الـmomentum ← السحب لتحت يخبّيه', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(200);
      await fireEvent(sv, 'scrollEndDrag');
      await act(async () => { jest.advanceTimersByTime(150); });
      expect(hidden()).toBe(false);
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(300);
      expect(hidden()).toBe(true);
    } finally { jest.useRealTimers(); }
  });

  it('من غير drag خالص (تمرير برمجي) ← يرجع بعد المهلة من آخر حدث', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      await prime();
      await scrollTo(400);
      expect(hidden()).toBe(true);
      await act(async () => { jest.advanceTimersByTime(150); });
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it('أول الشاشة ← ظاهر', async () => {
    await mount();
    await prime();
    await scrollTo(200);
    await scrollTo(10);
    expect(hidden()).toBe(false);
  });

  it('تغيير المسار ← ظاهر', async () => {
    const view = await mount();
    await prime();
    await scrollTo(200);
    expect(hidden()).toBe(true);
    mockPath = '/reports';
    await view.rerender(<ThemeProvider><TabLayout /></ThemeProvider>);
    expect(hidden()).toBe(false);
  });

  it('قارئ الشاشة شغّال ← الزرار ثابت ومبيختفيش', async () => {
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove } as never);
    const view = await mount();
    await prime();
    await scrollTo(200);
    await scrollTo(400);
    expect(hidden()).toBe(false);
    await view.unmount();
    expect(remove).toHaveBeenCalled();
    // الدوال دي jest.fn من إعداد RN — restoreAllMocks مبترجّعش القيمة، فنرجّعها بإيدينا
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockResolvedValue(false);
    (AccessibilityInfo.addEventListener as jest.Mock).mockReturnValue({ remove: () => {} });
  });

  it('momentum begin مبيسيبوش مستخبي للأبد', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await scrollTo(200);
      await fireEvent(sv, 'momentumScrollBegin');
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  it('show() ثم أول onScroll عند y=500 (تاب محفوظ مكانه) ← مبيختفيش', async () => {
    const view = await mount();
    await prime();
    await scrollTo(200);
    expect(hidden()).toBe(true);
    mockPath = '/reports';
    await view.rerender(<ThemeProvider><TabLayout /></ThemeProvider>);
    await scrollTo(500);
    expect(hidden()).toBe(false);
    await scrollTo(520);
    expect(hidden()).toBe(true);
  });

  it('الإصبع ماسك من غير حركة ← مبيرجعش، ويرجع بعد endDrag', async () => {
    jest.useFakeTimers();
    try {
      await mount();
      const sv = screen.getByTestId('mock_scroll');
      await prime();
      await fireEvent(sv, 'scrollBeginDrag');
      await scrollTo(200);
      await scrollTo(260);
      expect(hidden()).toBe(true);
      await act(async () => { jest.advanceTimersByTime(2000); });
      expect(hidden()).toBe(true);
      await fireEvent(sv, 'scrollEndDrag');
      await act(async () => { jest.advanceTimersByTime(300); });
      expect(hidden()).toBe(false);
    } finally { jest.useRealTimers(); }
  });
});
