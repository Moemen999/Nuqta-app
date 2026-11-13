import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ReportsTab from '@/app/(tabs)/reports';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { selectedCategoriesPhrase } from '@/lib/archiving';
import { todayStr } from '@/lib/finance';
import { requestReports } from '@/lib/reportsRequest';

/**
 * فلتر فئات التقارير جوه «فلتر الفئات» (FoldedSection) مطوي افتراضيًا: السطر بيقول كام فئة مختارة،
 * و«مسح الفلتر» جنبه من غير ما تفتح، والأرقام والأعمدة مبتتغيّرش.
 */
let mockFocusKey = 0;
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb, mockFocusKey]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const today = todayStr();
const ui = () => <ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>;
const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const chipsOpen = () => screen.queryByTestId('reports_filter_chip_c1') !== null;
const toggleState = () => screen.getByTestId('reports_filter_toggle').props.accessibilityState;

beforeEach(() => {
  mockFocusKey = 0;
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مواصلات' }, { id: 'c3', name: 'صحة' }],
    transactions: [
      { id: 't1', type: 'expense', amount: 300, date: today, walletId: 'w', categoryId: 'c1' },
      { id: 't2', type: 'expense', amount: 100, date: today, walletId: 'w', categoryId: 'c2' },
      { id: 't3', type: 'expense', amount: 50, date: today, walletId: 'w', categoryId: 'c3' },
    ],
    debts: [], gamiyas: [], subscriptions: [], incomes: [], pendingTxIds: new Set(), serverReachable: true,
  });
});

describe('مطوي افتراضيًا', () => {
  it('السطر «فلتر الفئات» موجود والشرايح مخفية، والزرار expanded=false، والأعمدة بعده على طول', async () => {
    await render(ui());
    expect(screen.getByText('فلتر الفئات')).toBeTruthy();
    expect(chipsOpen()).toBe(false);
    expect(toggleState()).toEqual({ expanded: false });
    expect(screen.queryByTestId('reports_filter_clear')).toBeNull();
    expect(screen.getByTestId('reports_bars')).toBeTruthy();
  });
});

describe('الاختيار مبيستخباش', () => {
  it('اتنين مختارين والسطر مقفول: السطر بيقول «فئتين مختارتين» و«مسح الفلتر» ظاهر من غير فتح', async () => {
    await render(ui());
    await press('reports_filter_toggle');
    await press('reports_filter_chip_c1');
    await press('reports_filter_chip_c2');
    await press('reports_filter_toggle'); // قفل
    expect(chipsOpen()).toBe(false);
    expect(screen.getByText('فلتر الفئات — فئتين مختارتين')).toBeTruthy();
    expect(screen.getByTestId('reports_filter_toggle').props.accessibilityLabel).toBe('فلتر الفئات — فئتين مختارتين');
    expect(screen.getByTestId('reports_filter_clear')).toBeTruthy();
    expect(screen.getByText('مصروفات الفترة (الفئات المختارة)')).toBeTruthy();
  });

  it('«مسح الفلتر» من الحالة المقفولة بيمسح الاختيار من غير ما يفتح القسم', async () => {
    await render(ui());
    await press('reports_filter_toggle');
    await press('reports_filter_chip_c1');
    await press('reports_filter_toggle');
    expect(screen.getByText('فلتر الفئات — فئة واحدة مختارة')).toBeTruthy();
    await press('reports_filter_clear');
    expect(screen.getByText('فلتر الفئات')).toBeTruthy();
    expect(screen.queryByTestId('reports_filter_clear')).toBeNull();
    expect(chipsOpen()).toBe(false);
    expect(screen.queryByText('مصروفات الفترة (الفئات المختارة)')).toBeNull();
    expect(screen.getByTestId('reports_bar_c2')).toBeTruthy();
  });

  it('فتح وقفل القسم مبيغيّرش الاختيار', async () => {
    await render(ui());
    await press('reports_filter_toggle');
    await press('reports_filter_chip_c2');
    await press('reports_filter_toggle');
    await press('reports_filter_toggle');
    expect(toggleState()).toEqual({ expanded: true });
    expect(screen.getByText('فلتر الفئات — فئة واحدة مختارة')).toBeTruthy();
    expect(screen.queryByTestId('reports_bar_c1')).toBeNull();
    expect(screen.getByTestId('reports_bar_c2')).toBeTruthy();
  });

  it('صيغ العدد بالعامية: 1 / 2 / 3', () => {
    expect(selectedCategoriesPhrase(1)).toBe('فئة واحدة مختارة');
    expect(selectedCategoriesPhrase(2)).toBe('فئتين مختارتين');
    expect(selectedCategoriesPhrase(3)).toBe('3 فئات مختارة');
  });
});

describe('طلب الرئيسية', () => {
  it('الطلب المعلّق (clearFilter) بيمسح الاختيار والسطر بيرجع من غير اختيار، والقسم بيفضل زي ما هو', async () => {
    const r = await render(ui());
    await press('reports_filter_toggle');
    await press('reports_filter_chip_c1');
    await press('reports_filter_chip_c3');
    expect(screen.getByText('فلتر الفئات — فئتين مختارتين')).toBeTruthy();
    requestReports({ preset: 'thisMonth', clearFilter: true });
    mockFocusKey++;
    await r.rerender(ui());
    expect(screen.getByText('فلتر الفئات')).toBeTruthy();
    expect(screen.queryByTestId('reports_filter_clear')).toBeNull();
    expect(toggleState()).toEqual({ expanded: true }); // مبنغيّرش حالة الفتح لوحدنا
  });
});
