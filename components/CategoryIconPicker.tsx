import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import {
  EMOJI_INPUT_MESSAGES, EMOJI_INPUT_TRIMMED, emojiIconFromInput, iconDuplicate, iconDuplicateNote,
} from '@/lib/emojiIcon';
import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from '@/lib/finance';
import { selectionStyle } from '@/lib/selection';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, stickyFooterStyle, space, typeScale } from '@/lib/tokens';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { Text, TextInput } from '@/components/AppText';

// أحجام زينة (إيموجي/مدخل) مالهاش درجة في `typeScale` — ثوابت مسمّاة بدل أرقام حرفية
const CATEGORY_GLYPH_SIZE = 24;
const CATEGORY_INPUT_SIZE = 36;
const CATEGORY_PREVIEW_SIZE = 44;

export const ICON_PICKER_TITLE = 'اختار أيقونة';
export const ICON_PICKER_HINT = 'الأيقونة بتظهر جنب اسم الفئة في كل مكان — العمليات والتقارير والميزانية.';
export const ICON_PICKER_DEFAULT_LABEL = 'من غير أيقونة';
export const ICON_PICKER_KEYBOARD_LABEL = 'أيقونة من الكيبورد';
export const ICON_PICKER_KEYBOARD_HINT = 'دوس على 😊 في الكيبورد واختار أي إيموجي.';

type Note = { text: string; suggestion: string | null };

/**
 * `CATEGORY_ICONS` كانت موجودة في `lib/finance.ts` من غير أي واجهة تكتب
 * `icon` خالص: `categoryLabel` كانت بتعرضها لو موجودة، والقايمة كانت
 * متعرّفة، وولا سطر في التطبيق كان بيحطها. يعني حقل بيتقري ومبيتكتبش.
 *
 * `onPick` بيحفظ بس — الشيت هو اللي بيقرر يتقفل: لو الأيقونة مستخدمة في فئة
 * تانية بيفضل مفتوح بسطر هادي واقتراح بديل (مش منع — الحفظ حصل خلاص).
 *
 * "من الكيبورد": React Native مالوش طريقة يفتح كيبورد الإيموجي نفسه (لا على
 * أندرويد ولا iOS)، فبنفتح الكيبورد العادي بسطر بيقول يدوس على 😊.
 */
