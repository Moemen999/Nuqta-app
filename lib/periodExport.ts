import * as XLSX from 'xlsx';
import type { TransfersStatus } from '@/lib/spending';
import { isTransferTx } from '@/lib/spending';
import { TYPE_LABELS, categoryLabelById, entryTime, walletHistoryName } from '@/lib/finance';
import { localizeSheets, type ExportRow } from '@/lib/fullExport';
import { transactionsPhrase } from '@/lib/archiving';

/**
 * تصدير عمليات الفترة من الأرشيف (Feature 9 بند 3 و5). من اللي على الشاشة (الـlisteners) — مش من السيرفر زي التصدير
 * الكامل — فالزرار **مقفول** لحد ما العمليات توصل (والديون والجمعية: عمود «محسوبة في الإجماليات» محتاجهم)، ومقفول لو
 * العمليات أو المحافظ أو الفئات اترفضت: الملف كان هيطلع ناقص أو بأسامي «ممسوحة» غلط من غير ما يقول.
 */
export const PERIOD_EXPORT_WAIT = 'الزرار هيشتغل أول ما عملياتك توصل — عشان الملف ميطلعش ناقص.';
/** نفس الاستنى من غير نت: اللي مستنينه هو النت (الجولة الأخيرة) */
export const PERIOD_EXPORT_WAIT_OFFLINE = 'الزرار هيشتغل أول ما النت يرجع وعملياتك توصل — عشان الملف ميطلعش ناقص.';
export const PERIOD_EXPORT_LOAD_FAILED = 'مقدرناش نجيب كل بياناتك، فالملف كان هيطلع ناقص. جرّب تاني لما توصل.';

/**
 * بيستنى العمليات والديون والجمعية **والمحافظ والفئات** (الجولة الأخيرة): من غيرهم الأسامي كانت هتطلع «ممسوحة» في الملف.
 * `categoriesReady` من DataContext؛ المحافظ من `figuresPending`.
 */
export function periodExportBlock(i: {
  figuresPending: readonly string[]; loadErrors: readonly string[]; transfersStatus: TransfersStatus;
  categoriesReady: boolean; serverReachable: boolean;
}): string | null {
  if (['transactions', 'wallets', 'categories'].some(n => i.loadErrors.includes(n))) return PERIOD_EXPORT_LOAD_FAILED;
  const waiting = i.figuresPending.includes('transactions') || i.figuresPending.includes('wallets')
    || i.transfersStatus === 'loading' || !i.categoriesReady;
  if (waiting) return i.serverReachable ? PERIOD_EXPORT_WAIT : PERIOD_EXPORT_WAIT_OFFLINE;
  return null;
}

/** «الكل» من غير `0000-01-01-to-9999-12-31` */
export function periodExportFileName(preset: string, range: { from: string; to: string }, today: string): string {
  return preset === 'all' ? `nuqta-export-all-${today}.xlsx` : `nuqta-export-${range.from}-to-${range.to}.xlsx`;
}

export const COUNTED_YES = 'أيوه';
export const COUNTED_TRANSFER = 'لأ — دين أو جمعية';
export const COUNTED_BETWEEN_WALLETS = 'لأ — بين محافظك';
/** الديون أو الجمعية اترفضوا: مش عارفين العملية دي سلفة ولا لأ */
export const COUNTED_UNKNOWN = 'مش متأكدين — الديون والجمعية ما وصلوش';
/** سطر في آخر الورقة لو فيه «مش متأكدين»: الإجماليات اللي على الشاشة حسبتهم (`cashTotals` من غير تحويلات معروفة) */
export const UNSURE_COUNTED_NOTE = 'ملحوظة: العمليات اللي مكتوب عندها «مش متأكدين» محسوبة في الإجماليات اللي على الشاشة.';
/** عمود «لسه بترفع» بنفس كلام «محسوبة في الإجماليات» — مش TRUE/FALSE بالإنجليزي */
export const PENDING_YES = 'أيوه';
export const PENDING_NO = 'لأ';

