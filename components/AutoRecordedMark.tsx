import MutedMark from '@/components/MutedMark';

/**
 * علامة جنب تاريخ العملية معناها إنها **اتسجلت لوحدها** (دخل ثابت أو اشتراك أو
 * قسط جمعية "تلقائي") — عشان المستخدم يفرّقها عن اللي سجّله بإيده ويراجع
 * رقمها. نفس هدوء "لسه بترفع": مش خطأ ومش مطلوب منه حاجة، والرقم يفضل
 * هو الأوضح في الصف.
 */
export default function AutoRecordedMark() {
  return <MutedMark icon="repeat-outline" text="اتسجلت لوحدها" label="اتسجلت لوحدها" />;
}
