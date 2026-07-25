import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAQnqfXUkV0KVSwPD31tX0SKCvHuh9km-I",
  authDomain: "nuqta-711f2.firebaseapp.com",
  projectId: "nuqta-711f2",
  storageBucket: "nuqta-711f2.firebasestorage.app",
  messagingSenderId: "662258111881",
  appId: "1:662258111881:web:b1479047020672eb27a3d58",
  measurementId: "G-PMFXQWY8W9"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);
