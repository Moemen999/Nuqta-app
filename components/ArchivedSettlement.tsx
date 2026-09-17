import { useData, type Settlement } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { archivedWalletDeltas, type ArchivedDelta, type TxChange } from '@/lib/archiving';
import { fmt } from '@/lib/finance';
import { selectionStyle } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useMemo, useState } from 'react';
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
  const amount = fmt(Math.abs(delta));
  return delta > 0
    ? `التعديل ده هيزوّد رصيد "${name}" المؤرشفة ${amount} ج.م. الفرق يروح لأنهي محفظة؟`
    : `التعديل ده هينقّص رصيد "${name}" المؤرشفة ${amount} ج.م. الفرق هيتاخد من أنهي محفظة؟`;
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
    deltas: ArchivedDelta[];
    run: (settlements: Settlement[]) => void;
  } | null>(null);

  const archivedWallets = useMemo(() => wallets.filter(w => w.archived), [wallets]);
  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);

  /**
   * بيشغّل العملية على طول لو مفيش محفظة مؤرشفة هتتأثر — وده الحالة الغالبة،
   * فالمستخدم العادي مش هيشوف الشيت دي أبدًا.
   */
  function request(changes: TxChange[], run: (settlements: Settlement[]) => void) {
    const deltas = archivedWalletDeltas(changes, archivedWallets);
    if (deltas.length === 0 || activeWallets.length === 0) { run([]); return; }
    setPending({ deltas, run });
  }

  const sheet = pending ? (
    <SettleSheet
      deltas={pending.deltas}
      targets={activeWallets.map(w => ({ id: w.id, name: w.name }))}
      onCancel={() => setPending(null)}
      onConfirm={targetByWallet => {
        const settlements: Settlement[] = pending.deltas.map(d => ({
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

function SettleSheet({ deltas, targets, onConfirm, onCancel }: {
  deltas: ArchivedDelta[];
  targets: { id: string; name: string }[];
  onConfirm: (targetByWallet: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // مفيش اختيار افتراضي عن قصد: دي فلوس بتنتقل، فالمستخدم لازم يقول هي رايحة فين
  const [picked, setPicked] = useState<Record<string, string>>({});
  const allPicked = deltas.every(d => picked[d.walletId]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{SETTLE_TITLE}</Text>
            {deltas.map(d => (
              <View key={d.walletId} style={styles.card}>
                <Text style={styles.body}>{settleBody(d.name, d.delta)}</Text>
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
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
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
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.5 },
  });
}
