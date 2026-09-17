import Constants from 'expo-constants';

/** رقم الإصدار من app.json — مصدر واحد، مش رقم مكتوب بالإيد بيقدم */
export const APP_VERSION = Constants.expoConfig?.version ?? '—';
