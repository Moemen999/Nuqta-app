import WalletsScreen from '@/app/settings-screens/wallets';
import { ThemeProvider } from '@/context/ThemeContext';
import { walletDeleteBlock } from '@/lib/archiving';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { warmUp } from '@/test-utils/warmUp';
import { Alert } from 'react-native';

/**
 * آخر محفظة شغالة مبتتمسحش أبدًا — زي الأرشفة بالظبط (`last-active`).
 *
 * قبل كده المسح النهائي مكانش بيعدّ المحافظ الشغالة: المستخدم يمسح آخر واحدة
 * ويفضل من غير ولا محفظة، وأي تعديل على عملية في مؤرشفة يبقى مالوش مكان
 * يتسوّى فيه. الفحص بيتعمل تاني لحظة الدوسة على التأكيد.
 */

const cash = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const bank = { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 0 };
const savings = { id: 'w3', name: 'توفير', openingBalance: 0, lowAlert: 0, archived: true };

const mockData: any = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

function seed(wallets: object[], transactions: object[] = []) {
  Object.assign(mockData, {
    wallets, categories: [], transactions, budgets: {}, debts: [],
    subscriptions: [], gamiyas: [], incomes: [], serverReachable: true, loadErrors: [],
    updateWallet: jest.fn(), addWallet: jest.fn(), deleteWallet: jest.fn(),
    archiveWallet: jest.fn(), restoreWallet: jest.fn(),
  });
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  seed([cash, bank]);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const ui = () => <ThemeProvider><WalletsScreen /></ThemeProvider>;
warmUp(() => { seed([cash, bank]); return ui(); });

const lastButtons = () => alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
const press = async (text: string) => { await act(async () => { lastButtons().find(b => b.text === text)!.onPress!(); }); };
const pressDelete = async (id: string) => { await act(async () => { fireEvent.press(screen.getByTestId(`wallet_delete_${id}`)); }); };
// المسح والأرشفة نفس العنوان وجملتين مختلفتين: "رجّع واحدة من المؤرشفة" مالهاش
// معنى وانت بتأرشف. الاتنين متثبّتين هنا بالحرف عشان ميرجعوش يتلخبطوا في بعض
const LAST_ACTIVE_TITLE = 'دي آخر محفظة شغالة';
const DELETE_BODY = 'لازم يفضل عندك محفظة واحدة شغالة على الأقل عشان تقدر تسجّل عملياتك. اعمل محفظة تانية أو رجّع واحدة من المؤرشفة، وبعدين امسح دي.';
const ARCHIVE_BODY = 'لازم يفضل عندك محفظة واحدة على الأقل عشان تقدر تسجّل عملياتك. اعمل محفظة تانية الأول.';
const expectLastActiveRefusal = () => expect(alertSpy).toHaveBeenLastCalledWith(LAST_ACTIVE_TITLE, DELETE_BODY, [{ text: 'تمام' }]);
const expectArchiveRefusal = () => expect(alertSpy).toHaveBeenLastCalledWith(LAST_ACTIVE_TITLE, ARCHIVE_BODY, [{ text: 'تمام' }]);

describe('walletDeleteBlock', () => {
  it('آخر شغالة ← ممنوع، سواء فيه مؤرشفة ولا لأ', () => {
    expect(walletDeleteBlock('w1', [cash])).toEqual({ kind: 'last-active' });
    expect(walletDeleteBlock('w1', [cash, savings])).toEqual({ kind: 'last-active' });
  });
  it('فيه شغالة تانية ← ماشي', () => {
    expect(walletDeleteBlock('w1', [cash, bank])).toBeNull();
  });
  it('المؤرشفة نفسها، أو محفظة مش موجودة ← مش شغلته', () => {
    expect(walletDeleteBlock('w3', [cash, savings])).toBeNull();
    expect(walletDeleteBlock('nope', [cash])).toBeNull();
  });
});

describe('شاشة المحافظ', () => {
  it('محفظة واحدة بس ← المسح ممنوع برسالة آخر محفظة، ومفيش مسح', async () => {
    seed([cash]);
    await render(ui());
    await pressDelete('w1');
    expectLastActiveRefusal();
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
  });

  it('شغالة واحدة ومعاها مؤرشفة ← برضه ممنوع', async () => {
    seed([cash, savings]);
    await render(ui());
    await pressDelete('w1');
    expectLastActiveRefusal();
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
  });

  it('آخر شغالة وليها تاريخ ← ممنوع قبل ما يتعرض "امسحها برضه"', async () => {
    seed([cash], [{ id: 't1', type: 'income', amount: 100, walletId: 'w1', date: '2026-09-01' }]);
    await render(ui());
    await pressDelete('w1');
    expectLastActiveRefusal();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('فيه شغالة تانية ← المسح بيمشي زي الأول', async () => {
    await render(ui());
    await pressDelete('w1');
    expect(alertSpy).toHaveBeenLastCalledWith('حذف محفظة', expect.stringContaining('كاش'), expect.anything());
    await press('حذف');
    expect(mockData.deleteWallet).toHaveBeenCalledWith('w1');
  });

  it('وليها تاريخ وفيه شغالة تانية ← "امسحها برضه" ← "امسحها نهائي" بيمسح', async () => {
    seed([cash, bank], [{ id: 't1', type: 'income', amount: 100, walletId: 'w1', date: '2026-09-01' }]);
    await render(ui());
    await pressDelete('w1');
    await press('امسحها برضه');
    await press('امسحها نهائي');
    expect(mockData.deleteWallet).toHaveBeenCalledWith('w1');
  });

  it('"امسحها نهائي" مفتوح والمحفظة التانية اتمسحت ← الدوسة بتتمنع', async () => {
    const history = [{ id: 't1', type: 'income', amount: 100, walletId: 'w1', date: '2026-09-01' }];
    seed([cash, bank], history);
    await render(ui());
    await pressDelete('w1');
    await press('امسحها برضه');
    mockData.wallets = [cash];
    await screen.rerender(ui());
    await press('امسحها نهائي');
    expectLastActiveRefusal();
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
  });

  it('التأكيد مفتوح والمحفظة التانية اتمسحت من جهاز تاني ← الدوسة بتتمنع', async () => {
    await render(ui());
    await pressDelete('w1');
    mockData.wallets = [cash];
    await screen.rerender(ui());
    await press('حذف');
    expectLastActiveRefusal();
    expect(mockData.deleteWallet).not.toHaveBeenCalled();
  });

  it('الأرشفة: الشيت مفتوح والمحفظة التانية اتمسحت ← رسالة الأرشفة زي ما هي، مش رسالة المسح', async () => {
    seed([cash, bank]);
    mockData.subscriptions = [{ id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true }];
    await render(ui());
    await pressDelete('w1');
    await press('أرشفها');
    await act(async () => { fireEvent.press(screen.getByText('البنك')); });
    mockData.wallets = [cash];
    await screen.rerender(ui());
    await act(async () => { fireEvent.press(screen.getByTestId('archive_sheet_confirm')); });
    expectArchiveRefusal();
    expect(alertSpy).not.toHaveBeenCalledWith(LAST_ACTIVE_TITLE, DELETE_BODY, expect.anything());
    expect(mockData.archiveWallet).not.toHaveBeenCalled();
  });

  it('المسح مبيطلعش رسالة الأرشفة', async () => {
    seed([cash, savings]);
    await render(ui());
    await pressDelete('w1');
    expect(alertSpy).not.toHaveBeenCalledWith(LAST_ACTIVE_TITLE, ARCHIVE_BODY, expect.anything());
  });
});
