import BackButton from '@/components/BackButton';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import {
  FEEDBACK_FAILED, FEEDBACK_MAX_LENGTH, FEEDBACK_PENDING, FEEDBACK_PRIVACY_NOTE, FEEDBACK_SENT,
  FEEDBACK_TYPES, FEEDBACK_TYPE_LABEL, feedbackRemaining, feedbackRemainingLabel,
  feedbackTextValid, type FeedbackType,
} from '@/lib/feedback';
import { selectionStyle } from '@/lib/selection';
import { stickyFooterStyle } from '@/lib/tokens';
import { useBusy } from '@/lib/useBusy';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * "شاركنا رأيك".
 *
 * حاجتين مقصودين هنا:
 *
 * 1. **مبنقولش "اتبعت" غير لما يبقى اتبعت فعلاً.** القراية من مجموعة
 *    `feedback` ممنوعة من العميل (القواعد)، فمش هنعرف حال المستند من
 *    `onSnapshot` زي أي حاجة تانية — الطريق الوحيد هو وعد الكتابة، وهو
 *    مبيتحلش خالص وإحنا أوفلاين. فلو مفيش نت بنقول "هيتبعت أول ما النت
 *    يرجع"، وده الصح: الرأي في الطابور بجد.
 *
 * 2. **الضغط مرتين بيبعت مستند واحد.** `useBusy` بيقفل الزرار من أول
 *    ضغطة لحد ما الإجابة توصل.
 */
export default function FeedbackScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { submitFeedback } = useData();
  const { busy, run } = useBusy();

  const [type, setType] = useState<FeedbackType | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<string>('');

  const remaining = feedbackRemaining(text);
  const canSend = !!type && feedbackTextValid(text) && !busy;

  function handleSend() {
    if (!canSend || !type) return;
    setResult('');
    run(async () => {
      const outcome = await submitFeedback(type, text);
      if (outcome === 'failed') { setResult(FEEDBACK_FAILED); return; }
      setResult(outcome === 'sent' ? FEEDBACK_SENT : FEEDBACK_PENDING);
      setText('');
      setType(null);
    });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.headerRow}>
          <BackButton />
          <Text style={styles.title}>شاركنا رأيك</Text>
        </View>

        <Text style={styles.label}>الرأي ده عن إيه؟</Text>
        <View style={styles.chipRow}>
          {FEEDBACK_TYPES.map(t => (
            <TouchableOpacity
              key={t}
              testID={`feedback_type_${t}`}
              onPress={() => setType(t)}
              style={[styles.chip, selectionStyle(colors, type === t)]}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{FEEDBACK_TYPE_LABEL[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>اكتب اللي في بالك</Text>
        <TextInput
          testID="feedback_text_input"
          style={styles.textArea}
          value={text}
          onChangeText={v => setText(v.slice(0, FEEDBACK_MAX_LENGTH))}
          multiline
          textAlignVertical="top"
          maxLength={FEEDBACK_MAX_LENGTH}
          placeholder="اكتب هنا..."
          placeholderTextColor={colors.textSecondary}
          textAlign="right"
        />
        <Text style={[styles.counter, remaining === 0 && { color: colors.danger }]}>
          {feedbackRemainingLabel(text)}
        </Text>

        <Text style={styles.note}>{FEEDBACK_PRIVACY_NOTE}</Text>

        {!!result && <Text style={styles.result}>{result}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} disabled={busy}>
          <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="feedback_send_button"
          style={[styles.sendBtn, !canSend && styles.btnBusy]}
          disabled={!canSend}
          onPress={handleSend}>
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'ابعت'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors, bottomInset: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 24 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 8 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
    textArea: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 150 },
    counter: { color: c.textMuted, fontSize: 11.5, textAlign: 'left', marginTop: 6 },
    note: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 16, lineHeight: 17 },
    result: { color: c.success, fontSize: 13, textAlign: 'right', marginTop: 16, fontWeight: '700' },
    footer: stickyFooterStyle(c, c.nav, bottomInset),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    sendBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.5 },
  });
}
