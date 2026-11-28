import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, overlayStyle, sheetStyle, space, typeScale, radius } from '@/lib/tokens';
import { filterContacts, normalizePhone, phoneForDisplay, type ContactEntry } from '@/lib/contacts';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { contactsPhrase, resultsPhrase } from '@/lib/archiving';
import { PressableScale } from '@/components/PressableScale';

/**
 * أقل ارتفاع للصف (مش ثابت): الخط الكبير من إعدادات النظام بيطوّل الصف، فارتفاع ثابت كان بيقص الاسم والرقم.
 * من غير getItemLayout FlatList بتقيس الصفوف لوحدها — أمان أكتر من تمرير بيقفز على الخط الكبير.
 */
const ROW_MIN_HEIGHT = 62;

const ContactRow = memo(function ContactRow({
  contact, styles, onPick,
}: {
  contact: ContactEntry;
  styles: ReturnType<typeof makeStyles>;
  onPick: (c: ContactEntry) => void;
}) {
  return (
    <PressableScale accessibilityRole="button" style={styles.contactRow} onPress={() => onPick(contact)}
      accessibilityLabel={`${contact.name}، ${contact.phone ? phoneForDisplay(contact.phone) : 'مفيش رقم محفوظ'}`}>
      <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
      <Text style={styles.contactPhone} numberOfLines={1}>{contact.phone ? phoneForDisplay(contact.phone) : 'مفيش رقم محفوظ'}</Text>
    </PressableScale>
  );
});

/**
 * اختيار شخص من جهات الاتصال.
 *
 * الليست كانت ScrollView بترسم كل جهات الاتصال مرة واحدة، وبتعيد رسمها كلها
 * مع كل حرف في البحث — عشان كده كانت بتقّل على الموبايلات اللي فيها ألف جهة
 * اتصال. بقت FlatList بترسم اللي باين على الشاشة بس، والبحث بقى في كومبوننت
 * لوحده عشان الكتابة فيه مترجّعش رسم فورم "دين جديد" كله من الأول.
 */
export default function ContactPickerModal({
  visible, contacts, onClose, onPick, onCreateContact,
}: {
  visible: boolean;
  contacts: ContactEntry[];
  onClose: () => void;
  onPick: (c: ContactEntry) => void;
  /** بيتنادى بس لما البحث ميجبش نتيجة — بيفتح شاشة النظام لإضافة جهة اتصال */
  onCreateContact?: (prefill: { name: string; phone: string }) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [search, setSearch] = useState('');

  // الكتابة بتفضل سريعة، والفلترة بتلحق بعدها بجزء من الثانية
  const deferredSearch = useDeferredValue(search);
  const results = useMemo(() => filterContacts(contacts, deferredSearch), [contacts, deferredSearch]);

  function close() {
    setSearch('');
    onClose();
  }

  function handlePick(c: ContactEntry) {
    setSearch('');
    onPick(c);
  }

  const searching = deferredSearch.trim().length > 0;
  const query = deferredSearch.trim();
  // اللي المستخدم كتبه ممكن يكون اسم وممكن يكون رقم — بنحط كل واحد في مكانه
  const queryIsPhone = normalizePhone(query).length >= 6;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* مودال جوه مودال — الكيبورد بتاعه مستقل، فمحتاج KeyboardAvoidingView
          خاص بيه. من غيره الكيبورد كانت بتغطي نتايج البحث. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet} accessibilityViewIsModal>
          {/* كان مفيش أي طريقة باينة للرجوع من غير زرار في آخر الليست —
              زرار الرجوع الظاهر من فوق بقى موجود جنب العنوان */}
          <View style={styles.headerRow}>
            <Text style={styles.sheetTitle} accessibilityRole="header">اختار من جهات الاتصال</Text>
            <PressableScale
              onPress={close}
              style={styles.closeBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="إغلاق">
              <Text style={styles.closeBtnText} importantForAccessibility="no">✕ إغلاق</Text>
            </PressableScale>
          </View>
          <TextInput
            accessibilityLabel="دور بالاسم أو الرقم"
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="دور بالاسم أو الرقم..."
            placeholderTextColor={colors.textSecondary}
            textAlign="right"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <Text style={styles.contactCount} accessibilityLiveRegion="polite">
            {searching ? `${resultsPhrase(results.length)} من ${contacts.length}` : contactsPhrase(contacts.length)}
          </Text>
          <FlatList
            style={styles.list}
            data={results}
            keyExtractor={item => item.id}
            renderItem={({ item }) => <ContactRow contact={item} styles={styles} onPick={handlePick} />}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <View>
                <Text style={styles.emptyState}>مفيش جهة اتصال بالاسم أو الرقم ده</Text>
                {/* الإضافة بتتعرض هنا بس — عند اللحظة اللي المستخدم دوّر فيها وملقاش */}
                {!!onCreateContact && !!query && (
                  <PressableScale accessibilityRole="button"
                    style={styles.createBtn}
                    onPress={() => onCreateContact(
                      queryIsPhone ? { name: '', phone: query } : { name: query, phone: '' }
                    )}>
                    <Text style={styles.createBtnText}>
                      {queryIsPhone ? `ضيف الرقم ده لجهات الاتصال` : `ضيف «${query}» لجهات الاتصال`}
                    </Text>
                    <Text style={styles.createBtnHint}>هتتفتح شاشة الموبايل وإنت اللي بتحفظ</Text>
                  </PressableScale>
                )}
              </View>
            }
          />
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: sheetStyle(c, { height: '80%' }),
    headerRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
    sheetTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right' },
    closeBtn: {
      minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xl,
      borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, backgroundColor: c.surface2,
    },
    closeBtnText: { color: c.textSecondary, fontSize: typeScale.body, fontWeight: '700' },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, fontSize: typeScale.body, paddingHorizontal: space.xl, paddingVertical: space.md },
    contactCount: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.sm },
    list: { flex: 1, marginTop: space.xs },
    contactRow: { minHeight: ROW_MIN_HEIGHT, paddingVertical: space.xs, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: c.border },
    contactName: { color: c.text, fontSize: typeScale.body, textAlign: 'right' },
    contactPhone: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginTop: 2 },
    emptyState: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', paddingVertical: space.huge },
    createBtn: {
      minHeight: MIN_TOUCH, justifyContent: 'center', alignItems: 'center',
      borderWidth: 1.5, borderColor: c.accent, borderRadius: radius.md,
      backgroundColor: c.surface2, paddingHorizontal: space.xl, paddingVertical: space.md,
    },
    createBtnText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700', textAlign: 'center' },
    createBtnHint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'center', marginTop: 3 },
  });
}
