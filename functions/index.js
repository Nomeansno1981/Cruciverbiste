// Cloud Functions (1re génération) — autorité serveur sur le classement.
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
//
// 1re génération (déclencheurs Firestore classiques + callable) : suffisante pour
// ce besoin, et déployable avec un jeu de droits minimal côté compte de service.

const functions = require("firebase-functions/v1");
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
exports.classementSurResultat = functions.firestore
  .document("users/{uid}/results/{rid}")
  .onWrite((change, context) => refreshLeaderboard(context.params.uid));

// Le profil change (surtout le pseudo, ou l'avatar) → on rafraîchit la fiche.
exports.classementSurProfil = functions.firestore
  .document("users/{uid}/state/profile")
  .onWrite((change, context) => refreshLeaderboard(context.params.uid));

// Suspension / réactivation (/banned) → retire ou restaure la fiche.
exports.classementSurBanni = functions.firestore
  .document("banned/{uid}")
  .onWrite((change, context) => refreshLeaderboard(context.params.uid));

// Backfill unique après le déploiement : recalcule le classement de tous les
// joueurs existants. Réservé au compte de l'auteur. À appeler une fois.
exports.backfillClassement = functions.https.onCall(async (data, context) => {
  const email = context.auth && context.auth.token && context.auth.token.email;
  if (email !== ADMIN_EMAIL) {
    throw new functions.https.HttpsError("permission-denied", "Réservé à l'auteur.");
  }
  const users = await db.collection("users").listDocuments();
  const res = [];
  for (const u of users) {
    res.push(await refreshLeaderboard(u.id));
  }
  return { count: res.length, results: res };
});

// --- Vérification d'adresse e-mail envoyée depuis notre domaine ---
// L'expéditeur Firebase par défaut (…firebaseapp.com) a une réputation faible :
// spam chez Gmail, rejet silencieux chez iCloud. On génère nous-mêmes le lien de
// vérification (Admin SDK) et on envoie l'e-mail via Resend, depuis
// noreply@donjonsetdefinitions.fr (domaine authentifié SPF/DKIM/DMARC).
// La clé API Resend est un secret (functions:secrets:set RESEND_API_KEY).
function gabaritVerification(lien) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#faf9f5;padding:24px 12px">
  <div style="font-family:Georgia,'Times New Roman',serif;max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e1d5;border-radius:14px;padding:28px;color:#1c1b19">
    <h1 style="font-family:Georgia,serif;color:#c4161c;font-size:24px;margin:0 0 14px;text-align:center">Donjons &amp; Définitions</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 12px">Bienvenue, aventurier !</p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 18px">Confirmez votre adresse e-mail pour sceller votre entrée dans le donjon&nbsp;:</p>
    <p style="text-align:center;margin:0 0 20px">
      <a href="${lien}" style="display:inline-block;background:#1e7a43;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:13px 30px;border-radius:999px">Confirmer mon adresse</a>
    </p>
    <p style="font-size:12.5px;color:#74706a;line-height:1.5;margin:0 0 10px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br><span style="word-break:break-all;color:#5e1522">${lien}</span></p>
    <p style="font-size:12.5px;color:#74706a;line-height:1.5;margin:0">Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet e-mail.</p>
  </div></body></html>`;
}

exports.envoyerVerificationEmail = functions
  .runWith({ secrets: ["RESEND_API_KEY"] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Connexion requise.");
    }
    const uid = context.auth.uid;
    const email = context.auth.token.email;
    if (!email) {
      throw new functions.https.HttpsError("failed-precondition", "Ce compte n'a pas d'adresse e-mail.");
    }
    if (context.auth.token.email_verified) {
      return { sent: false, reason: "already_verified" };
    }

    // Anti-abus : au plus un envoi par minute et par compte (ignoré en émulateur).
    const inEmu = process.env.FUNCTIONS_EMULATOR === "true";
    const metaRef = db.doc(`users/${uid}/state/mailmeta`);
    if (!inEmu) {
      const meta = await metaRef.get();
      const last = meta.exists ? (meta.data().lastVerif || 0) : 0;
      if (Date.now() - last < 60000) {
        throw new functions.https.HttpsError("resource-exhausted", "Veuillez patienter une minute avant de renvoyer l'e-mail.");
      }
    }

    const lien = await getAuth().generateEmailVerificationLink(email);

    // Émulateur (ou clé absente) : on n'envoie pas réellement, on journalise le lien.
    if (inEmu || !process.env.RESEND_API_KEY) {
      functions.logger.info(`[verif] lien pour ${email} : ${lien}`);
      return { sent: true, emulated: true };
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Donjons & Définitions <noreply@donjonsetdefinitions.fr>",
        to: [email],
        subject: "Confirmez votre adresse — Donjons & Définitions",
        html: gabaritVerification(lien),
        text: `Bienvenue sur Donjons & Définitions !\n\nConfirmez votre adresse e-mail en ouvrant ce lien :\n${lien}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.`,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      functions.logger.error("Resend a refusé l'envoi", resp.status, detail);
      throw new functions.https.HttpsError("internal", "L'envoi de l'e-mail a échoué.");
    }
    await metaRef.set({ lastVerif: Date.now() }, { merge: true });
    return { sent: true };
  });

// Exporté pour les tests unitaires (logique pure de recalcul).
exports._refreshLeaderboard = refreshLeaderboard;
