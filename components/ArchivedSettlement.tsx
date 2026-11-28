import { plainAmount, speakable, type AmountFormatter } from '@/lib/money';
import { useData, type Settlement } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { archivedWalletDeltas, type ArchivedDelta, type TxChange } from '@/lib/archiving';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle, radius, space, typeScale } from '@/lib/tokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Text } from '@/components/AppText';
import { useNotice } from '@/components/NoticeProvider';
import { PressableScale } from '@/components/PressableScale';

export const SETTLE_TITLE = 'المحفظة دي مؤرشفة';
/** أكتر من مؤرشفة في نفس التغيير (arabic-copy-reviewer، الميزة 10) */
export const SETTLE_TITLE_MANY = 'المحافظ دي مؤرشفة';
export const settleTitle = (count: number) => (count > 1 ? SETTLE_TITLE_MANY : SETTLE_TITLE);
/** الشيت كانت مفتوحة والمؤرشفة رجعت أو اتمسحت ← اتقفلت ومفيش حاجة اتعملت — كانت بتختفي ساكتة (الميزة 10) */
export const SETTLE_GONE_NOTICE: [string, string] = [
  'ما اتعملش حاجة',
  'المحفظة المؤرشفة اتغيّرت وانت بتختار (رجعت أو اتمسحت)، فما اتعملش حاجة والعملية زي ما هي. راجع الشاشة وجرّب تاني.',
];

/**
 * الجملة بتقول الاتجاه بالكلام مش بعلامة على الرقم.
 *
 * "هيغيّر الرصيد بـ -100" بتطلب من المستخدم إنه يترجم علامة السالب بنفسه،
 * وده بالظبط النوع اللي بيتقري غلط في الفلوس. "هينقّص ... 100" مفيهاش
 * ترجمة: الفعل بيقول الاتجاه، والرقم بيبقى مطلق دايمًا.
 */
export function settleBody(name: string, delta: number, isDelete = false) {
  const amount = plainAmount(Math.abs(delta));
  // المسح كان بيتقال "التعديل ده" (arabic-copy-reviewer، الميزة 10)
  const subject = isDelete ? 'مسح العملية دي' : 'التعديل ده';
  return delta > 0
    ? `${subject} هيزوّد رصيد "${name}" المؤرشفة ${amount} ج.م. الفرق يروح لأنهي محفظة؟`
    : `${subject} هينقّص رصيد "${name}" المؤرشفة ${amount} ج.م. الفرق هيتاخد من أنهي محفظة؟`;
}

/**
 * الفرق مالوش مكان يروح فيه: كل المحافظ مؤرشفة أو ممسوحة. بنمنع ومبنكتبش
 * حاجة — المسح أو التعديل من غير تسوية كان بيحرّك رصيد المؤرشفة ومحدش شايفه.
 */
export function settleBlockedBody(name: string, delta: number, isDelete: boolean, money: AmountFormatter) {
  // `money` من `usePrivacy` مش الرقم الحقيقي الثابت: الرفض مش تأكيد على رقم،
  // فمالوش سبب يكسر الإخفاء (جرد `amountsPrivacy.test`)
  const amount = money(Math.abs(delta));
  const subject = isDelete ? 'مسح العملية دي' : 'التعديل ده';
  const verb = delta > 0 ? 'هيزوّد' : 'هينقّص';
  return `${subject} ${verb} رصيد "${name}" المؤرشفة ${amount} ج.م.`;
}

export function settleBlockedHint(isDelete: boolean) {
  return isDelete
    ? 'مفيش ولا محفظة شغالة نحط فيها الفرق، فالعملية ما اتمسحتش والرصيد زي ما هو. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين امسح تاني.'
    : 'مفيش ولا محفظة شغالة نحط فيها الفرق، فالعملية ما اتعدّلتش والرصيد زي ما هو. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين عدّل تاني.';
}

/**
 * تسوية رصيد المحفظة المؤرشفة.
 *
 * المحفظة المؤرشفة رصيدها صفر بشرط الأرشفة، وهي مخفية من الإجمالي. يعني
 * تعديل أو حذف عملية قديمة عليها بيحرّك فلوس في مكان محدش شايفه: تعدّل
 * مصروف قديم من 500 لـ400، فـ100 جنيه "تظهر" في محفظة مخفية والإجمالي
 * بتاعك ما اتغيرش — فلوس ضاعت من غير ما حد يقول.
 *
 * فبنسأل المستخدم الفرق يروح فين، وبنبعت التعديل + التحويل في دفعة واحدة.
 *
 * الاستخدام:
 *   const settle = useArchivedSettlement();
 *   settle.request(changes, settlements => deleteTransaction(id, settlements));
 *   ... {settle.sheet}
 */
