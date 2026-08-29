import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, limit, writeBatch, updateDoc, Timestamp, orderBy, startAfter } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCEdawdZltGy6B0HvUrmluivl1YbhwawTM",
  authDomain: "student-care-crm-v2.firebaseapp.com",
  projectId: "student-care-crm-v2",
  storageBucket: "student-care-crm-v2.firebasestorage.app",
  messagingSenderId: "385197229013",
  appId: "1:385197229013:web:9eb888b4b7197b1f9f735c",
  measurementId: "G-NKQPBYWDCN"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
// Yêu cầu lấy email
provider.addScope('email');

export { app, db, auth, provider, signInWithPopup, onAuthStateChanged, signOut, collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, limit, writeBatch, updateDoc, Timestamp, orderBy, startAfter };
