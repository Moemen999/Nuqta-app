import { BROKEN_WALLET_ARCHIVE_BLOCK } from '@/lib/brokenDocs';
import { AMOUNT_CLEARED_BODY, amountClearedTitle, planLowAlertCommit, planWalletOpeningCommit, walletAmountRejectReason } from '@/lib/finance';
import {
  AUTOSAVED_ANNOUNCEMENT, OPENING_PENDING_HINT, nameEmptyNotice, openingConfirmCopy, openingDroppedNotice, openingGoneNotice,
  openingStaleNotice, walletAmountRejectNotice,
} from '@/lib/walletCopy';
import ArchiveSheet, { type ReassignItem, type ReassignTarget } from '@/components/ArchiveSheet';
import ArchivedList, { restoredAnnouncement } from '@/components/ArchivedList';
import ListEmptyState from '@/components/ListEmptyState';
import BackButton from '@/components/BackButton';
import { useData } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import {
  reassignTargetsBlock, roundedWalletBalance, walletArchiveBlock, walletBalanceBlockNotice, walletBalanceGoneLine,
  walletDeleteBlock, walletDeleteConsequences, walletHasHistory, walletLinkSummary, walletReferences, type ArchiveBlock,
} from '@/lib/archiving';
import {
  DATA_LOADING_BODY, WALLET_BLOCKED_TITLE, walletActionBlockedBy, walletActionLoading, walletBlockedBody,
} from '@/lib/listenerErrors';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import { useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useConfirm } from '@/components/ConfirmProvider';
import { useNotice } from '@/components/NoticeProvider';
import { cardElevation, MIN_TOUCH, space, typeScale, radius } from '@/lib/tokens';
import { Button } from '@/components/Button';
import { Text, TextInput } from '@/components/AppText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAME_MAX_LENGTH } from '@/lib/textLimits';

/** قارئ الشاشة بس — مفيش حاجة تتعمل لو المنصة مبتدعمش */
function announce(text: string) {
  try { AccessibilityInfo.announceForAccessibility(text); } catch { /* زينة */ }
}

/**
 * إدارة المحافظ. اتنقلت من شاشة الإعدادات زي ما هي — منطق الحفظ ما اتغيرش
 * ولا حرف: نفس `useAmountDrafts` (متكتبش من غير تغيير، ارفض الكلام اللي مش
 * رقم، اسأل قبل السالب، احفظ لوحدك قبل ما الشاشة تتشال)، ونفس مسوّدات
 * الأسماء، ونفس مسارات الحذف والأرشفة.
 *
 * الفرق الوحيد إن مسوّدات الأسماء مابقاش لها بادئة `w_`: البادئة كانت موجودة
 * عشان المحافظ والفئات كانوا بيتشاركوا خريطة واحدة في شاشة واحدة. دلوقتي كل
 * شاشة ليها خريطتها، فالمعرّف لوحده كفاية.
 *
 * **الفحص بيتعاد لحظة الدوسة على كل تأكيد** (الميزة 10، الجولة الأخيرة): زرار التأكيد بينادي نسخة الـrender اللي فتحته،
 * فكل الفحوص بتقرا `live` (آخر بيانات وصلت) مش متغيّرات الـrender — البيانات لسه بتوصل، الرصيد، البيانات البايظة،
 * اللي مربوط بيها، والأماكن اللي اتختارت للنقل.
 */