export function useArchivedSettlement() {
  const { wallets } = useData();
  const notice = useNotice();
  const [pending, setPending] = useState<{
    changes: TxChange[];
    run: (settlements: Settlement[]) => void;
    isDelete: boolean;
    intro?: string;
    confirmLabel?: string;
  } | null>(null);

  const archivedWallets = useMemo(() => wallets.filter(w => w.archived), [wallets]);
  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);

  // الفرق بيتحسب من المؤرشفة **دلوقتي** مش وقت الفتح (money-reviewer +
  // silent-failure-hunter): مؤرشفة رجعت والشيت مفتوحة كانت هتتسوّى كإنها لسه
  // مؤرشفة، ومحفظة اتأرشفت بعد الفتح كانت هتتمسح من غير تسوية
  const deltas = useMemo(
    () => (pending ? archivedWalletDeltas(pending.changes, archivedWallets) : []),
    [pending, archivedWallets],
  );
  // مبقاش فيه مؤرشفة هتتأثر ← الشيت بتتقفل ومفيش حاجة اتعملت. مبنشغّلش المسح
  // لوحده: المستخدم ما شافش الحالة الجديدة، والعملية لسه قدامه في المودال
  useEffect(() => {
    if (pending && deltas.length === 0) { setPending(null); notice(...SETTLE_GONE_NOTICE); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notice ثابتة؛ الشرط على pending/deltas بس
  }, [pending, deltas]);

  /**
   * بيشغّل العملية على طول لو مفيش محفظة مؤرشفة هتتأثر — وده الحالة الغالبة،
   * فالمستخدم العادي مش هيشوف الشيت دي أبدًا.
   *
   * ولو فيه مؤرشفة هتتأثر ومفيش ولا محفظة شغالة، الشيت بتفتح **ممنوعة**
   * ومبتشغّلش حاجة. الحالتين كانوا في سطر واحد، فالتانية كانت بتشغّل المسح
   * من غير تسوية ورصيد المؤرشفة يبعد عن الصفر ساكت.
   */
  function request(
    changes: TxChange[], run: (settlements: Settlement[]) => void,
    opts: { intro?: string; confirmLabel?: string } = {},
  ) {
    // نفس شرط `needsSettlement` من نفس المكان (react-reviewer): لو اختلفوا، المودال كان
    // هيتخطّى الـAlert والمسح يتعمل من غير أي تأكيد
    if (!needsSettlement(changes)) { run([]); return; }
    setPending({ ...opts, changes, run, isDelete: changes.every(c => !c.after) });
  }

  /**
   * الشيت هتفتح؟ — عشان المودال يسأل سؤال واحد (D3، 2026-10-30، قرار مؤمن): لو هتفتح،
   * سؤال "متأكد؟" والتحذير بيتحطوا جوّاها بدل `Alert` وبعده شيت فوق بعض
   */
  function needsSettlement(changes: TxChange[]) {
    return archivedWalletDeltas(changes, archivedWallets).length > 0;
  }

  const sheet = pending && deltas.length > 0 ? (
    <SettleSheet
      deltas={deltas}
      isDelete={pending.isDelete}
      intro={pending.intro}
      confirmLabel={pending.confirmLabel}
      // الممنوع بيتقرر من المحافظ **دلوقتي** مش وقت الفتح: آخر محفظة شغالة
      // ممكن تتمسح من جهاز تاني والشيت مفتوحة — كانت هتفضل سؤال من غير اختيارات
      targets={activeWallets.map(w => ({ id: w.id, name: w.name }))}
      onCancel={() => setPending(null)}
      onConfirm={targetByWallet => {
        const settlements: Settlement[] = deltas.map(d => ({
          archivedWalletId: d.walletId,
          archivedWalletName: d.name,
          targetWalletId: targetByWallet[d.walletId],
          delta: d.delta,
        }));
        setPending(null);
        pending.run(settlements);
      }}
    />
  ) : null;

  return { request, needsSettlement, sheet };
}

