import CategoriesScreen from '@/app/settings-screens/categories';
import NotificationsScreen, { STATUS_OFF, STATUS_ON } from '@/app/settings-screens/notifications';
import WalletsScreen from '@/app/settings-screens/wallets';
import { EMPTY_OFFLINE_NOTE } from '@/components/ListEmptyState';
import { ThemeProvider } from '@/context/ThemeContext';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * جرد الأدوات لكل شاشة اتنقلت في إعادة تنظيم الإعدادات.
 *
 * القاعدة اللي اتفقنا عليها: **أي نقل شاشة لازم يعدّي على فرق سطر بسطر
 * واختبار جرد.** السبب إن قسم القفل ضاع منه أربع أدوات في النقل ومحدش
 * حس، لأن مفيش اختبار كان بيقول "الأدوات دي لازم تفضل موجودة".
 *
 * الاختبارات دي مش بتتأكد إن الشاشة شكلها حلو — بتتأكد إن **كل أداة
 * موجودة وليها `testID` ثابت**. لو حد نقل قسم تاني ونسي أداة، الاختبار
 * بيحمر باسم الأداة بالظبط.
 */

const wallets = [
  { id: 'w1', name: 'كاش', openingBalance: 500, lowAlert: 100 },
  { id: 'w2', name: 'البنك', openingBalance: 9000, lowAlert: 0 },
];
const categories = [
  { id: 'c1', name: 'أكل' },
  { id: 'c2', name: 'مواصلات' },
];

const mockData: any = {
  wallets, categories, transactions: [], budgets: {}, debts: [],
  subscriptions: [], gamiyas: [], serverReachable: true,
  updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(),
  archiveWallet: jest.fn(), restoreWallet: jest.fn(),
  updateCategory: jest.fn(), addCategory: jest.fn(), deleteCategory: jest.fn(),
  archiveCategory: jest.fn(), restoreCategory: jest.fn(),
  setBudget: jest.fn(), setMonthlyIncome: jest.fn(), setShakhbataPercents: jest.fn(),
};

const mockNotifs: any = {
  enabled: true, dailyEnabled: true, dailyHour: 20,
  enableNotifications: jest.fn(async () => true),
  disableNotifications: jest.fn(async () => {}),
  setDailyEnabled: jest.fn(), setDailyHour: jest.fn(),
};

jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => mockNotifs }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const wrap = (el: React.ReactElement) => render(<ThemeProvider>{el}</ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockData.wallets = wallets;
  mockData.categories = categories;
  mockData.serverReachable = true;
  mockNotifs.enabled = true;
  mockNotifs.dailyEnabled = true;
});

describe('شاشة المحافظ — الجرد', () => {
  const PER_WALLET = ['wallet_row', 'wallet_name_input', 'wallet_delete', 'wallet_opening_input', 'wallet_alert_input'];

  it('كل محفظة فيها كل أدواتها', async () => {
    await wrap(<WalletsScreen />);
    wallets.forEach(w => {
      PER_WALLET.forEach(prefix => {
        expect(screen.getByTestId(`${prefix}_${w.id}`)).toBeTruthy();
      });
    });
  });

  it('وخانة الإضافة وزرارها', async () => {
    await wrap(<WalletsScreen />);
    expect(screen.getByTestId('wallet_add_input')).toBeTruthy();
    expect(screen.getByTestId('wallet_add_button')).toBeTruthy();
  });

  it('والنصوص اللي المستخدم بيعتمد عليها', async () => {
    await wrap(<WalletsScreen />);
    expect(screen.getByText('المحافظ')).toBeTruthy();
    expect(screen.getByText('تقدر تدوس على اسم المحفظة تعدله مباشرة')).toBeTruthy();
    expect(screen.getAllByText('الرصيد الابتدائي')).toHaveLength(wallets.length);
    expect(screen.getAllByText('حد التنبيه')).toHaveLength(wallets.length);
  });
});

