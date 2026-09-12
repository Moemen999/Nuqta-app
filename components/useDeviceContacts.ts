import { makeContactEntry, type ContactEntry } from '@/lib/contacts';
import * as Contacts from 'expo-contacts';
import { useState } from 'react';
import { Alert } from 'react-native';

/**
 * تحميل جهات الاتصال من الموبايل وفتح شاشة الاختيار.
 *
 * متحطّة في هوك مشترك عشان فورم "دين جديد" وفورم "تعديل الدين" يستخدموا نفس
 * الكود — طلب الصلاحية وقراءة الحقول والتعامل مع الأسماء العربية الناقصة
 * حاجات مش المفروض تتكرر في مكانين.
 *
 * منطق الفلترة والتطبيع سايب في lib/contacts.ts عشان يفضل قابل للاختبار من
 * غير ما نحتاج نقلّد expo-contacts.
 */
export function useDeviceContacts() {
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [visible, setVisible] = useState(false);

  async function open() {
    try {
      // لازم نطلب الصلاحية صراحةً الأول — من غير كده النظام بيقفل التطبيق
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('محتاج إذن', 'عشان تختار من جهات الاتصال، لازم تسمح للتطبيق يوصلها من إعدادات الموبايل.');
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.PhoneNumbers,
        ],
      });
      // بعض الأجهزة بترجّع name فاضي للأسماء العربية، فبنركّب الاسم من الحقول التانية كبديل.
      // وبناخد كل أرقام الشخص مش الأول بس، عشان البحث بالرقم يلاقيه برقم الشغل كمان.
      const named = (data || [])
        .map(x => {
          const composed = [x.firstName, x.lastName].filter(Boolean).join(' ').trim();
          const finalName = (x.name && x.name.trim()) || composed;
          const phones = (x.phoneNumbers || []).map(p => p.number || '');
          return makeContactEntry(x.id || String(Math.random()), finalName, phones);
        })
        .filter(x => x.name);
      if (named.length === 0) {
        Alert.alert('مفيش جهات اتصال', 'ملقيتش أسماء محفوظة على الموبايل.');
        return;
      }
      // ترتيب أبجدي بيتعامل مع العربي والإنجليزي مع بعض
      named.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      setContacts(named);
      setVisible(true);
    } catch (e: any) {
      Alert.alert('حصل خطأ', String(e?.message || 'مقدرش أفتح جهات الاتصال دلوقتي'));
    }
  }

  function close() {
    setVisible(false);
  }

  return { contacts, visible, open, close };
}