export default function CategoryIconPicker({
  visible, current, others, onPick, onClose,
}: {
  visible: boolean;
  current?: string;
  /** الفئات التانية (من غير اللي بتتعدّل) — عشان ملاحظة التكرار */
  others: { name: string; icon?: string; archived?: boolean }[];
  onPick: (icon: string | undefined) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [note, setNote] = useState<Note | null>(null);
  const [typing, setTyping] = useState(false);
  const [raw, setRaw] = useState('');

  // الشيت متركّب على طول (visible بس بيتغيّر)، فكل فتحة لازم تبدأ نضيفة
  useEffect(() => {
    if (!visible) { setNote(null); setTyping(false); setRaw(''); }
  }, [visible]);

  const parsed = emojiIconFromInput(raw);
  const errorReason = !parsed.ok && parsed.reason !== 'empty' ? parsed.reason : null;

  // `accessibilityLiveRegion` أندرويد بس — VoiceOver كان هيسكت. وبنعلن لما
  // السبب يتغيّر مش مع كل حرف، عشان مايبقاش بيتكلم وهو بيكتب
  useEffect(() => {
    if (note) AccessibilityInfo.announceForAccessibility(note.text);
  }, [note]);
  useEffect(() => {
    if (errorReason) AccessibilityInfo.announceForAccessibility(EMOJI_INPUT_MESSAGES[errorReason]);
  }, [errorReason]);

  function pick(icon: string | undefined) {
    onPick(icon);
    setTyping(false);
    setRaw('');
    const dup = iconDuplicate(others, icon);
    if (dup) setNote({ text: iconDuplicateNote(dup), suggestion: dup.suggestion });
    else onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{ICON_PICKER_TITLE}</Text>
            <Text style={styles.hint}>{ICON_PICKER_HINT}</Text>

            {note && (
              <View style={styles.noteRow} accessibilityLiveRegion="polite">
                <Text style={styles.noteText}>{note.text}</Text>
                {note.suggestion && (
                  <TouchableOpacity
                    testID="icon_pick_suggestion"
                    style={styles.suggestBtn}
                    onPress={() => { onPick(note.suggestion!); onClose(); }}
                    accessibilityRole="button"
                    accessibilityLabel={`خد ${note.suggestion} بدالها`}>
                    <Text style={styles.suggestText}>خد {note.suggestion} بدالها</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {typing ? (
              <View style={styles.typingBox}>
                <TextInput
                  testID="icon_keyboard_input"
                  style={styles.emojiInput}
                  value={raw}
                  onChangeText={setRaw}
                  autoFocus
                  placeholder="😊"
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  textAlign="center"
                  accessibilityLabel={ICON_PICKER_KEYBOARD_LABEL}
                />
                {parsed.ok ? (
                  <View style={styles.previewRow}>
                    <Text style={styles.previewIcon} accessibilityLabel={`المعاينة ${parsed.icon}`}>{parsed.icon}</Text>
                    {parsed.trimmed && <Text style={styles.subtle}>{EMOJI_INPUT_TRIMMED}</Text>}
                  </View>
                ) : parsed.reason === 'empty' ? (
                  <Text style={styles.subtle}>{ICON_PICKER_KEYBOARD_HINT}</Text>
                ) : (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">{EMOJI_INPUT_MESSAGES[parsed.reason]}</Text>
                )}
              </View>
            ) : (
              <View style={styles.grid}>
                <TouchableOpacity
                  testID="icon_pick_default"
                  onPress={() => pick(undefined)}
                  accessibilityRole="button"
                  accessibilityLabel={ICON_PICKER_DEFAULT_LABEL}
                  accessibilityState={{ selected: !current }}
                  style={[styles.cell, styles.wideCell, selectionStyle(colors, !current)]}>
                  <Text style={styles.icon}>{DEFAULT_CATEGORY_ICON}</Text>
                  <Text style={styles.wideLabel}>{ICON_PICKER_DEFAULT_LABEL}</Text>
                </TouchableOpacity>

                {CATEGORY_ICONS.map(ic => (
                  <TouchableOpacity
                    key={ic}
                    testID={`icon_pick_${ic}`}
                    onPress={() => pick(ic)}
                    accessibilityRole="button"
                    // اسم الإيموجي من النظام مش ثابت بين أجهزة أندرويد، والمركّب ممكن يتقري غلط
                    accessibilityLabel={`أيقونة ${ic}`}
                    accessibilityState={{ selected: current === ic }}
                    style={[styles.cell, selectionStyle(colors, current === ic)]}>
                    <Text style={styles.icon}>{ic}</Text>
                  </TouchableOpacity>
                ))}

                {/* الأيقونة من الكيبورد: لو المختارة مش في القايمة بتبان هنا */}
                <TouchableOpacity
                  testID="icon_pick_keyboard"
                  onPress={() => { setNote(null); setTyping(true); }}
                  accessibilityRole="button"
                  accessibilityLabel={current && !CATEGORY_ICONS.includes(current)
                    ? `${ICON_PICKER_KEYBOARD_LABEL} — الحالية ${current}`
                    : ICON_PICKER_KEYBOARD_LABEL}
                  accessibilityState={{ selected: !!current && !CATEGORY_ICONS.includes(current) }}
                  style={[
                    styles.cell, styles.wideCell,
                    selectionStyle(colors, !!current && !CATEGORY_ICONS.includes(current)),
                  ]}>
                  <Text style={styles.icon}>{current && !CATEGORY_ICONS.includes(current) ? current : '⌨️'}</Text>
                  <Text style={styles.wideLabel}>{ICON_PICKER_KEYBOARD_LABEL}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {typing ? (
              <>
                <TouchableOpacity testID="icon_keyboard_back" accessibilityRole="button" style={styles.closeBtn} onPress={() => { setTyping(false); setRaw(''); }}>
                  <Text style={{ color: colors.textSecondary }}>رجوع</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="icon_keyboard_save"
                  accessibilityRole="button"
                  style={[styles.saveBtn, !parsed.ok && styles.saveBtnOff]}
                  disabled={!parsed.ok}
                  onPress={() => { if (parsed.ok) pick(parsed.icon); }}
                  accessibilityState={{ disabled: !parsed.ok }}>
                  <Text style={{ color: colors.onAccent, fontWeight: '700' }}>حفظ</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity testID="icon_pick_close" accessibilityRole="button" style={styles.closeBtn} onPress={onClose}>
                <Text style={{ color: colors.textSecondary }}>تمام</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '80%' }), padding: 0, overflow: 'hidden' },
    scrollArea: { flexShrink: 1 },
    sheetContent: { padding: space.xxxl },
    title: sheetTitleStyle(c, 4),
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs, marginBottom: space.xl, lineHeight: 17 },
    noteRow: {
      flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: space.sm,
      backgroundColor: c.surface2, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, marginBottom: space.xl,
    },
    noteText: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', flexShrink: 1 },
    suggestBtn: {
      minHeight: MIN_TOUCH, paddingHorizontal: space.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: c.borderStrong,
      alignItems: 'center', justifyContent: 'center',
    },
    suggestText: { color: c.text, fontSize: typeScale.body, fontWeight: '600' },
    grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.md },
    cell: {
      width: 56, height: 56, borderWidth: 1.5, borderRadius: radius.lg,
      alignItems: 'center', justifyContent: 'center',
    },
    wideCell: { width: '100%', height: 52, flexDirection: 'row-reverse', gap: space.sm },
    wideLabel: { color: c.textSecondary, fontSize: typeScale.body },
    icon: { fontSize: CATEGORY_GLYPH_SIZE },
    typingBox: { alignItems: 'center', gap: space.lg },
    emojiInput: {
      width: 96, height: 72, borderWidth: 1.5, borderColor: c.borderStrong, borderRadius: radius.lg,
      fontSize: CATEGORY_INPUT_SIZE, color: c.text, backgroundColor: c.surface2,
    },
    previewRow: { alignItems: 'center', gap: space.xxs },
    previewIcon: { fontSize: CATEGORY_PREVIEW_SIZE },
    subtle: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'center' },
    errorText: { color: c.dangerText, fontSize: typeScale.body, textAlign: 'center', lineHeight: 18 },
    footer: stickyFooterStyle(c, c.nav),
    closeBtn: {
      flex: 1, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
    },
    saveBtn: {
      flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.md, backgroundColor: c.accent,
      alignItems: 'center', justifyContent: 'center',
    },
    saveBtnOff: { opacity: 0.45 },
  });
}
