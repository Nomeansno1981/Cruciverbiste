// Test des helpers partages (commun.js) : dates de Paris, serie (streak),
// compte a rebours, formatage, et publication de la fiche de classement.
// Fonctions pures ou a dependances injectables, sans navigateur.
// A lancer via : npm run test:commun
import { parisDate, labelForKey, prevDate, effectiveStreak, secsToNextParisMidnight, fmtHms, publierClassement } from "../commun.js";

let failures = 0;
function ok(name, cond){ if(cond){ console.log("ok     " + name); } else { failures++; console.log("ÉCHEC  " + name); } }

// --- dates ---
ok("parisDate renvoie une cle AAAA-MM-JJ", /^\d{4}-\d{2}-\d{2}$/.test(parisDate()));
ok("parisDate (heure de Paris) formate la date donnee", parisDate(new Date(Date.UTC(2025, 2, 3, 12))) === "2025-03-03");
ok("labelForKey : libelle francais", /mars/.test(labelForKey("2025-03-03")) && /2025/.test(labelForKey("2025-03-03")));
ok("labelForKey : renvoie la cle si invalide", labelForKey("n'importe quoi") === "n'importe quoi");

// --- veille (prevDate), avec les cas limites ---
ok("prevDate : veille simple", prevDate("2025-03-03") === "2025-03-02");
ok("prevDate : passage de mois", prevDate("2025-03-01") === "2025-02-28");
ok("prevDate : passage d'annee", prevDate("2025-01-01") === "2024-12-31");
ok("prevDate : annee bissextile", prevDate("2024-03-01") === "2024-02-29");

// --- serie affichable ---
ok("effectiveStreak : aujourd'hui conserve le compteur", effectiveStreak({ lastDate: "2025-03-03", count: 5 }, "2025-03-03") === 5);
ok("effectiveStreak : hier conserve le compteur", effectiveStreak({ lastDate: "2025-03-02", count: 5 }, "2025-03-03") === 5);
ok("effectiveStreak : un jour manque remet a zero", effectiveStreak({ lastDate: "2025-03-01", count: 5 }, "2025-03-03") === 0);
ok("effectiveStreak : sans document renvoie 0", effectiveStreak(null, "2025-03-03") === 0);

// --- formatage h:mm:ss (heures sur 2 chiffres : contrat du compte a rebours de l'accueil) ---
ok("fmtHms : padding complet", fmtHms(3661) === "01:01:01");
ok("fmtHms : minuit pile (86400 s) reste sur 2 chiffres", fmtHms(86400) === "24:00:00");
ok("fmtHms : negatif borne a zero", fmtHms(-10) === "00:00:00");
ok("fmtHms : toujours au format hh:mm:ss", [0, 1, 59, 3600, 86399, 86400].every(s => /^\d{2}:\d{2}:\d{2}$/.test(fmtHms(s))));

// --- compte a rebours jusqu'au prochain minuit de Paris ---
const secs = secsToNextParisMidnight();
ok("secsToNextParisMidnight : entier dans (0, 86400]", Number.isInteger(secs) && secs > 0 && secs <= 86400);
ok("secsToNextParisMidnight : jamais negatif (pas de bug « 24h »)", secs >= 0);
ok("le compte a rebours passe le format attendu par l'accueil", /^\d{2}:\d{2}:\d{2}$/.test(fmtHms(secs)));

// --- calcul du classement (plus d'ecriture cote client : desormais serveur) ---
function fakeStore(results){
  const store = { written: null };
  const m = {
    collection: (...a) => ({ __col: a }),
    doc: (...a) => ({ __doc: a }),
    serverTimestamp: () => "TS",
    getDocs: async () => ({ forEach: fn => results.forEach(r => fn({ id: r.id, data: () => r })) }),
    setDoc: async (ref, data) => { store.written = { ref, data }; }
  };
  return { m, store };
}

const a = fakeStore([{ id: "2025-03-01", date: "2025-03-01", xp: 20 }, { id: "2025-04-02", date: "2025-04-02", xp: 30 }]);
const ra = await publierClassement(a.m, {}, { uid: "u1", email: "jean@exemple.fr" }, { pseudo: "Jean" });
ok("publierClassement : total agrege", ra.total === 50);
ok("publierClassement : XP ventilee par mois", ra.months["2025-03"] === 20 && ra.months["2025-04"] === 30);
ok("publierClassement : pseudo du profil", ra.pseudo === "Jean");
ok("publierClassement : n'ecrit plus /leaderboard cote client (total > 0)", a.store.written === null);

const b = fakeStore([]);
const rb = await publierClassement(b.m, {}, { uid: "u2", email: "marie@exemple.fr" }, { pseudo: "" });
ok("publierClassement : total 0 sans resultat", rb.total === 0);
ok("publierClassement : n'ecrit jamais la fiche (meme a 0)", b.store.written === null);
ok("publierClassement : pseudo derive de l'e-mail a defaut", rb.pseudo === "marie");

const c = fakeStore([{ id: "2025-03-01", date: "2025-03-01", xp: 20 }, { id: "2025-03-02", date: "2025-03-02" }]);
const rc = await publierClassement(c.m, {}, { uid: "u3", email: "z@exemple.fr" }, {});
ok("publierClassement : ignore les resultats sans xp numerique", rc.total === 20);

console.log(failures ? ("\n" + failures + " test(s) en echec.") : "\nTous les tests passent.");
process.exit(failures ? 1 : 0);
