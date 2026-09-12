import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { overlayStyle, sheetStyle } from '@/lib/tokens';
import { filterContacts, phoneForDisplay, type ContactEntry } from '@/lib/contacts';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

/**
 * ارتفاع ثابت للصف عشان نقدر نستخدم getItemLayout — من غيره FlatList
 * بتقيس كل صف لوحدها والتمرير بيهزّ مع الليستات الكبيرة.
 */
const ROW_HEIGHT = 62;

const ContactRow = memo(function ContactRow({
  contact, styles, onPick,
}: {
  contact: ContactEntry;
  styles: ReturnType<typeof makeStyles>;
  onPick: (c: ContactEntry) => void;
}) {
  return (
    <TouchableOpacity style={styles.contactRow} onPress={() => onPick(contact)}>
      <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
      <Text style={styles.contactPhone} numberOfLines={1}>{contact.phone ? phoneForDisplay(contact.phone) : 'مفيش رقم محفوظ'}</Text>
    </TouchableOpacity>
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
  visible, contacts, onClose, onPick,
}: {
  visible: boolean;
  contacts: ContactEntry[];
  onClose: () => void;
  onPick: (c: ContactEntry) => void;
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* مودال جوه مودال — الكيبورد بتاعه مستقل، فمحتاج KeyboardAvoidingView
          خاص بيه. من غيره الكيبورد كانت بتغطي نتايج البحث. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* كان مفيش أي طريقة باينة للرجوع من غير زرار في آخر الليست —
              زرار الرجوع الظاهر من فوق بقى موجود جنب العنوان */}
          <View style={styles.headerRow}>
            <Text style={styles.sheetTitle}>اختار من جهات الاتصال</Text>
            <TouchableOpacity
              onPress={close}
              style={styles.closeBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="إغلاق جهات الاتصال">
              <Text style={styles.closeBtnText}>✕ إغلاق</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="دور بالاسم أو الرقم..."
            placeholderTextColor={colors.textSecondary}
            textAlign="right"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <Text style={styles.contactCount}>
            {searching ? `${results.length} نتيجة من ${contacts.length}` : `${contacts.length} جهة اتصال`}
          </Text>
          <FlatList
            style={styles.list}
            data={results}
            keyExtractor={item => item.id}
            renderItem={({ item }) => <ContactRow contact={item} styles={styles} onPick={handlePick} />}
            getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={<Text style={styles.emptyState}>مفيش جهة اتصال بالاسم أو الرقم ده</Text>}
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
    headerRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    sheetTitle: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right' },
    closeBtn: {
      minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
      borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, backgroundColor: c.surface2,
    },
    closeBtnText: { color: c.textSecondary, fontSize: 12.5, fontWeight: '700' },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    contactCount: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginTop: 8 },
    list: { flex: 1, marginTop: 6 },
    contactRow: { height: ROW_HEIGHT, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: c.border },
    contactName: { color: c.text, fontSize: 14, textAlign: 'right' },
    contactPhone: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  });
}
