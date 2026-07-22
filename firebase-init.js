// Initialisation Firebase partagée par les pages du jeu (accueil, donjons,
// publier, membres). Mutualise la configuration, le mode émulateur, le compte
// administrateur, l'initialisation du SDK, la connexion Google et les messages
// d'erreur d'authentification. L'atelier (index.html) garde pour l'instant son
// propre amorçage (bootCloud, modes local/flat).
//
// Doit rester à la racine du dépôt : les pages l'importent en "./firebase-init.js"
// et le SDK est chargé en "./firebasejs" (émulateur) ou depuis gstatic (prod),
// comme jeu.js. Le workflow de déploiement le copie dans _fire/.

export const EMU_MODE = location.hash.includes("emu");
const FIREBASE_SDK = EMU_MODE ? "./firebasejs" : "https://www.gstatic.com/firebasejs/12.8.0";
export const ADMIN_EMAIL = "nominesnow@gmail.com";

// Ce bloc identifie le projet Firebase ; il n'est pas secret, la protection
// vient des règles Firestore (l'auteur seul publie et modère ; chaque compte ne
// lit et n'écrit que ses données, sauf l'auteur).
export const firebaseConfig = {
  apiKey: "AIzaSyAqAt0KNZGDjIhP5wdlFSsHMnFXKl_pF8A",
  authDomain: "donjons-definitions.firebaseapp.com",
  projectId: "donjons-definitions",
  storageBucket: "donjons-definitions.firebasestorage.app",
  messagingSenderId: "1074510772699",
  appId: "1:1074510772699:web:4ba0fed2da7dc68d124ffe",
  measurementId: "G-QJNJ1N0JCY"
};

// Charge le SDK Firebase, initialise l'app, l'authentification et Firestore, et
// connecte les émulateurs en mode test. Renvoie { m, app, auth, db } où `m`
// regroupe tous les modules Firebase (doc, getDoc, setDoc, onAuthStateChanged…).
export async function initFirebase(){
  const [appM, authM, fsM] = await Promise.all([
    import(FIREBASE_SDK + "/firebase-app.js"),
    import(FIREBASE_SDK + "/firebase-auth.js"),
    import(FIREBASE_SDK + "/firebase-firestore.js")
  ]);
  const m = Object.assign({}, appM, authM, fsM);
  const cfg = EMU_MODE ? Object.assign({}, firebaseConfig, { projectId: "demo-donjons" }) : firebaseConfig;
  const app = m.initializeApp(cfg);
  const auth = m.getAuth(app);
  // Cache mémoire seul : la persistance multi-onglets fait planter les lectures
  // Firestore sur Safari.
  const db = m.initializeFirestore(app, {});
  if(EMU_MODE){
    m.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    m.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { m, app, auth, db };
}

// Connexion Google : fenêtre surgissante en production ; en test (#emu), on
// signe une identité simulée. `admin` fixe le rôle par défaut ; le hash peut le
// forcer (#emu-guest → simple joueur, #emu-admin → auteur), pour les tests.
export async function signInGoogle(auth, m, { admin = false } = {}){
  if(!EMU_MODE){ await m.signInWithPopup(auth, new m.GoogleAuthProvider()); return; }
  let asAdmin = admin;
  if(location.hash.includes("guest")) asAdmin = false;
  if(location.hash.includes("admin")) asAdmin = true;
  const cred = m.GoogleAuthProvider.credential(JSON.stringify({
    sub: asAdmin ? "admin-test" : "joueur-test",
    email: asAdmin ? ADMIN_EMAIL : "joueur@example.com",
    email_verified: true
  }));
  await m.signInWithCredential(auth, cred);
}

// Message d'erreur d'authentification lisible, en français, à partir de l'erreur
// Firebase (Google et e-mail/mot de passe).
export function authError(e){
  const code = (e && e.code) || "";
  if(code === "auth/popup-blocked") return "La fenêtre de connexion a été bloquée. Autorisez les fenêtres surgissantes pour ce site, puis réessayez.";
  if(code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Fenêtre refermée avant la fin de la connexion. Réessayez.";
  if(code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "Adresse e-mail ou mot de passe incorrect.";
  if(code === "auth/email-already-in-use") return "Un compte existe déjà avec cette adresse. Connectez-vous.";
  if(code === "auth/weak-password") return "Mot de passe trop court (6 caractères minimum).";
  if(code === "auth/invalid-email") return "Adresse e-mail invalide.";
  if(code === "auth/configuration-not-found" || code === "auth/operation-not-allowed") return "La connexion Google n'est pas activée dans la console Firebase.";
  if(code === "auth/unauthorized-domain") return "Ce domaine n'est pas autorisé dans la console Firebase (Authentication, Settings, Domaines autorisés).";
  return "Connexion impossible : " + (e && e.message ? e.message : e);
}
