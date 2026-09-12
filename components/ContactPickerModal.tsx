import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { filterContacts, type ContactEntry } from '@/lib/contacts';
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
      <Text style={styles.contactPhone} numberOfLines={1}>{contact.phone || 'مفيش رقم محفوظ'}</Text>
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
          <Text style={styles.sheetTitle}>اختار من جهات الاتصال</Text>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="دور بالاسم..."
            placeholderTextColor={colors.textSecondary}
            textAlign="right"
            autoCorrect={false}
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
            ListEmptyComponent={<Text style={styles.emptyState}>مفيش جهة اتصال بالاسم ده</Text>}
          />
          <TouchableOpacity style={styles.cancelBtn} onPress={close}>
            <Text style={{ color: colors.textSecondary }}>إغلاق</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.nav, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, height: '80%' },
    sheetTitle: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
    contactCount: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginTop: 8 },
    list: { flex: 1, marginTop: 6 },
    contactRow: { height: ROW_HEIGHT, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: c.border },
    contactName: { color: c.text, fontSize: 14, textAlign: 'right' },
    contactPhone: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 2 },
    emptyState: { color: c.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
    cancelBtn: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12, marginTop: 10 },
  });
}