function SettleSheet({ deltas, isDelete, intro, confirmLabel, targets, onConfirm, onCancel }: {
  deltas: ArchivedDelta[];
  isDelete: boolean;
  /** سؤال التأكيد والتحذير لما الشيت هي الحوار الوحيد (D3) — مبيظهرش في الممنوعة */
  intro?: string;
  confirmLabel?: string;
  targets: { id: string; name: string }[];
  onConfirm: (targetByWallet: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { money } = usePrivacy();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // مفيش اختيار افتراضي عن قصد: دي فلوس بتنتقل، فالمستخدم لازم يقول هي رايحة فين
  const [picked, setPicked] = useState<Record<string, string>>({});
  // دوستين في نفس اللحظة قبل ما الشيت تتقفل كانوا بيشغّلوا التسوية مرتين — تحويلين
  // بمعرّفات عشوائية، يعني فلوس بتتنقل مرتين (silent-failure-hunter + react-reviewer)
  const confirmed = useRef(false);
  const blocked = targets.length === 0;
  // اختيار لمحفظة اتأرشفت أو اتمسحت والشيت مفتوحة مبيتحسبش
  const allPicked = deltas.every(d => targets.some(t => t.id === picked[d.walletId]));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View testID={blocked ? 'settle_blocked' : 'settle_sheet'} style={styles.sheet} accessibilityViewIsModal>
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            {/* الممنوعة بتتقري رسالة واحدة زي NoticeProvider، مش عناصر متفرقة */}
            <View accessible={blocked} accessibilityLabel={blocked
              ? speakable([settleTitle(deltas.length), ...deltas.map(d => settleBlockedBody(d.name, d.delta, isDelete, money)), settleBlockedHint(isDelete)].join(' '))
              : undefined}>
            <Text style={styles.sheetTitle} accessibilityRole="header">{settleTitle(deltas.length)}</Text>
            {/* الممنوعة مبتسألش "متأكد؟": مفيش حاجة هتتعمل أصلاً */}
            {!blocked && intro ? <Text testID="settle_intro" style={styles.body}>{intro}</Text> : null}
            {deltas.map(d => (
              <View key={d.walletId} style={styles.card}>
                <Text style={[styles.body, blocked && styles.bodyBlocked]}>
                  {blocked ? settleBlockedBody(d.name, d.delta, isDelete, money) : settleBody(d.name, d.delta, isDelete)}
                </Text>
                {!blocked && (
                  <View style={styles.chipRow}>
                    {targets.map(t => (
                      <PressableScale
                        key={t.id}
                        onPress={() => setPicked(p => ({ ...p, [d.walletId]: t.id }))}
                        testID={`settle_target_${t.id}`}
                        // المختار بيتقري مش بيتشاف بس (a11y-architect)
                        {...selectionA11y(picked[d.walletId] === t.id, 'radio')}
                        style={[styles.chip, selectionStyle(colors, picked[d.walletId] === t.id)]}>
                        <Text style={{ color: colors.text, fontSize: typeScale.body }}>{t.name}</Text>
                      </PressableScale>
                    ))}
                  </View>
                )}
              </View>
            ))}
            {blocked && <Text testID="settle_blocked_hint" style={styles.hint}>{settleBlockedHint(isDelete)}</Text>}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            {blocked ? (
              <Button testID="settle_blocked_ok" label="تمام" style={styles.saveBtn} onPress={onCancel} />
            ) : (
              <>
                <Button variant="secondary" label="إلغاء" style={styles.cancelBtn} onPress={onCancel} />
                <Button
                  testID="settle_confirm"
                  // التأكيد على مسح (D3) بشكل زرار الحذف في التطبيق (خط ونص أحمر، زي "حذف الجمعية")
                  // مش زي "احفظ" — الـAlert القديم كان destructive (a11y-architect)
                  variant={isDelete && confirmLabel ? 'danger' : 'primary'}
                  label={confirmLabel ?? 'احفظ'}
                  style={styles.saveBtn}
                  disabled={!allPicked}
                  // المقفول كان بيتقري "مش متاح" من غير ما يقول ليه (a11y-architect)
                  accessibilityHint={allPicked ? undefined : (deltas.length > 1 ? 'اختار محفظة لكل فرق' : 'اختار المحفظة اللي الفرق هيروح لها')}
                  onPress={() => {
                    if (confirmed.current) return;
                    confirmed.current = true;
                    onConfirm(picked);
                  }} />
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '85%' }), padding: 0, overflow: 'hidden' },
    scrollArea: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 4),
    card: { backgroundColor: c.surface2, borderRadius: radius.lg, padding: space.lg, marginTop: space.xl, borderWidth: 1, borderColor: c.border },
    body: { color: c.text, fontSize: typeScale.body, textAlign: 'right', lineHeight: 20, marginBottom: space.md },
    bodyBlocked: { marginBottom: 0 },
    hint: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', lineHeight: 20, marginTop: space.xl },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH, justifyContent: 'center' },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
  });
}