type Tx = {
  id: string; type: string; amount: number; date: string; createdAt?: string; walletId: string; toWalletId?: string;
  categoryId?: string; note?: string; gamiyaId?: string;
};
type Named = { id: string; name: string; archived?: boolean; icon?: string };

/**
 * صف لكل عملية. المفاتيح إنجليزي في الكود (زي التصدير الكامل)، والترجمة وقت الكتابة (`COLUMN_NAMES_AR`).
 * `SignedAmount`: أثرها على المحفظة (مصروف −، دخل +) — السحب بين محفظتين مالوش إشارة واحدة فبيفضل فاضي.
 */
export function buildPeriodExportRows(tx: Tx[], i: {
  wallets: Named[]; categories: Named[]; transfers: Set<string>; transfersFailed: boolean; pendingTxIds: Set<string>;
}): ExportRow[] {
  return tx.map(t => {
    const transfer = isTransferTx(t, i.transfers);
    const counted = t.type === 'withdraw' ? COUNTED_BETWEEN_WALLETS
      : transfer ? COUNTED_TRANSFER
      : i.transfersFailed ? COUNTED_UNKNOWN
      : COUNTED_YES;
    const row: ExportRow = {
      Id: t.id,
      Date: t.date,
      Time: entryTime(t.date, t.createdAt),
      Type: TYPE_LABELS[t.type as keyof typeof TYPE_LABELS]?.label || t.type,
      Wallet: walletHistoryName(i.wallets, t.walletId),
      ToWallet: t.type === 'withdraw' ? walletHistoryName(i.wallets, t.toWalletId) : '',
      // من غير أيقونة: عمود الإكسيل المفروض يتفرز ويتفلتر، والإيموجي بيلخبط ده
      Category: categoryLabelById(i.categories, t.categoryId, { icon: false }),
      Amount: t.amount,
      SignedAmount: t.type === 'expense' ? -t.amount : t.type === 'income' ? t.amount : '',
      CountedInTotals: counted,
      Pending: i.pendingTxIds.has(t.id) ? PENDING_YES : PENDING_NO,
      Note: t.note || '',
    };
    return row;
  });
}

/** العمليات البايظة اللي ممكن تكون في الفترة: تاريخها جوّه، أو تاريخها مش مقروء (مش عارفين) */
export function brokenInRange(broken: { date?: string }[], range: { from: string; to: string }): number {
  return broken.filter(b => !b.date || (b.date >= range.from && b.date <= range.to)).length;
}

export function brokenExportNote(n: number): string {
  return `ملحوظة: فيه ${transactionsPhrase(n)} بياناتها ناقصة ومش في الملف ده — صلّحها من الأرشيف.`;
}

/** الملف كله: ورقة «العمليات» بالعربي ومن اليمين للشمال، وسطور ملحوظة في الآخر (بايظ، «مش متأكدين») */
export function buildPeriodWorkbook(rows: ExportRow[], brokenCount: number): XLSX.WorkBook {
  const [sheet] = localizeSheets([{ name: 'Transactions', rows }]);
  const wb = XLSX.utils.book_new();
  const ws = sheet.rows.length ? XLSX.utils.json_to_sheet(sheet.rows) : XLSX.utils.aoa_to_sheet([['(مفيش بيانات)']]);
  const notes: string[] = [];
  if (rows.some(r => r.CountedInTotals === COUNTED_UNKNOWN)) notes.push(UNSURE_COUNTED_NOTE);
  if (brokenCount > 0) notes.push(brokenExportNote(brokenCount));
  if (notes.length) XLSX.utils.sheet_add_aoa(ws, [[], ...notes.map(n => [n])], { origin: -1 });
  XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  wb.Workbook = { ...(wb.Workbook ?? {}), Views: [{ RTL: true }] };
  return wb;
}
