import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ArchiveScreen from '@/app/archive';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';
import { EXPORT_FAIL, sweepExportFiles } from '@/lib/exportFiles';
import { PERIOD_EXPORT_LOAD_FAILED, PERIOD_EXPORT_WAIT, PERIOD_EXPORT_WAIT_OFFLINE, UNSURE_COUNTED_NOTE, periodExportFileName } from '@/lib/periodExport';
import { CATEGORY_NAMES_MISSING } from '@/lib/spending';

/**
 * Feature 9 بند 3 و5: تصدير عمليات الفترة.
 * - الزرار مقفول لحد ما العمليات (والديون والجمعية — عمود «محسوبة في الإجماليات») توصل، ومقفول لو العمليات أو المحافظ أو
 *   الفئات اترفضت — بسطر بيقول ليه. قبل كده كان بيطلّع ملف ناقص من غير ما يقول.
 * - الفشل جملة ثابتة (مش نص الخطأ الخام)، والمشاركة مش متاحة = فشل (مش مسار الكاش في رسالة)، والملف بيتمسح بعد المشاركة.
 * - الأعمدة عربي ومن اليمين للشمال زي التصدير الكامل، والورقة «العمليات».
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  writeAsStringAsync: jest.fn(async () => {}), deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
}));

const today = todayStr();
const tx = (id: string, type: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ id, type, amount, date: today, walletId: 'w', createdAt: `${today}T10:30:00Z`, ...extra });

function setData(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }, { id: 'w2', name: 'بنك', openingBalance: 0, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }],
    transactions: [
      tx('food', 'expense', 150, { categoryId: 'c1' }),
      tx('pay', 'income', 8000),
      tx('lend', 'expense', 2000),
      tx('move', 'withdraw', 300, { toWalletId: 'w2' }),
    ],
    debts: [{ id: 'd', direction: 'owed_to_me', initialTransactionId: 'lend', payments: [], increases: [] }],
    gamiyas: [], brokenTransactions: [], pendingTxIds: new Set(['pay']), serverReachable: true,
    transfersStatus: 'ready', figuresPending: [], loadErrors: [],
    readAllFromServer: jest.fn(),
    ...over,
  });
}
beforeEach(() => { jest.clearAllMocks(); setData(); });
const mount = () => render(<ThemeProvider><NoticeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></NoticeProvider></ThemeProvider>);
const press = () => act(async () => { fireEvent.press(screen.getByTestId('archive_export_button')); });
const writtenSheet = () => {
  const XLSX = require('xlsx');
  const [uri, b64] = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0];
  const wb = XLSX.read(b64, { type: 'base64' });
  return { uri, wb, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][] };
};

describe('الزرار مقفول لحد ما البيانات توصل', () => {
  it.each([
    ['العمليات لسه ما وصلتش', { figuresPending: ['transactions'] }, PERIOD_EXPORT_WAIT],
    ['الديون والجمعية لسه ما وصلوش', { transfersStatus: 'loading' }, PERIOD_EXPORT_WAIT],
    ['العمليات اترفضت', { loadErrors: ['transactions'] }, PERIOD_EXPORT_LOAD_FAILED],
    ['المحافظ اترفضت', { loadErrors: ['wallets'] }, PERIOD_EXPORT_LOAD_FAILED],
    ['الفئات اترفضت', { loadErrors: ['categories'] }, PERIOD_EXPORT_LOAD_FAILED],
    // الجولة الأخيرة: الفئات أو المحافظ لسه ما وصلوش ← الأسامي كانت هتطلع «ممسوحة» في الملف
    ['الفئات لسه ما وصلتش', { categoriesReady: false }, PERIOD_EXPORT_WAIT],
    ['المحافظ لسه ما وصلتش', { figuresPending: ['wallets'] }, PERIOD_EXPORT_WAIT],
    // من غير نت: السطر بيقول إن النت هو اللي مستنينه
    ['من غير نت والعمليات لسه', { figuresPending: ['transactions'], serverReachable: false }, PERIOD_EXPORT_WAIT_OFFLINE],
  ])('%s ← مقفول، وسطر السبب، ومفيش ملف', async (_n, over, reason) => {
    setData(over);
    await mount();
    const btn = screen.getByTestId('archive_export_button');
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(btn.props.accessibilityHint).toBe(reason);
    expect(screen.getByTestId('archive_export_block').props.children).toBe(reason);
    await press();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('كله وصل ← مفتوح، واسم ثابت فيه العدد', async () => {
    await mount();
    const btn = screen.getByTestId('archive_export_button');
    expect(btn.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(btn.props.accessibilityLabel).toBe('صدّر عمليات الفترة (إكسيل)، 4 عمليات');
    expect(screen.queryByTestId('archive_export_block')).toBeNull();
  });
});

describe('الملف', () => {
  it('ورقة «العمليات» من اليمين للشمال، والأعمدة عربي: المعرّف، الوقت، المبلغ بالإشارة، محسوبة في الإجماليات، لسه بترفع', async () => {
    await mount();
    await press();
    const { wb, rows } = writtenSheet();
    expect(wb.SheetNames).toEqual(['العمليات']);
    expect(wb.Workbook?.Views?.[0]?.RTL).toBe(true);
    const header = rows[0] as string[];
    expect(header).toEqual(expect.arrayContaining(['المعرّف', 'التاريخ', 'الوقت', 'النوع', 'المحفظة', 'المبلغ', 'المبلغ بالإشارة', 'محسوبة في الإجماليات', 'لسه بترفع']));
    expect(header.some(h => /^[A-Za-z]+$/.test(h))).toBe(false);
    const col = (name: string) => header.indexOf(name);
    const byId = new Map(rows.slice(1).map(r => [r[col('المعرّف')], r]));
    expect(byId.get('food')![col('المبلغ بالإشارة')]).toBe(-150);
    expect(byId.get('food')![col('محسوبة في الإجماليات')]).toBe('أيوه');
    expect(byId.get('pay')![col('المبلغ بالإشارة')]).toBe(8000);
    // الجولة الأخيرة: «أيوه»/«لأ» زي عمود «محسوبة في الإجماليات»، مش TRUE/FALSE بالإنجليزي
    expect(byId.get('pay')![col('لسه بترفع')]).toBe('أيوه');
    expect(byId.get('food')![col('لسه بترفع')]).toBe('لأ');
    // السلفة: أثرها على المحفظة سالب، بس مش محسوبة في الإجماليات
    expect(byId.get('lend')![col('المبلغ بالإشارة')]).toBe(-2000);
    expect(byId.get('lend')![col('محسوبة في الإجماليات')]).toBe('لأ — دين أو جمعية');
    // السحب بين محفظتين مالوش إشارة واحدة
    expect(byId.get('move')![col('المبلغ بالإشارة')] ?? '').toBe('');
    expect(byId.get('move')![col('محسوبة في الإجماليات')]).toBe('لأ — بين محافظك');
  });

  it('فيه عمليات بايظة في الفترة ← سطر ملحوظة بعددها في آخر الورقة', async () => {
    setData({ brokenTransactions: [
      { id: 'b1', reasons: ['amount'], date: today }, { id: 'b2', reasons: ['date'] }, { id: 'b3', reasons: ['amount'], date: '1999-01-01' },
    ] });
    await mount();
    await press();
    const { rows } = writtenSheet();
    // b1 في الفترة، وb2 تاريخها مش مقروء فممكن تكون فيها — b3 برّه
    expect(String(rows[rows.length - 1][0])).toBe('ملحوظة: فيه عمليتين بياناتها ناقصة ومش في الملف ده — صلّحها من الأرشيف.');
  });

  it('الديون والجمعية اترفضوا ← سطر ملحوظة إن «مش متأكدين» محسوبة في الإجماليات اللي على الشاشة', async () => {
    setData({ transfersStatus: 'failed', loadErrors: ['debts'] });
    await mount();
    await press();
    const { rows } = writtenSheet();
    expect(rows.some(r => String(r[0] ?? '') === UNSURE_COUNTED_NOTE)).toBe(true);
  });

  it('مفيش بايظ ← مفيش سطر ملحوظة', async () => {
    await mount();
    await press();
    const { rows } = writtenSheet();
    expect(rows.some(r => String(r[0] ?? '').startsWith('ملحوظة'))).toBe(false);
  });

  it('اسم الملف: «الكل» من غير 0000/9999', () => {
    expect(periodExportFileName('all', { from: '0000-01-01', to: '9999-12-31' }, '2026-11-19')).toBe('nuqta-export-all-2026-11-19.xlsx');
    expect(periodExportFileName('thisMonth', { from: '2026-11-01', to: '2026-11-30' }, '2026-11-19')).toBe('nuqta-export-2026-11-01-to-2026-11-30.xlsx');
  });

  // أندرويد: الملف بيفضل للكنس الجاي (`exportFiles.test.ts`)
  it('بعد المشاركة الملف بيتمسح من الكاش (iOS)', async () => {
    await mount();
    await press();
    const { uri } = writtenSheet();
    expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.anything());
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  });
});

describe('الفشل جملة ثابتة', () => {
  it('الكتابة رمت ← EXPORT_FAIL.failed مش نص الخطأ، والملف بيتمسح', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockImplementationOnce(async () => { throw new Error('ENOSPC: /data/user/0/x'); });
    await mount();
    await press();
    expect(screen.getByTestId('notice_title').props.children).toBe(EXPORT_FAIL.failed[0]);
    expect(screen.getByTestId('notice_body').props.children).toBe(EXPORT_FAIL.failed[1]);
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
  });

  it('المشاركة مش متاحة ← فشل بجملة ثابتة، ومفيش ملف اتكتب (ولا مسار في الرسالة)', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await mount();
    await press();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice_body').props.children).toBe(EXPORT_FAIL['no-share'][1]);
  });
});

describe('الجولة الأخيرة: اسم الفئة في صفوف الأرشيف', () => {
  const catTx = () => [tx('food', 'expense', 150, { categoryId: 'c1' })];
  it('الفئات اترفضت ← «أسامي الفئات ما وصلتش» مش «فئة ممسوحة»', async () => {
    setData({ transactions: catTx(), categories: [], loadErrors: ['categories'] });
    await mount();
    expect(screen.getByTestId('archive_tx_food').props.accessibilityLabel).toContain(CATEGORY_NAMES_MISSING);
    expect(screen.getByTestId('archive_tx_food').props.accessibilityLabel).not.toContain('ممسوحة');
  });
  it('الفئات لسه ما وصلتش ← «مصروف» من غير اسم (مش «فئة ممسوحة»)', async () => {
    setData({ transactions: catTx(), categories: [], categoriesReady: false });
    await mount();
    expect(screen.getByTestId('archive_tx_food').props.accessibilityLabel.startsWith('مصروف،')).toBe(true);
    expect(screen.getByTestId('archive_tx_food').props.accessibilityLabel).not.toContain('ممسوحة');
  });
});

describe('sweepExportFiles (الخروج ومسح الحساب)', () => {
  it('بيمسح ملفات nuqta-*.xlsx بس', async () => {
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue(['nuqta-export-all-2026-11-19.xlsx', 'nuqta-all-data-2026-11-01.xlsx', 'other.xlsx', 'nuqta-notes.txt']);
    await sweepExportFiles();
    const deleted = (FileSystem.deleteAsync as jest.Mock).mock.calls.map(c => c[0]);
    // الكاش ومجلد التطبيق الاتنين (نسخة قديمة كانت بتكتب في مجلد التطبيق لو مفيش كاش)
    expect(deleted).toEqual([
      'file:///cache/nuqta-export-all-2026-11-19.xlsx', 'file:///cache/nuqta-all-data-2026-11-01.xlsx',
      'file:///docs/nuqta-export-all-2026-11-19.xlsx', 'file:///docs/nuqta-all-data-2026-11-01.xlsx',
    ]);
  });
  it('القراية رمت ← مبيرميش (الخروج مبيقفش عليه)', async () => {
    (FileSystem.readDirectoryAsync as jest.Mock).mockRejectedValueOnce(new Error('x'));
    await expect(sweepExportFiles()).resolves.toBeUndefined();
  });
});

describe('Feature 9 بند 1 و2: الإجماليات والقايمة الفاضية', () => {
  it('الديون وصلت والعمليات لسه ← «بنحمّل» مكان الإجماليات والقايمة، مش «0» ولا «مفيش عمليات»', async () => {
    setData({ figuresPending: ['transactions'], transactions: [] });
    await mount();
    expect(screen.getByTestId('archive_income_loading')).toBeTruthy();
    expect(screen.getByTestId('archive_list_loading')).toBeTruthy();
    expect(screen.queryByTestId('archive_empty')).toBeNull();
  });
  it('العمليات اترفضت ← رسالة خطأ مكان الإجماليات والقايمة الفاضية', async () => {
    setData({ loadErrors: ['transactions'], transactions: [] });
    await mount();
    expect(screen.getByTestId('archive_tx_error')).toBeTruthy();
    expect(screen.getByTestId('archive_empty').props.children).toBe('مقدرناش نجيب عملياتك');
    expect(screen.queryByTestId('archive_income_loading')).toBeNull();
  });
  it('«الكل» وفاضي ← «مفيش عمليات لسه»', async () => {
    setData({ transactions: [] });
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('archive_preset_all')); });
    expect(screen.getByTestId('archive_empty').props.children).toBe('مفيش عمليات لسه');
  });
  it('الصف عقدة واحدة بنفس صيغة الرئيسية (النوع، العنوان، المحفظة، المبلغ بـ«جنيه»، العلامات)', async () => {
    await mount();
    expect(screen.getByTestId('archive_tx_food').props.accessibilityLabel).toMatch(/^مصروف: أكل، كاش، 150 جنيه، /);
    expect(screen.getByTestId('archive_tx_lend').props.accessibilityLabel).toMatch(/، تحويل$/);
    expect(screen.getByTestId('archive_tx_pay').props.accessibilityLabel).toMatch(/، لسه بترفع$/);
  });
});
