// Helpers partagés par les pages du jeu (accueil, donjons). Regroupe les
// fonctions autrefois dupliquées des deux côtés : date de Paris et libellés,
// série (streak), avatar, redimensionnement d'image, compte à rebours jusqu'au
// prochain donjon, et publication de la fiche de classement.
//
// Doit rester à la racine du dépôt : les pages l'importent en "./commun.js"
// (comme jeu.js et firebase-init.js) ; le workflow de déploiement le copie dans
// _fire/. Aucun effet de bord au chargement (que des déclarations) : le module
// est donc aussi importable côté Node pour les tests unitaires ; les helpers qui
// touchent au navigateur (resizeImage, fillAvatar) ne s'exécutent qu'à l'appel.

// ---- dates (heure de Paris) ----
// clé du jour AAAA-MM-JJ à l'heure de Paris (d facultatif : une autre date)
export function parisDate(d){
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
}
// libellé français « lundi 3 mars 2025 » à partir d'une clé AAAA-MM-JJ.
// Midi UTC pour éviter qu'un décalage de fuseau ne fasse basculer le jour.
export function labelForKey(key){
  try{ const [y, mo, da] = key.split("-").map(Number); return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, mo - 1, da, 12))); }
  catch(e){ return key; }
}
// veille d'une clé AAAA-MM-JJ (midi UTC : robuste aux changements d'heure)
export function prevDate(ds){
  const [y, mo, d] = ds.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// ---- série (streak) ----
// série affichable : le compteur si le dernier jour réussi est aujourd'hui ou
// hier (série encore vivante), 0 si un jour a été manqué.
export function effectiveStreak(doc, today){
  if(!doc || !doc.lastDate) return 0;
  if(doc.lastDate === today || doc.lastDate === prevDate(today)) return doc.count || 0;
  return 0;
}
export const FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2c.5 4-2.5 5.5-2.5 8.5A2.5 2.5 0 0 0 15 11c0-.6-.1-1 .3-1.6 1.4 1.6 2.7 3.5 2.7 6.1a6 6 0 1 1-12 0c0-4.8 6-7 7-13.5z"/></svg>';

// ---- avatar ----
export function initial(s){ return ((s || "?").trim().charAt(0) || "?").toUpperCase(); }
export function fillAvatar(el, av, txt){
  if(av){ el.innerHTML = '<img alt="" src="' + av + '">'; }
  else { el.textContent = initial(txt); }
}
// redimensionne une image côté navigateur en un petit carré (data URL), rangée
// avec le profil sans service de stockage
export function resizeImage(file, size){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(img, sx, sy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image illisible")); };
    img.src = url;
  });
}

// ---- compte à rebours jusqu'au prochain donjon (minuit, heure de Paris) ----
// Secondes avant le prochain minuit de Paris. On lit l'horloge murale de Paris
// via Intl : cette différence en heures/minutes/secondes reste juste des deux
// côtés d'un changement d'heure d'été, contrairement à une soustraction de dates
// faite dans le fuseau du runtime. Le « % 24 » neutralise le bug historique de
// certains moteurs qui formatent minuit en « 24 » plutôt que « 00 » (sans quoi
// la première heure après minuit renverrait une valeur négative).
export function secsToNextParisMidnight(){
  try{
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    const [h, mi, s] = p.split(":").map(Number);
    return (24 - (h % 24)) * 3600 - mi * 60 - s;
  }catch(e){ return 0; }
}
// formate une durée en secondes en h:mm:ss (heures sur deux chiffres)
export function fmtHms(t){
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const p = n => String(n).padStart(2, "0");
  return p(h) + ":" + p(m) + ":" + p(s);
}

// ---- classement ----
// Recalcule le classement du joueur (pseudo, XP totale et XP par mois) à partir
// de toutes ses grilles réussies, et renvoie { pseudo, total, months } pour un
// affichage immédiat (mise à jour optimiste du tableau côté appelant).
//
// N'ÉCRIT PLUS /leaderboard : la fiche est désormais écrite côté serveur par une
// Cloud Function (autorité serveur) à partir des mêmes résultats, peu après
// l'enregistrement du résultat. Les règles refusent l'écriture côté joueur, si
// bien qu'un total ne peut plus être gonflé depuis la console. Le calcul local
// ci-dessous reste utile pour refléter aussitôt le nouveau total sans attendre
// la Function ni recharger la page.
export async function publierClassement(m, db, user, profile){
  const snap = await m.getDocs(m.collection(db, "users", user.uid, "results"));
  let total = 0; const months = {};
  snap.forEach(ds => {
    const d = ds.data();
    if(typeof d.xp !== "number") return;
    total += d.xp;
    const mk = String(d.date || ds.id || "").slice(0, 7);
    if(/^\d{4}-\d{2}$/.test(mk)) months[mk] = (months[mk] || 0) + d.xp;
  });
  const pseudo = (profile && profile.pseudo) || (user.email ? user.email.split("@")[0].slice(0, 40) : "Joueur");
  return { pseudo, total, months };
}

// ---- petit bandeau ephemere ----
// Message flottant en bas de l'ecran (ex. « e-mail de confirmation envoye »), independant
// de la porte d'authentification qui, elle, disparait des la connexion. Se referme au clic
// ou automatiquement apres quelques secondes.
export function showToast(msg, ms){
  let t = document.getElementById("ddToast");
  if(!t){
    t = document.createElement("div");
    t.id = "ddToast"; t.className = "dd-toast"; t.setAttribute("role", "status");
    t.addEventListener("click", () => t.classList.remove("show"));
    document.body.appendChild(t);
  }
  t.textContent = msg;
  // forcer un reflow pour rejouer la transition si un toast est deja affiche
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms || 9000);
}

// Envoie (ou renvoie) l'e-mail de verification via la Cloud Function, qui l'expedie
// depuis notre domaine (bien meilleure delivrabilite que l'expediteur Firebase par
// defaut). Renvoie { sent, reason? }. Leve en cas d'echec (a rattraper par l'appelant).
export async function envoyerVerification(m, functions){
  const appeler = m.httpsCallable(functions, "envoyerVerificationEmail");
  const res = await appeler();
  return (res && res.data) || {};
}

// Variante « bouton du profil » : appelle la fonction et affiche un bandeau selon le resultat.
export async function renvoyerVerification(m, functions){
  try{
    await envoyerVerification(m, functions);
    showToast("E-mail de vérification renvoyé. Pensez à vérifier votre boîte de réception.");
  }catch(e){
    showToast((e && e.code === "functions/resource-exhausted")
      ? "Veuillez patienter une minute avant de renvoyer l'e-mail."
      : "Envoi impossible pour le moment. Réessayez plus tard.");
  }
}
