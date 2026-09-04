import SetLockModal from '@/components/SetLockModal';
import { useAppLock } from '@/context/AppLockContext';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];
function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, theme, setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, logOut } = useAuth();
  const { enabled: lockEnabled, lockType, frequency, setFrequency, graceMinutes, setGraceMinutes } = useAppLock();
  const {
    wallets, categories,
    addWallet, updateWallet, deleteWallet,
    addCategory, updateCategory, deleteCategory,
  } = useData();
  const [newWallet, setNewWallet] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [openingDrafts, setOpeningDrafts] = useState<Record<string, string>>({});
  const [alertDrafts, setAlertDrafts] = useState<Record<string, string>>({});
  const [lockModalMode, setLockModalMode] = useState<'enable' | 'change' | 'disable' | null>(null);

  function confirmDeleteWallet(id: string, name: string) {
    Alert.alert('حذف محفظة', `متأكد إنك عايز تمسح "${name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => deleteWallet(id) },
    ]);
  }
  function confirmDeleteCategory(id: string, name: string) {
    Alert.alert('حذف فئة', `متأكد إنك عايز تمسح "${name}"؟`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => deleteCategory(id) },
    ]);
  }
  function confirmLogout() {
    Alert.alert('تسجيل الخروج', 'متأكد إنك عايز تخرج من حسابك؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'خروج', style: 'destructive', onPress: () => logOut() },
    ]);
  }

  function walletNameValue(id: string, current: string) {
    return nameDrafts[`w_${id}`] !== undefined ? nameDrafts[`w_${id}`] : current;
  }
  function saveWalletName(id: string) {
    const val = nameDrafts[`w_${id}`];
    if (val !== undefined && val.trim()) updateWallet(id, { name: val.trim() });
  }
  function catNameValue(id: string, current: string) {
    return nameDrafts[`c_${id}`] !== undefined ? nameDrafts[`c_${id}`] : current;
  }
  function saveCatName(id: string) {
    const val = nameDrafts[`c_${id}`];
    if (val !== undefined && val.trim()) updateCategory(id, { name: val.trim() });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>الإعدادات</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <TouchableOpacity style={styles.archiveBtn} onPress={() => router.push('/archive')}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>📄 أرشيف العمليات وتصدير إكسيل</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>الأمان</Text>
        {!lockEnabled ? (
          <TouchableOpacity style={styles.securityBtn} onPress={() => setLockModalMode('enable')}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>🔒 تفعيل قفل التطبيق</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.securityCard}>
            <Text style={styles.securityStatus}>
              القفل مفعّل ({lockType === 'pin' ? 'رقم سري' : 'باسورد نصي'})
            </Text>
            <Text style={styles.hint}>يطلب الباسورد إمتى؟</Text>
            <View style={styles.row}>
              <TouchableOpacity onPress={() => setFrequency('onOpen')}
                style={[styles.typeBtn, { borderColor: frequency === 'onOpen' ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>مرة واحدة (فتح التطبيق)</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setFrequency('everyResume')}
                style={[styles.typeBtn, { borderColor: frequency === 'everyResume' ? colors.accent : colors.borderStrong }]}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>كل مرة ترجع للتطبيق</Text>
              </TouchableOpacity>
            </View>

            {frequency === 'everyResume' && (
              <>
                <Text style={[styles.hint, { marginTop: 14 }]}>يقفل بعد قد إيه من خروجك من التطبيق؟</Text>
                <View style={styles.row}>
                  {[
                    { m: 0, label: 'فورًا' },
                    { m: 1, label: 'بعد دقيقة' },
                    { m: 5, label: 'بعد 5 دقايق' },
                    { m: 15, label: 'بعد 15 دقيقة' },
                  ].map(opt => (
                    <TouchableOpacity key={opt.m} onPress={() => setGraceMinutes(opt.m)}
                      style={[styles.graceBtn, { borderColor: graceMinutes === opt.m ? colors.accent : colors.borderStrong }]}>
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={[styles.row, { marginTop: 14 }]}>
              <TouchableOpacity style={styles.changeBtn} onPress={() => setLockModalMode('change')}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>تغيير الباسورد</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.disableBtn} onPress={() => setLockModalMode('disable')}>
                <Text style={{ color: colors.danger, fontSize: 12.5 }}>إلغاء القفل</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>الشكل</Text>
        <View style={styles.themeRow}>
          <TouchableOpacity
            onPress={() => setTheme('dark')}
            style={[styles.themeBtn, { borderColor: theme === 'dark' ? colors.accent : colors.borderStrong }]}>
            <Text style={{ color: theme === 'dark' ? colors.text : colors.textSecondary, fontSize: 13.5 }}>داكن</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTheme('light')}
            style={[styles.themeBtn, { borderColor: theme === 'light' ? colors.accent : colors.borderStrong }]}>
            <Text style={{ color: theme === 'light' ? colors.text : colors.textSecondary, fontSize: 13.5 }}>فاتح</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>المحافظ</Text>
        <Text style={styles.hint}>تقدر تدوس على اسم المحفظة تعدله مباشرة</Text>
        {wallets.map(w => (
          <View key={w.id} style={styles.walletCard}>
            <View style={styles.walletHead}>
              <View style={[styles.dot, { backgroundColor: hashColor(w.name) }]} />
              <TextInput
                style={styles.nameInput}
                value={walletNameValue(w.id, w.name)}
                onChangeText={v => setNameDrafts(d => ({ ...d, [`w_${w.id}`]: v }))}
                onBlur={() => saveWalletName(w.id)}
                textAlign="right"
              />
              <TouchableOpacity onPress={() => confirmDeleteWallet(w.id, w.name)}>
                <Text style={styles.deleteText}>حذف</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.walletRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel}>الرصيد الابتدائي</Text>
                <TextInput
                  style={styles.smallInput}
                  keyboardType="numeric"
                  value={openingDrafts[w.id] !== undefined ? openingDrafts[w.id] : String(w.openingBalance || '')}
                  onChangeText={v => setOpeningDrafts(d => ({ ...d, [w.id]: v }))}
                  onBlur={() => updateWallet(w.id, { openingBalance: Number(openingDrafts[w.id]) || 0 })}
                  textAlign="right"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel}>حد التنبيه</Text>
                <TextInput
                  style={styles.smallInput}
                  keyboardType="numeric"
                  value={alertDrafts[w.id] !== undefined ? alertDrafts[w.id] : String(w.lowAlert || '')}
                  onChangeText={v => setAlertDrafts(d => ({ ...d, [w.id]: v }))}
                  onBlur={() => updateWallet(w.id, { lowAlert: Number(alertDrafts[w.id]) || 0 })}
                  textAlign="right"
                />
              </View>
            </View>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput style={styles.addInput} placeholder="اسم محفظة جديدة" placeholderTextColor={colors.textSecondary}
            value={newWallet} onChangeText={setNewWallet} textAlign="right" />
          <TouchableOpacity style={styles.addBtn} onPress={() => { if (newWallet.trim()) { addWallet(newWallet.trim()); setNewWallet(''); } }}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>الفئات</Text>
        <Text style={styles.hint}>تقدر تدوس على اسم الفئة تعدله مباشرة</Text>
        {categories.map(c => (
          <View key={c.id} style={styles.catRow}>
            <View style={[styles.dot, { backgroundColor: hashColor(c.name) }]} />
            <TextInput
              style={styles.nameInput}
              value={catNameValue(c.id, c.name)}
              onChangeText={v => setNameDrafts(d => ({ ...d, [`c_${c.id}`]: v }))}
              onBlur={() => saveCatName(c.id)}
              textAlign="right"
            />
            <TouchableOpacity onPress={() => confirmDeleteCategory(c.id, c.name)}>
              <Text style={styles.deleteText}>حذف</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput style={styles.addInput} placeholder="فئة جديدة" placeholderTextColor={colors.textSecondary}
            value={newCategory} onChangeText={setNewCategory} textAlign="right" />
          <TouchableOpacity style={styles.addBtn} onPress={() => { if (newCategory.trim()) { addCategory(newCategory.trim()); setNewCategory(''); } }}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
          <Text style={styles.logoutText}>تسجيل الخروج</Text>
        </TouchableOpacity>

        {lockModalMode && (
          <SetLockModal visible={!!lockModalMode} mode={lockModalMode} onClose={() => setLockModalMode(null)} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 60 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    email: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginBottom: 18 },
    archiveBtn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 13, marginBottom: 10 },
    securityBtn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 13 },
    securityCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
    securityStatus: { color: c.success, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    graceBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 9 },
    changeBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    disableBtn: { flex: 1, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 20, marginBottom: 4 },
    hint: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginBottom: 10 },
    themeRow: { flexDirection: 'row-reverse', gap: 10, marginBottom: 6 },
    themeBtn: { flex: 1, backgroundColor: c.surface, borderWidth: 1.5, borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    walletCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    walletHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 },
    nameInput: { flex: 1, color: c.text, fontSize: 14, fontWeight: '500', textAlign: 'right', paddingVertical: 2 },
    walletRow: { flexDirection: 'row-reverse', gap: 10 },
    microLabel: { color: c.textMuted, fontSize: 10.5, textAlign: 'right', marginBottom: 3 },
    smallInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, color: c.text, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12.5 },
    catRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.border },
    deleteText: { color: c.danger, fontSize: 12.5 },
    addRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10, marginBottom: 6, alignItems: 'center' },
    addInput: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { color: c.onAccent, fontSize: 20, fontWeight: '700' },
    logoutBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 12, marginTop: 30 },
    logoutText: { color: c.danger, fontSize: 14, fontWeight: '600' },
  });
}