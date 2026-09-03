import { useAppLock } from '@/context/AppLockContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Mode = 'enable' | 'change' | 'disable';

export default function SetLockModal({ visible, mode, onClose }: { visible: boolean; mode: Mode; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { lockType: currentType, setupLock, changeCode, disableLock } = useAppLock();

  const [type, setType] = useState<'pin' | 'password'>('pin');
  const [oldCode, setOldCode] = useState('');
  const [code1, setCode1] = useState('');
  const [code2, setCode2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setType('pin'); setOldCode(''); setCode1(''); setCode2(''); setError('');
  }

  async function handleSubmit() {
    setError('');
    if (mode === 'disable') {
      if (!oldCode) { setError('دخّل الباسورد/الرقم الحالي'); return; }
      setBusy(true);
      const ok = await disableLock(oldCode);
      setBusy(false);
      if (!ok) { setError('غلط، جرب تاني'); return; }
      reset(); onClose();
      return;
    }
    if (mode === 'change' && !oldCode) { setError('دخّل الباسورد/الرقم القديم'); return; }
    if (!code1 || code1 !== code2) { setError('الكود الجديد مش متطابق في الحقلين'); return; }
    if (type === 'pin' && code1.length !== 4) { setError('الرقم السري لازم 4 أرقام بالظبط'); return; }
    if (type === 'password' && code1.length < 4) { setError('الباسورد لازم 4 حروف على الأقل'); return; }

    setBusy(true);
    let ok = true;
    if (mode === 'enable') {
      await setupLock(type, code1);
    } else {
      ok = await changeCode(oldCode, code1, type);
    }
    setBusy(false);
    if (!ok) { setError('الكود القديم غلط'); return; }
    reset();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {mode === 'enable' ? 'تفعيل القفل' : mode === 'change' ? 'تغيير الباسورد' : 'إلغاء القفل'}
          </Text>

          {mode !== 'enable' && (
            <>
              <Text style={styles.label}>{currentType === 'pin' ? 'الرقم السري الحالي' : 'الباسورد الحالي'}</Text>
              <TextInput style={styles.input} value={oldCode} onChangeText={setOldCode}
                secureTextEntry keyboardType={currentType === 'pin' ? 'numeric' : 'default'}
                placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          {mode !== 'disable' && (
            <>
              <Text style={styles.label}>نوع القفل</Text>
              <View style={styles.row}>
                <TouchableOpacity onPress={() => setType('pin')} style={[styles.typeBtn, { borderColor: type === 'pin' ? colors.accent : colors.borderStrong }]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>رقم سري (4 أرقام)</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setType('password')} style={[styles.typeBtn, { borderColor: type === 'password' ? colors.accent : colors.borderStrong }]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>باسورد نصي</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>{type === 'pin' ? 'الرقم السري الجديد' : 'الباسورد الجديد'}</Text>
              <TextInput style={styles.input} value={code1} onChangeText={setCode1}
                secureTextEntry keyboardType={type === 'pin' ? 'numeric' : 'default'}
                maxLength={type === 'pin' ? 4 : undefined}
                placeholderTextColor={colors.textSecondary} textAlign="right" />

              <Text style={styles.label}>تأكيد {type === 'pin' ? 'الرقم' : 'الباسورد'}</Text>
              <TextInput style={styles.input} value={code2} onChangeText={setCode2}
                secureTextEntry keyboardType={type === 'pin' ? 'numeric' : 'default'}
                maxLength={type === 'pin' ? 4 : undefined}
                placeholderTextColor={colors.textSecondary} textAlign="right" />
            </>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { reset(); onClose(); }}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSubmit} disabled={busy}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : 'تأكيد'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.nav, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
    title: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 12, marginBottom: 6 },
    input: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, padding: 12, fontSize: 15 },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    error: { color: c.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },
    actions: { flexDirection: 'row-reverse', gap: 10, marginTop: 20, marginBottom: 6 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  });
}