export default function WalletsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { money } = usePrivacy();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const notice = useNotice();
  const confirm = useConfirm();
  const data = useData();
  const {
    wallets, addWallet, updateWallet, deleteWallet, archiveWallet, restoreWallet,
  } = data;
  const { walletColors } = useChartColors();
  // آخر بيانات وصلت — كل فحص لحظة الدوسة بيقرا من هنا
  const live = useRef(data);
  live.current = data;

  const [newWallet, setNewWallet] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{
    id: string; name: string; items: ReassignItem[]; targets: ReassignTarget[];
  } | null>(null);
  const [archiving, setArchiving] = useState(false);
  // آخر حاجة اتكتبت في كل خانة رقم — عشان رسالة الرفض تقول السبب (سالب / كبير قوي / مش رقم)
  const typed = useRef<Record<string, string>>({});

  const walletName = (id: string) => live.current.wallets.find(x => x.id === id)?.name ?? '';
  const rejectWith = (field: 'الرصيد الابتدائي' | 'حد التنبيه', key: string) => (id: string) =>
    notice(...walletAmountRejectNotice(field, walletName(id), walletAmountRejectReason(typed.current[`${key}:${id}`])));
  const opening = useAmountDrafts(
    // `openingInvalid` ← NaN: الخطة بتكتب أي رقم صالح (حتى 0 اللي معروض) عشان العلامة تتشال (بند B)
    id => { const w = wallets.find(x => x.id === id); return w?.openingInvalid ? NaN : (w?.openingBalance ?? 0); },
    (id, value) => {
      // L2 (الميزة 10): المحفظة اتأرشفت أو اتمسحت والتأكيد مفتوح ← منكتبش (الفحص القديم كان على الرقم بس)
      const w = live.current.wallets.find(x => x.id === id);
      if (!w || w.archived) { notice(...openingGoneNotice(w?.name ?? walletName(id))); return; }
      updateWallet(id, { openingBalance: value });
      announce(AUTOSAVED_ANNOUNCEMENT);
    },
    {
      // أي تغيير في الرصيد الابتدائي بيسأل (الرصيد كله بيتحرك بالفرق) — الاختبار العنيف 2026-11-07، قرار مؤمن
      plan: planWalletOpeningCommit,
      confirmCopy: (id, value, stored) => openingConfirmCopy(walletName(id), stored, value),
      // خرجت من الشاشة والرقم مستني تأكيد ← رسالة (برّه الشاشة) بدل ما يضيع ساكت
      onDroppedConfirm: id => notice(...openingDroppedNotice(walletName(id))),
      onStaleConfirm: id => notice(...openingStaleNotice(walletName(id))),
      // «abc» أو «1,5» كانوا بيرجعوا للمحفوظ ساكت (الجولة الأخيرة، بند 7)؛ و«1e300» كبير قوي (الميزة 10، بند 7)
      onReject: rejectWith('الرصيد الابتدائي', 'opening'),
      onDroppedReject: rejectWith('الرصيد الابتدائي', 'opening'),
    },
  );
  // حد التنبيه (الميزة 10، بند 8): من صفر وطالع ومقرّب للقرش ومبيسألش؛ والفاضي مبيتحفظش لوحده (زي الميزانية)
  const lowAlert = useAmountDrafts(
    id => wallets.find(w => w.id === id)?.lowAlert ?? 0,
    (id, value) => {
      if (!live.current.wallets.some(x => x.id === id)) return;
      updateWallet(id, { lowAlert: value });
      announce(AUTOSAVED_ANNOUNCEMENT);
    },
    {
      plan: planLowAlertCommit,
      autosaveBlank: false,
      onBlankCleared: id => notice(amountClearedTitle(`حد التنبيه لمحفظة "${walletName(id)}"`), AMOUNT_CLEARED_BODY),
      onReject: rejectWith('حد التنبيه', 'alert'),
      onDroppedReject: rejectWith('حد التنبيه', 'alert'),
    },
  );
  const { busy: adding, run: runAdd } = useBusy();
  const { busyKey: deletingKey, run: runDelete } = useBusyKey(() => notice(BUSY_NOTICE.title, BUSY_NOTICE.body));

  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);
  const archivedWallets = useMemo(() => wallets.filter(w => w.archived), [wallets]);

  /**
   * لو بيانات الرصيد ما وصلتش (اترفضت) **أو لسه بتوصل** (H1، الميزة 10)، بيقول كده وبيرجّع true — والمسح/الأرشفة بيقفوا.
   * بيتنادى وقت فتح التأكيد **ولحظة الدوسة عليه**.
   */
  function blockedByMissingData() {
    const { loadErrors, figuresPending, undelivered } = live.current;
    const missing = walletActionBlockedBy(loadErrors);
    if (missing.length > 0) { notice(WALLET_BLOCKED_TITLE, walletBlockedBody(missing)); return true; }
    if (walletActionLoading(figuresPending, undelivered).length > 0) { notice(WALLET_BLOCKED_TITLE, DATA_LOADING_BODY); return true; }
    return false;
  }

  function refsFor(id: string) {
    const { transactions, brokenTransactions, debts, subscriptions, gamiyas, incomes } = live.current;
    // البايظة كمان (بند B): عملية مش محسوبة لسه تاريخ على المحفظة — من غيرها المحفظة كانت هتتمسح نهائي وتتيّمها
    return walletReferences(id, { transactions: [...transactions, ...brokenTransactions], debts, subscriptions, gamiyas, incomes });
  }

  function balanceOf(id: string) {
    const w = live.current.wallets.find(x => x.id === id);
    return w ? roundedWalletBalance(live.current.transactions, id, w.openingBalance) : 0;
  }

  function clearNameDraft(id: string) {
    setNameDrafts(d => {
      if (d[id] === undefined) return d;
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  /** نفس قاعدة خانات الأرقام: الخروج من الخانة مبيكتبش لو مفيش تغيير */
  function saveName(id: string, current: string) {
    const val = nameDrafts[id];
    if (val === undefined) return;
    const name = val.trim();
    clearNameDraft(id);
    // الاسم الفاضي بيرجع للقديم — وبيقول (كان بيرجع ساكت)
    if (!name) { if (current) notice(...nameEmptyNotice('المحفظة')); return; }
    if (name === current) return;
    updateWallet(id, { name });
    announce(AUTOSAVED_ANNOUNCEMENT);
  }

  function showBlock(block: ArchiveBlock, name: string, action: 'archive' | 'delete') {
    if (block.kind === 'last-active') {
      // المسح بيقترح "رجّع واحدة من المؤرشفة" — اللي عنده مؤرشفة مش محتاج يعمل
      // جديدة. في الأرشفة الكلام ده مالوش معنى، فكل واحد ليه جملته
      notice('دي آخر محفظة شغالة',
        action === 'delete'
          ? 'لازم يفضل عندك محفظة واحدة شغالة على الأقل عشان تقدر تسجّل عملياتك. اعمل محفظة تانية أو رجّع واحدة من المؤرشفة، وبعدين امسح دي.'
          : 'لازم يفضل عندك محفظة واحدة على الأقل عشان تقدر تسجّل عملياتك. اعمل محفظة تانية الأول.');
      return;
    }
    if (block.kind === 'balance') {
      // السالب بكلامه، والرقم من `money` (بند 6)
      notice(...walletBalanceBlockNotice(name, block.balance, money));
      return;
    }
    if (block.kind === 'target-gone') {
      notice('فيه حاجة اتغيّرت',
        `المحفظة اللي اخترتها للنقل اتأرشفت أو اتمسحت من جهاز تاني، فما أرشفناش "${name}". افتح الأرشفة تاني واختار محفظة شغالة.`);
      return;
    }
    notice('مفيش محفظة تانية',
      'الاشتراكات والجمعيات والدخل الثابت الشغالة محتاجة محفظة تتنقل لها. اعمل محفظة تانية الأول.');
  }

  /** آخر محفظة شغالة مبتتمسحش أبدًا — بيقول كده وبيرجّع true */
  function blockedAsLastActive(id: string, name: string) {
    const block = walletDeleteBlock(id, live.current.wallets);
    if (!block) return false;
    showBlock(block, name, 'delete');
    return true;
  }

  /**
   * المسح نفسه، بعد فحص أخير لحظة الدوسة (المحافظ والبيانات ممكن تكون اتغيّرت والتأكيد مفتوح). `fromSimple`: التأكيد
   * اللي اتفتح كان "مفيش تاريخ" — لو تاريخ ظهر وهو مفتوح، بنرجع للسؤال الكامل بدل ما نمسح محفظة ليها عمليات
   */
  function deleteNow(id: string, name: string, fromSimple = false) {
    if (blockedByMissingData()) return;
    if (!live.current.wallets.some(x => x.id === id)) return;
    if (blockedAsLastActive(id, name)) return;
    if (fromSimple && walletHasHistory(refsFor(id))) { confirmDelete(id, name); return; }
    // DataContext بيرفض هو كمان (بند 13) — لو المحافظ اتغيّرت بين الفحص والكتابة
    // الرفض بيرجع هنا ويتقال بنفس الرسالة
    runDelete(id, async () => {
      try {
        const result = await deleteWallet(id);
        if (result.outcome === 'blocked') showBlock(result.block, name, 'delete');
      } catch (e) {
        // نفس archiveNow: اللي بيترمي قبل الكتابة كان هيبقى unhandled rejection.
        // رمي هنا = باج، فبيوصل Sentry (كود الخطأ بس، من غير الاسم)
        reportAtomicFailure('مسح المحفظة', e);
        notice('حصل خطأ، جرب تاني', `"${name}" ما اتمسحتش — حصلت مشكلة قبل ما نمسحها، ومفيش حاجة اتغيّرت. جرب تاني، ولو اتكررت اقفل التطبيق وافتحه.`);
      }
    });
  }

  function confirmDelete(id: string, name: string) {
    if (blockedByMissingData()) return;
    if (blockedAsLastActive(id, name)) return;
    const refs = refsFor(id);
    if (!walletHasHistory(refs)) {
      // مفيش تاريخ بس فيه رصيد (رصيد ابتدائي): الرقم ده هيختفي من الإجمالي، فلازم يتقال (بند 5)
      const balance = balanceOf(id);
      const balanceLine = Math.abs(balance) >= 0.005 ? `\n${walletBalanceGoneLine(balance, money)}` : '';
      confirm('تمسح المحفظة؟', `متأكد إنك عايز تمسح "${name}"؟ مفيش أي عملية أو دين مربوط بيها.${balanceLine}`, [
        { text: 'سيبها', style: 'cancel' },
        { text: 'امسحها', style: 'destructive', onPress: () => deleteNow(id, name, true) },
      ]);
      return;
    }
    confirm('المحفظة دي ليها تاريخ',
      `"${name}" مربوط بيها ${walletLinkSummary(refs)}. لو مسحتها التاريخ هيظهر باسم محفظة ممسوحة. تقدر تأرشفها بدل كده — هتختفي من الاختيارات وتفضل ظاهرة في التاريخ.`,
      [
        { text: 'سيبها', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchive(id, name) },
        { text: 'امسحها برضه', style: 'destructive', onPress: () => confirmHardDelete(id, name) },
      ]);
  }

  /** التأكيد التاني: الأرقام الحقيقية قبل المسح النهائي */
  function confirmHardDelete(id: string, name: string) {
    if (blockedByMissingData()) return;
    if (blockedAsLastActive(id, name)) return;
    if (!live.current.wallets.some(x => x.id === id)) return;
    confirm('مسح نهائي', walletDeleteConsequences({ balance: balanceOf(id), refs: refsFor(id), money }).join('\n'), [
      { text: 'ارجع', style: 'cancel' },
      { text: 'امسحها نهائي', style: 'destructive', onPress: () => deleteNow(id, name) },
    ]);
  }

  /** شروط الأرشفة على البيانات **دلوقتي** — بتتنادى وقت فتح الشيت ووقت التأكيد */
  function archiveBlockFor(id: string) {
    const all = live.current.wallets;
    if (!all.some(x => x.id === id)) return null;
    const active = all.filter(w => !w.archived);
    return walletArchiveBlock({
      walletId: id,
      balance: balanceOf(id),
      refs: refsFor(id),
      activeWalletCount: active.length,
      otherActiveWalletCount: active.filter(x => x.id !== id).length,
    });
  }

  /** بيانات ناقصة على المحفظة ← مفيش أرشفة (money-reviewer + silent-failure-hunter): بعدها التصليح بيتقفل. وقت الفتح **ووقت التأكيد** */
  function brokenDataOn(id: string) {
    const { wallets: all, brokenTransactions } = live.current;
    return !!all.find(x => x.id === id)?.openingInvalid || brokenTransactions.some(t => t.walletId === id || t.toWalletId === id);
  }

  function activeItemsFor(id: string): ReassignItem[] {
    const refs = refsFor(id);
    return [
      ...refs.activeSubscriptions.map(x => ({ ...x, kind: 'اشتراك' })),
      ...refs.activeGamiyas.map(x => ({ ...x, kind: 'جمعية' })),
      ...refs.activeIncomes.map(x => ({ ...x, kind: 'دخل ثابت' })),
    ];
  }

  /**
   * فتح الأرشفة — والتأكيد البسيط (مفيش حاجة تتنقل) بيرجع هنا تاني لحظة الدوسة (`confirmed`)، فكل الفحوص بتتعاد (بند 2):
   * الرصيد، البيانات البايظة، البيانات الناقصة، واللي مربوط بيها — ولو حاجة شغالة اتربطت وهو مفتوح، الشيت بيفتح بدل الأرشفة
   */
  function startArchive(id: string, name: string, confirmed = false) {
    if (blockedByMissingData()) return;
    if (!live.current.wallets.some(x => x.id === id)) {
      if (confirmed) notice('المحفظة دي اتمسحت', `"${name}" اتمسحت من جهاز تاني، فمفيش حاجة تتأرشف.`);
      return;
    }
    const block = archiveBlockFor(id);
    if (block) { showBlock(block, name, 'archive'); return; }
    if (brokenDataOn(id)) { notice(...BROKEN_WALLET_ARCHIVE_BLOCK); return; }

    const items = activeItemsFor(id);
    if (items.length === 0) {
      if (confirmed) { void archiveNow(id, name, {}); return; }
      confirm('أرشفة محفظة', `هنأرشف "${name}". هتختفي من الاختيارات وتفضل ظاهرة في التاريخ.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchive(id, name, true) },
      ]);
      return;
    }
    const targets = live.current.wallets.filter(x => !x.archived && x.id !== id);
    setSheet({ id, name, items, targets: targets.map(x => ({ id: x.id, name: x.name })) });
  }

  /** الأرشفة نفسها — DataContext بيرفض آخر محفظة شغالة هو كمان (بند 13)، والرفض بيتقال بنفس الرسالة */
  async function archiveNow(id: string, name: string, reassign: Parameters<typeof archiveWallet>[1]) {
    try {
      const result = await archiveWallet(id, reassign);
      if (result.outcome === 'blocked') showBlock(result.block, name, 'archive');
    } catch (e) {
      reportAtomicFailure('أرشفة المحفظة', e);
      // فشل الكتابة نفسها بيتقال من `track` باسم المحفظة؛ ده للي بيترمي قبلها
      // (تجهيز الدفعة) — كان هيبقى unhandled rejection والشيت اتقفل (silent-failure-hunter)
      notice('حصل خطأ، جرب تاني', `"${name}" ما اتأرشفتش — حصلت مشكلة وإحنا بنجهّز الأرشفة، ومفيش حاجة اتغيّرت. جرب تاني، ولو اتكررت اقفل التطبيق وافتحه.`);
    }
  }

  function confirmRestore(id: string, name: string) {
    confirm('رجّع المحفظة', `"${name}" هترجع تظهر في الاختيارات تاني.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رجّعها', onPress: () => { restoreWallet(id); announce(restoredAnnouncement(name)); } },
    ]);
  }

  async function confirmSheet(assignments: Record<string, string>) {
    if (!sheet) return;
    const { id, name, items } = sheet;
    // أي رفض بيقفل الشيت: زرار التأكيد بيتقفل بعد أول دوسة (ArchiveSheet)، فالشيت المفتوح بعد الرفض كان هيبقى ميت
    const refuse = (fn: () => void) => { setSheet(null); fn(); };
    if (walletActionBlockedBy(live.current.loadErrors).length > 0
      || walletActionLoading(live.current.figuresPending, live.current.undelivered).length > 0) {
      refuse(() => { blockedByMissingData(); });
      return;
    }
    // الشيت ممكن يفضل مفتوح وحاجة تتغيّر من جهاز تاني: عملية جديدة على
    // المحفظة، أو اشتراك/جمعية اتمسحوا ومعاهم دفعاتهم (money-reviewer). الرصيد
    // اتفحص وقت الفتح بس، فكانت بتتأرشف ورصيدها مش صفر ومحدش شايفه
    // المحفظة نفسها اتمسحت من جهاز تاني: archiveBlockFor بيرجّع null ساعتها
    // زي "مفيش مانع"، فكانت بتعدّي لأرشفة مستند مش موجود (silent-failure-hunter)
    if (!live.current.wallets.some(w => w.id === id)) {
      refuse(() => notice('المحفظة دي اتمسحت', `"${name}" اتمسحت من جهاز تاني، فمفيش حاجة تتأرشف.`));
      return;
    }
    const block = archiveBlockFor(id);
    if (block) { refuse(() => showBlock(block, name, 'archive')); return; }
    // عملية بايظة أو علامة وصلت والشيت مفتوح (silent-failure-hunter جولة 2)
    if (brokenDataOn(id)) { refuse(() => notice(...BROKEN_WALLET_ARCHIVE_BLOCK)); return; }
    // حاجة من اللي في الشيت اتمسحت والرصيد لسه باين صفر: الجمعيات/الاشتراكات
    // والعمليات listeners منفصلة، فممكن المسح يوصل هنا قبل ما دفعاتها تتشال من
    // الرصيد (money-reviewer). منأرشفش على رقم ممكن يكون قديم — افتحها تاني
    const { subscriptions, gamiyas, incomes } = live.current;
    const liveIds = new Set([...subscriptions, ...gamiyas, ...incomes].map(x => x.id));
    if (items.some(i => !liveIds.has(i.id))) {
      refuse(() => notice('فيه حاجة اتغيّرت',
        `اللي كنت بتنقله اتغيّر من جهاز تاني. افتح الأرشفة تاني عشان نتأكد إن رصيد "${name}" لسه صفر.`));
      return;
    }
    // حاجة شغالة جديدة اتربطت بالمحفظة والشيت مفتوح ← الشيت بيتفتح من جديد بيها (بند 2)
    const now = activeItemsFor(id);
    if (now.some(n => !items.some(i => i.id === n.id))) { setSheet(null); startArchive(id, name); return; }
    // بند 3: المحفظة اللي اتختارت للنقل اتأرشفت أو اتمسحت والشيت مفتوح
    const targetBlock = reassignTargetsBlock(Object.values(assignments), live.current.wallets, id);
    if (targetBlock) { refuse(() => showBlock(targetBlock, name, 'archive')); return; }
    // بالنوع صريح مش "أي حاجة مش اشتراك = جمعية": الدخل الثابت كان هيتبعت
    // كجمعية ويتكتب في مستند مش موجود فالدفعة كلها تفشل
    const kindOf = new Map(items.map(i => [i.id, i.kind]));
    const subscriptionsMap: Record<string, string> = {};
    const gamiyasMap: Record<string, string> = {};
    const incomesMap: Record<string, string> = {};
    Object.entries(assignments).forEach(([itemId, target]) => {
      const kind = kindOf.get(itemId);
      if (kind === 'اشتراك') subscriptionsMap[itemId] = target;
      else if (kind === 'دخل ثابت') incomesMap[itemId] = target;
      else gamiyasMap[itemId] = target;
    });
    setArchiving(true);
    try {
      await archiveNow(id, name, { subscriptions: subscriptionsMap, gamiyas: gamiyasMap, incomes: incomesMap });
    } finally {
      setArchiving(false);
      setSheet(null);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.headerRow}>
          <BackButton />
          <ScreenTitle>المحافظ</ScreenTitle>
        </View>
        <Text style={styles.hint}>تقدر تدوس على اسم المحفظة تعدله مباشرة</Text>

        {activeWallets.length === 0 && <ListEmptyState testID="wallets_empty" kind="wallets" />}

        {activeWallets.map(w => (
          <View key={w.id} testID={`wallet_row_${w.id}`} style={styles.walletCard}>
            <View style={styles.walletHead}>
              <View style={[styles.dot, { backgroundColor: walletColors.get(w.id) }]} />
              <TextInput
                testID={`wallet_name_input_${w.id}`}
                style={styles.nameInput}
                maxLength={NAME_MAX_LENGTH} value={nameDrafts[w.id] !== undefined ? nameDrafts[w.id] : w.name}
                onChangeText={v => setNameDrafts(d => ({ ...d, [w.id]: v }))}
                onBlur={() => saveName(w.id, w.name)}
                textAlign="right"
                accessibilityLabel={`اسم المحفظة ${w.name}`}
              />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`امسح محفظة ${w.name}`} accessibilityState={{ busy: deletingKey === w.id, disabled: deletingKey === w.id }}
                testID={`wallet_delete_${w.id}`} style={styles.deleteBtn} onPress={() => confirmDelete(w.id, w.name)} disabled={deletingKey === w.id}>
                <Text style={[styles.deleteText, deletingKey === w.id && styles.btnBusy]}>
                  {deletingKey === w.id ? '...' : 'امسح'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.walletRow}>
              <View style={{ flex: 1 }}>
                {/* العنوان الظاهر مخفي عن قارئ الشاشة: الخانة نفسها بتقول اسمها واسم المحفظة (a11y-architect) */}
                <Text style={styles.microLabel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">الرصيد الابتدائي</Text>
                <TextInput
                  testID={`wallet_opening_input_${w.id}`}
                  style={styles.smallInput}
                  keyboardType="numeric"
                  value={opening.valueFor(w.id, w.openingBalance)}
                  onChangeText={v => { typed.current[`opening:${w.id}`] = v; opening.onChange(w.id, v); }}
                  onBlur={() => opening.onBlur(w.id)}
                  textAlign="right"
                  accessibilityLabel={`الرصيد الابتدائي، ${w.name}`}
                />
                {/* متركّب دايمًا: المنطقة الحية بتتقري لما محتواها يتغيّر — لو بتتركّب مع النص أندرويد ساعات مبيقولهاش */}
                <Text testID={opening.pendingConfirm(w.id) ? `wallet_opening_pending_${w.id}` : undefined}
                  style={opening.pendingConfirm(w.id) ? styles.pendingHint : styles.pendingHintIdle} accessibilityLiveRegion="polite">
                  {opening.pendingConfirm(w.id) ? OPENING_PENDING_HINT : ''}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">حد التنبيه</Text>
                <TextInput
                  testID={`wallet_alert_input_${w.id}`}
                  style={styles.smallInput}
                  keyboardType="numeric"
                  value={lowAlert.valueFor(w.id, w.lowAlert)}
                  onChangeText={v => { typed.current[`alert:${w.id}`] = v; lowAlert.onChange(w.id, v); }}
                  onBlur={() => lowAlert.onBlur(w.id)}
                  textAlign="right"
                  accessibilityLabel={`حد التنبيه، ${w.name}`}
                />
              </View>
            </View>
          </View>
        ))}

        <View style={styles.addRow}>
          <TextInput testID="wallet_add_input" style={styles.addInput} placeholder="اسم محفظة جديدة" placeholderTextColor={colors.textSecondary}
            maxLength={NAME_MAX_LENGTH} value={newWallet} onChangeText={setNewWallet} textAlign="right" accessibilityLabel="اسم محفظة جديدة" />
          <Button
            testID="wallet_add_button"
            size="sm"
            icon="add"
            iconOnly
            label="إضافة محفظة"
            style={styles.addBtn}
            busy={adding}
            onPress={() => {
              const name = newWallet.trim();
              if (!name) return;
              runAdd(async () => { await addWallet(name); setNewWallet(''); });
            }} />
        </View>

        <ArchivedList title="المحافظ المؤرشفة" items={archivedWallets} onRestore={confirmRestore} />

        {sheet && (
          <ArchiveSheet
            key={sheet.items.map(i => i.id).join('|')}
            title="أرشفة محفظة"
            intro={`قبل ما نأرشف "${sheet.name}" لازم الحاجات الشغالة دي تلاقي محفظة تانية.`}
            items={sheet.items}
            targets={sheet.targets}
            targetLabel="المحفظة الجديدة"
            confirmText="أرشفها"
            busy={archiving}
            onConfirm={assignments => { void confirmSheet(assignments); }}
            onClose={() => setSheet(null)}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.md },
    dot: { width: 8, height: 8, borderRadius: radius.xxs },
    walletCard: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, ...cardElevation(c) },
    walletHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, marginBottom: space.md },
    nameInput: { flex: 1, color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right', paddingVertical: 2, minHeight: MIN_TOUCH },
    walletRow: { flexDirection: 'row-reverse', gap: space.md },
    microLabel: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginBottom: 3 },
    pendingHint: { color: c.accentText, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xxs },
    pendingHintIdle: { height: 0 },
    smallInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.sm, color: c.text, paddingHorizontal: space.md, paddingVertical: 7, fontSize: typeScale.body, minHeight: MIN_TOUCH },
    // "حذف" كان نص لوحده ~16 بكسل جنب خانة نص — بقى 44 (MIN_TOUCH، a11y-architect)
    deleteBtn: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    deleteText: { color: c.dangerText, fontSize: typeScale.body },
    addRow: { flexDirection: 'row-reverse', gap: space.sm, marginTop: space.md, marginBottom: space.xs, alignItems: 'center' },
    addInput: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, paddingHorizontal: space.lg, paddingVertical: space.sm, fontSize: typeScale.body, minHeight: MIN_TOUCH },
    addBtn: { width: MIN_TOUCH, paddingHorizontal: 0 },
    btnBusy: { opacity: 0.6 },
  });
}
