import { plainAmount, speakable, type AmountFormatter } from '@/lib/money';
import { useData, type Settlement } from '@/context/DataContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { archivedWalletDeltas, type ArchivedDelta, type TxChange } from '@/lib/archiving';
import { selectionStyle } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export const SETTLE_TITLE = 'المحفظة دي مؤرشفة';

/**
 * الجملة بتقول الاتجاه بالكلام مش بعلامة على الرقم.
 *
 * "هيغيّر الرصيد بـ -100" بتطلب من المستخدم إنه يترجم علامة السالب بنفسه،
 * وده بالظبط النوع اللي بيتقري غلط في الفلوس. "هينقّص ... 100" مفيهاش
 * ترجمة: الفعل بيقول الاتجاه، والرقم بيبقى مطلق دايمًا.
 */
export function settleBody(name: string, delta: number) {
  const amount = plainAmount(Math.abs(delta));
  return delta > 0
    ? `التعديل ده هيزوّد رصيد "${name}" المؤرشفة ${amount} ج.م. الفرق يروح لأنهي محفظة؟`
    : `التعديل ده هينقّص رصيد "${name}" المؤرشفة ${amount} ج.م. الفرق هيتاخد من أنهي محفظة؟`;
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
    ? 'مفيش ولا محفظة شغالة نحط فيها الفرق، فما اتمسحش حاجة والرصيد زي ما هو. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين امسح تاني.'
    : 'مفيش ولا محفظة شغالة نحط فيها الفرق، فما اتعدّلش حاجة والرصيد زي ما هو. رجّع محفظة من الإعدادات ← المحافظ، أو ضيف محفظة جديدة، وبعدين عدّل تاني.';
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
  const [pending, setPending] = useState<{
    changes: TxChange[];
    run: (settlements: Settlement[]) => void;
    isDelete: boolean;
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
    if (pending && deltas.length === 0) setPending(null);
  }, [pending, deltas]);

  /**
   * بيشغّل العملية على طول لو مفيش محفظة مؤرشفة هتتأثر — وده الحالة الغالبة،
   * فالمستخدم العادي مش هيشوف الشيت دي أبدًا.
   *
   * ولو فيه مؤرشفة هتتأثر ومفيش ولا محفظة شغالة، الشيت بتفتح **ممنوعة**
   * ومبتشغّلش حاجة. الحالتين كانوا في سطر واحد، فالتانية كانت بتشغّل المسح
   * من غير تسوية ورصيد المؤرشفة يبعد عن الصفر ساكت.
   */
  function request(changes: TxChange[], run: (settlements: Settlement[]) => void) {
    if (archivedWalletDeltas(changes, archivedWallets).length === 0) { run([]); return; }
    setPending({ changes, run, isDelete: changes.every(c => !c.after) });
  }

  const sheet = pending && deltas.length > 0 ? (
    <SettleSheet
      deltas={deltas}
      isDelete={pending.isDelete}
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

  return { request, sheet };
}

function SettleSheet({ deltas, isDelete, targets, onConfirm, onCancel }: {
  deltas: ArchivedDelta[];
  isDelete: boolean;
  targets: { id: string; name: string }[];
  onConfirm: (targetByWallet: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { money } = usePrivacy();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // مفيش اختيار افتراضي عن قصد: دي فلوس بتنتقل، فالمستخدم لازم يقول هي رايحة فين
  const [picked, setPicked] = useState<Record<string, string>>({});
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
              ? speakable([SETTLE_TITLE, ...deltas.map(d => settleBlockedBody(d.name, d.delta, isDelete, money)), settleBlockedHint(isDelete)].join(' '))
              : undefined}>
            <Text style={styles.sheetTitle}>{SETTLE_TITLE}</Text>
            {deltas.map(d => (
              <View key={d.walletId} style={styles.card}>
                <Text style={[styles.body, blocked && styles.bodyBlocked]}>
                  {blocked ? settleBlockedBody(d.name, d.delta, isDelete, money) : settleBody(d.name, d.delta)}
                </Text>
                {!blocked && (
                  <View style={styles.chipRow}>
                    {targets.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        onPress={() => setPicked(p => ({ ...p, [d.walletId]: t.id }))}
                        style={[styles.chip, selectionStyle(colors, picked[d.walletId] === t.id)]}>
                        <Text style={{ color: colors.text, fontSize: 13 }}>{t.name}</Text>
                      </TouchableOpacity>
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
              <TouchableOpacity testID="settle_blocked_ok" style={styles.saveBtn} onPress={onCancel} accessibilityRole="button">
                <Text style={{ color: colors.onAccent, fontWeight: '700' }}>تمام</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
                  <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="settle_confirm"
                  style={[styles.saveBtn, !allPicked && styles.btnBusy]}
                  disabled={!allPicked}
                  onPress={() => onConfirm(picked)}>
                  <Text style={{ color: colors.onAccent, fontWeight: '700' }}>احفظ</Text>
                </TouchableOpacity>
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
    card: { backgroundColor: c.surface2, borderRadius: 12, padding: 12, marginTop: 14, borderWidth: 1, borderColor: c.border },
    body: { color: c.text, fontSize: 13, textAlign: 'right', lineHeight: 20, marginBottom: 10 },
    bodyBlocked: { marginBottom: 0 },
    hint: { color: c.textSecondary, fontSize: 13, textAlign: 'right', lineHeight: 20, marginTop: 14 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.5 },
  });
}
