// public/firebase-config.js

const firebaseConfig = {
  apiKey: "AIzaSyA7ObtiHy7KEXeVR6WiXP8u-EjCM7voRGo",
  authDomain: "fitness-app-14.firebaseapp.com",
  projectId: "fitness-app-14",
  storageBucket: "fitness-app-14.firebasestorage.app",
  messagingSenderId: "172524299582",
  appId: "1:172524299582:web:cd2521bcf0f43fec33f86f",
  measurementId: "G-QKR6KXXCJ7"
};

// 1. Initialize Firebase (Check if already initialized)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// 2. Initialize Services
const db = firebase.firestore();
const auth = firebase.auth();

// 3. Expose to Window (CRITICAL for Dashboard)
// This replaces 'module.exports'
window.db = db;
window.auth = auth;

console.log("🔥 Firebase Initialized & Exposed to Window");