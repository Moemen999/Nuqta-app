import { useData } from '@/context/DataContext';

/**
 * الحساب متأكدين إن مفيهوش ولا محفظة شغّالة (مسحها أو أرشفها كلها). مصدر واحد
 * لحالة "مفيش ولا محفظة" في الرئيسية وللزرار العايم "+" (بيستخبّى: من غير
 * محفظة مفيش عملية تتحفظ، والحالة الفاضية فيها زرار "ضيف محفظة").
 *
 * "متأكدين" = السيرفر ردّ، والحساب متجهّز، وlistener المحافظ ما اترفضش. من غير
 * نت ده بانر "مفيش نت"، ولو اترفض ده بانر "مقدرناش نجيب بياناتك" — مش "مفيش محافظ".
 */
export function useNoWallets(): { none: boolean; onlyArchived: boolean } {
  const { wallets, serverReachable, setupStatus, loadErrors } = useData();
  const none = serverReachable && setupStatus === 'done' && !loadErrors.includes('wallets')
    && !wallets.some(w => !w.archived);
  return { none, onlyArchived: none && wallets.length > 0 };
}
