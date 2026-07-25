import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];
function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export default function SettingsScreen() {
  const { user, logOut } = useAuth();
  const { wallets, categories, addWallet, updateWallet, deleteWallet, addCategory, deleteCategory } = useData();
  const [newWallet, setNewWallet] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [openingDrafts, setOpeningDrafts] = useState<Record<string, string>>({});
  const [alertDrafts, setAlertDrafts] = useState<Record<string, string>>({});

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>الإعدادات</Text>
      <Text style={styles.email}>{user?.email}</Text>

      <Text style={styles.sectionTitle}>المحافظ</Text>
      {wallets.map(w => (
        <View key={w.id} style={styles.walletCard}>
          <View style={styles.walletHead}>
            <View style={[styles.dot, { backgroundColor: hashColor(w.name) }]} />
            <Text style={styles.walletName}>{w.name}</Text>
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
        <TextInput style={styles.addInput} placeholder="اسم محفظة جديدة" placeholderTextColor="#6B7280"
          value={newWallet} onChangeText={setNewWallet} textAlign="right" />
        <TouchableOpacity style={styles.addBtn} onPress={() => { if (newWallet.trim()) { addWallet(newWallet.trim()); setNewWallet(''); } }}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>الفئات</Text>
      {categories.map(c => (
        <View key={c.id} style={styles.catRow}>
          <View style={[styles.dot, { backgroundColor: hashColor(c.name) }]} />
          <Text style={styles.catName}>{c.name}</Text>
          <TouchableOpacity onPress={() => confirmDeleteCategory(c.id, c.name)}>
            <Text style={styles.deleteText}>حذف</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={styles.addRow}>
        <TextInput style={styles.addInput} placeholder="فئة جديدة" placeholderTextColor="#6B7280"
          value={newCategory} onChangeText={setNewCategory} textAlign="right" />
        <TouchableOpacity style={styles.addBtn} onPress={() => { if (newCategory.trim()) { addCategory(newCategory.trim()); setNewCategory(''); } }}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
        <Text style={styles.logoutText}>تسجيل الخروج</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  content: { padding: 16, paddingBottom: 60 },
  title: { color: '#EDEBE6', fontSize: 18, fontWeight: '700', textAlign: 'right' },
  email: { color: '#8B92A0', fontSize: 12, textAlign: 'right', marginBottom: 18 },
  sectionTitle: { color: '#EDEBE6', fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 10, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  walletCard: { backgroundColor: '#15181D', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#1C2027' },
  walletHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 },
  walletName: { flex: 1, color: '#EDEBE6', fontSize: 14, fontWeight: '500', textAlign: 'right' },
  walletRow: { flexDirection: 'row-reverse', gap: 10 },
  microLabel: { color: '#5C6169', fontSize: 10.5, textAlign: 'right', marginBottom: 3 },
  smallInput: { backgroundColor: '#1C2027', borderWidth: 1, borderColor: '#262B33', borderRadius: 8, color: '#EDEBE6', paddingHorizontal: 10, paddingVertical: 7, fontSize: 12.5 },
  catRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#1C2027' },
  catName: { flex: 1, color: '#EDEBE6', fontSize: 13.5, textAlign: 'right' },
  deleteText: { color: '#D97878', fontSize: 12.5 },
  addRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10, marginBottom: 6, alignItems: 'center' },
  addInput: { flex: 1, backgroundColor: '#1C2027', borderWidth: 1, borderColor: '#262B33', borderRadius: 10, color: '#EDEBE6', paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
  addBtn: { backgroundColor: '#C9A961', borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#0B0D10', fontSize: 20, fontWeight: '700' },
  logoutBtn: { borderWidth: 1, borderColor: '#5A3030', borderRadius: 10, alignItems: 'center', paddingVertical: 12, marginTop: 30 },
  logoutText: { color: '#D97878', fontSize: 14, fontWeight: '600' },
});