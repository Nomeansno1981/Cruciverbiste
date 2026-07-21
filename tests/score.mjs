// Test du bareme d'experience (scoreXP) et de l'echelle de niveaux
// (niveauPourXp), fonctions pures sans DOM. A lancer via : npm run test:score
import { scoreXP, niveauPourXp, NIVEAUX, badgesRetroactifs } from "../jeu.js";

const cases = [
  { in: { seconds: 120, hints: 0, solutions: 0, words: 20 }, out: 200, label: "clean et rapide (20 mots, 2 min) : maximum" },
  { in: { seconds: 300, hints: 0, solutions: 0, words: 20 }, out: 170, label: "clean, moins de 6 min : +30" },
  { in: { seconds: 700, hints: 0, solutions: 0, words: 20 }, out: 140, label: "clean mais lent (plus de 10 min) : pas de bonus vitesse" },
  { in: { seconds: 120, hints: 1, solutions: 0, words: 20 }, out: 155, label: "1 indice : perte du bonus sans-aide et -5" },
  { in: { seconds: 120, hints: 3, solutions: 0, words: 20 }, out: 145, label: "3 indices : -15" },
  { in: { seconds: 120, hints: 0, solutions: 1, words: 20 }, out: 140, label: "1 solution : -20" },
  { in: { seconds: 120, hints: 20, solutions: 5, words: 20 }, out: 20, label: "aide massive : plancher a 20" },
  { in: { seconds: 89, hints: 0, solutions: 0, words: 10 }, out: 200, label: "petite grille (10 mots) resolue tres vite : bonus plein" },
  { in: { seconds: 120, hints: 0, solutions: 0, words: 10 }, out: 170, label: "petite grille : la normalisation reduit le bonus vitesse" },
  { in: { seconds: 300, hints: 0, solutions: 0, words: 40 }, out: 200, label: "grande grille (40 mots) en 5 min : temps normalise a 2m30, bonus plein" },
  { in: { seconds: 600, hints: 0, solutions: 0, words: 40 }, out: 170, label: "grande grille (40 mots) en 10 min : temps normalise a 5 min, +30" },
];

let failures = 0;
for (const c of cases) {
  const got = scoreXP(c.in);
  if (got === c.out) { console.log("ok     " + c.label + " = " + got); }
  else { failures++; console.log("ÉCHEC  " + c.label + " : attendu " + c.out + ", obtenu " + got); }
}

// proprietes generales
function prop(name, cond){ if(cond){ console.log("ok     " + name); } else { failures++; console.log("ÉCHEC  " + name); } }
prop("le score ne descend jamais sous 20", [0, 5, 30, 120, 999].every(s => scoreXP({ seconds: s, hints: 50, solutions: 50, words: 20 }) >= 20));
prop("un appel sans argument reste valide (grille de 20 mots par defaut)", scoreXP() === 200);
prop("plus d'indices ne rapporte jamais plus de points", scoreXP({ seconds: 120, hints: 2, words: 20 }) <= scoreXP({ seconds: 120, hints: 1, words: 20 }));

// ---- echelle de niveaux ----
function nv(name, cond, got){ if(cond){ console.log("ok     " + name); } else { failures++; console.log("ÉCHEC  " + name + (got !== undefined ? " : " + JSON.stringify(got) : "")); } }

const n0 = niveauPourXp(0);
nv("XP 0 : niveau 1 Roturier", n0.niveau === 1 && n0.titre === "Roturier" && n0.seuil === 0, n0);
nv("XP 0 : progression nulle et prochain palier a 150", n0.progression === 0 && n0.prochain === 150 && n0.titreProchain === "Apprenti", n0);

const n149 = niveauPourXp(149);
nv("XP 149 : encore niveau 1, presque au palier", n149.niveau === 1 && n149.progression > 0.9 && n149.progression < 1, n149);

const n150 = niveauPourXp(150);
nv("XP 150 : passage au niveau 2 Apprenti", n150.niveau === 2 && n150.titre === "Apprenti" && n150.progression === 0, n150);

const nMid = niveauPourXp(675); // milieu du niveau 3 (450..900)
nv("XP 675 : niveau 3, progression a mi-chemin", nMid.niveau === 3 && Math.abs(nMid.progression - 0.5) < 1e-9, nMid);

const nMax = niveauPourXp(25000);
nv("XP 25000 : rang maximal Mythe", nMax.niveau === NIVEAUX.length && nMax.titre === "Mythe" && nMax.max === true && nMax.prochain === null, nMax);

const nOver = niveauPourXp(999999);
nv("XP tres eleve : reste au rang maximal, progression pleine", nOver.max === true && nOver.progression === 1, nOver);

const nNeg = niveauPourXp(-50);
nv("XP negatif : plancher au niveau 1", nNeg.niveau === 1, nNeg);

nv("les seuils de niveaux sont strictement croissants", NIVEAUX.every((x, i) => i === 0 || x.seuil > NIVEAUX[i - 1].seuil));
nv("le niveau ne recule jamais quand l'XP augmente", [0, 100, 150, 500, 3000, 12000, 30000].every((x, i, a) => i === 0 || niveauPourXp(x).niveau >= niveauPourXp(a[i - 1]).niveau));

// ---- rattrapage retroactif des badges (badgesRetroactifs) ----
function br(name, cond, got){ if(cond){ console.log("ok     " + name); } else { failures++; console.log("ÉCHEC  " + name + (got !== undefined ? " : " + JSON.stringify(got) : "")); } }
const setOf = (res, st) => new Set(badgesRetroactifs(res, st));
const solved = (o) => Object.assign({ solved: true, seconds: 800, hints: 1, solutions: 0 }, o);

br("aucun resultat : aucun badge", setOf([], 0).size === 0);
const rUne = setOf([solved({})], 0);
br("une grille lente avec aide : seulement « premiere grille »", rUne.has("grilles-1") && !rUne.has("vitesse-10") && !rUne.has("puriste"), [...rUne]);
const rDix = setOf(Array.from({ length: 10 }, () => solved({})), 0);
br("dix grilles : « premiere grille » + « dix grilles », pas « cent »", rDix.has("grilles-1") && rDix.has("grilles-10") && !rDix.has("grilles-100"), [...rDix]);
const rRapide = setOf([solved({ seconds: 800 }), solved({ seconds: 120, hints: 0, solutions: 0 })], 0);
br("meilleur temps < 3 min : les trois badges de rapidite", rRapide.has("vitesse-10") && rRapide.has("vitesse-5") && rRapide.has("vitesse-3"), [...rRapide]);
br("une reussite sans aide dans l'historique : « puriste »", rRapide.has("puriste"), [...rRapide]);
const rSerie = setOf([solved({})], 55);
br("serie courante 55 : « braise » et « flamme », pas « brasier »", rSerie.has("serie-10") && rSerie.has("serie-50") && !rSerie.has("serie-100"), [...rSerie]);
const rMoment = setOf([solved({ seconds: 60, hints: 0, solutions: 0 })], 100);
br("les badges de l'instant ne se rattrapent pas (premier/dernier/necromant)", !rMoment.has("premier") && !rMoment.has("dernier") && !rMoment.has("necromant"), [...rMoment]);
br("un resultat non resolu est ignore", setOf([{ solved: false, seconds: 10, hints: 0, solutions: 0 }], 0).size === 0);

if (failures) { console.error("\n" + failures + " controle(s) en echec."); process.exit(1); }
console.log("\nBareme d'experience et echelle de niveaux verifies : tous les controles passent.");
