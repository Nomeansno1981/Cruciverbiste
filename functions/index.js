// Cloud Functions — autorité serveur sur le classement.
//
// Pourquoi : jusqu'ici chaque joueur écrivait lui-même sa fiche
// `leaderboard/{uid}`. Les règles Firestore ne peuvent pas additionner les
// résultats d'un joueur pour recouper le total déclaré ; un joueur pouvait donc
// écrire un total arbitraire depuis la console. Désormais le serveur (ces
// fonctions, qui tournent avec les droits admin et contournent les règles)
// recalcule le total à partir des résultats et est le seul à écrire le
// classement. Les règles interdisent l'écriture de /leaderboard côté joueur.
//
// Source de vérité : users/{uid}/results/{date} = { xp, date, ... }.
// Le classement dérive : total = somme des xp ; months[YYYY-MM] = somme du mois.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

// Compte de l'auteur (même valeur que estAdmin() dans firestore.rules).
const ADMIN_EMAIL = "nominesnow@gmail.com";

// Recalcule (ou retire) la fiche de classement d'un joueur à partir de ses
// résultats. Idempotent : peut être rappelé autant de fois que voulu.
async function refreshLeaderboard(uid) {
  // Un membre suspendu (fiche /banned) ne figure jamais au classement public.
  const banned = await db.doc(`banned/${uid}`).get();
  if (banned.exists) {
    await db.doc(`leaderboard/${uid}`).delete().catch(() => {});
    return { uid, removed: true, reason: "suspendu" };
  }

  const snap = await db.collection(`users/${uid}/results`).get();
  let total = 0;
  const months = {};
  snap.forEach((ds) => {
    const d = ds.data() || {};
    if (typeof d.xp !== "number" || !isFinite(d.xp)) return;
    const xp = Math.max(0, Math.round(d.xp));
    total += xp;
    const mk = String(d.date || ds.id || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mk)) months[mk] = (months[mk] || 0) + xp;
  });

  // Pas de score positif : on ne laisse pas de fiche vide au classement.
  if (total <= 0) {
    await db.doc(`leaderboard/${uid}`).delete().catch(() => {});
    return { uid, removed: true, reason: "total nul" };
  }

  // Pseudo d'affichage : profil du joueur, sinon partie locale de l'e-mail.
  let pseudo = "";
  const prof = await db.doc(`users/${uid}/state/profile`).get();
  const pdata = prof.exists ? (prof.data() || {}) : {};
  if (typeof pdata.pseudo === "string" && pdata.pseudo.trim()) pseudo = pdata.pseudo.trim();
  if (!pseudo) {
    try {
      const u = await getAuth().getUser(uid);
      if (u.email) pseudo = u.email.split("@")[0];
    } catch (e) { /* e-mail indisponible : repli générique */ }
  }
  pseudo = (pseudo || "Joueur").slice(0, 40);

  await db.doc(`leaderboard/${uid}`).set({
    pseudo,
    total,
    months,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { uid, total, pseudo };
}

// Un résultat change (ajout, correction, suppression) → on recalcule.
exports.classementSurResultat = onDocumentWritten("users/{uid}/results/{rid}", (event) => {
  return refreshLeaderboard(event.params.uid);
});

// Le profil change (surtout le pseudo, ou l'avatar) → on rafraîchit la fiche.
exports.classementSurProfil = onDocumentWritten("users/{uid}/state/profile", (event) => {
  return refreshLeaderboard(event.params.uid);
});

// Suspension / réactivation (/banned) → retire ou restaure la fiche.
exports.classementSurBanni = onDocumentWritten("banned/{uid}", (event) => {
  return refreshLeaderboard(event.params.uid);
});

// Backfill unique après le déploiement : recalcule le classement de tous les
// joueurs existants. Réservé au compte de l'auteur. À appeler une fois.
exports.backfillClassement = onCall(async (req) => {
  const email = req.auth && req.auth.token && req.auth.token.email;
  if (email !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Réservé à l'auteur.");
  }
  const users = await db.collection("users").listDocuments();
  const res = [];
  for (const u of users) {
    res.push(await refreshLeaderboard(u.id));
  }
  return { count: res.length, results: res };
});

// Exporté pour les tests unitaires (logique pure de recalcul).
exports._refreshLeaderboard = refreshLeaderboard;