describe('شاشة الفئات — الجرد', () => {
  it('كل فئة فيها اسمها وزرار حذفها', async () => {
    await wrap(<CategoriesScreen />);
    categories.forEach(c => {
      expect(screen.getByTestId(`category_row_${c.id}`)).toBeTruthy();
      expect(screen.getByTestId(`category_name_input_${c.id}`)).toBeTruthy();
      expect(screen.getByTestId(`category_delete_${c.id}`)).toBeTruthy();
    });
  });

  it('وخانة الإضافة وزرارها', async () => {
    await wrap(<CategoriesScreen />);
    expect(screen.getByTestId('category_add_input')).toBeTruthy();
    expect(screen.getByTestId('category_add_button')).toBeTruthy();
  });
});

describe('شاشة الإشعارات — الجرد', () => {
  it('المفتاح الأساسي وسطر الحالة', async () => {
    await wrap(<NotificationsScreen />);
    expect(screen.getByTestId('notifications_switch')).toBeTruthy();
    expect(screen.getByTestId('notifications_status')).toBeTruthy();
  });

  it('سطر الحالة بيقول "مفعّلة" لما تكون مفعّلة — ده اللي ضاع في النقل', async () => {
    await wrap(<NotificationsScreen />);
    expect(screen.getByText(STATUS_ON)).toBeTruthy();
  });

  it('و"مقفولة" لما تكون مقفولة', async () => {
    mockNotifs.enabled = false;
    await wrap(<NotificationsScreen />);
    expect(screen.getByText(STATUS_OFF)).toBeTruthy();
  });

  it('مفتاح التذكير اليومي وكل ساعات الاختيار الأربعة', async () => {
    await wrap(<NotificationsScreen />);
    expect(screen.getByTestId('notifications_daily_switch')).toBeTruthy();
    [14, 18, 20, 22].forEach(h => {
      expect(screen.getByTestId(`notifications_hour_${h}`)).toBeTruthy();
    });
  });

  it('التذكير اليومي المقفول بيقول كده بالنص مش بوضع المفتاح بس', async () => {
    mockNotifs.dailyEnabled = false;
    await wrap(<NotificationsScreen />);
    expect(screen.getByText('من غير تذكير يومي — فعّله لو عايز واحد')).toBeTruthy();
  });

  it('لما الإشعارات مقفولة، التذكير اليومي مبيظهرش خالص', async () => {
    mockNotifs.enabled = false;
    await wrap(<NotificationsScreen />);
    expect(screen.queryByTestId('notifications_daily_switch')).toBeNull();
  });
});

describe('الحالة الفاضية بتفرّق بين "مفيش" و"لسه ما وصلتش"', () => {
  it('محافظ فاضية والنت شغال: بتقول اعمل واحدة', async () => {
    mockData.wallets = [];
    await wrap(<WalletsScreen />);
    expect(screen.getByTestId('wallets_empty')).toBeTruthy();
    expect(screen.queryByText(new RegExp(EMPTY_OFFLINE_NOTE))).toBeNull();
  });

  it('محافظ فاضية ومفيش نت: بتقول إنها ممكن تكون لسه ما وصلتش', async () => {
    mockData.wallets = [];
    mockData.serverReachable = false;
    await wrap(<WalletsScreen />);
    expect(screen.getByTestId('wallets_empty')).toBeTruthy();
    expect(screen.getByText(new RegExp(EMPTY_OFFLINE_NOTE))).toBeTruthy();
  });

  it('وفيه محافظ: مفيش حالة فاضية خالص', async () => {
    await wrap(<WalletsScreen />);
    expect(screen.queryByTestId('wallets_empty')).toBeNull();
  });

  it('ونفس الكلام للفئات', async () => {
    mockData.categories = [];
    mockData.serverReachable = false;
    await wrap(<CategoriesScreen />);
    expect(screen.getByTestId('categories_empty')).toBeTruthy();
    expect(screen.getByText(new RegExp(EMPTY_OFFLINE_NOTE))).toBeTruthy();
  });
});
