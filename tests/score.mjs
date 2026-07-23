// Test du bareme d'experience (detailScore) et de l'echelle de
// niveaux (niveauPourXp), fonctions pures sans DOM. A lancer via : npm run test:score
import { detailScore, niveauPourXp, NIVEAUX, badgesRetroactifs } from "../jeu.js";
// L'XP seule = detailScore(args).xp (l'ancien helper scoreXP a ete retire).
const scoreXP = (args) => detailScore(args).xp;

// construit une grille : `propres` mots trouves seuls (5 lettres, 0 indice),
// plus d'eventuels mots particuliers passes tels quels.
function grille(propres, speciaux = []){
  const mots = [];
  for(let i = 0; i < propres; i++) mots.push({ cells: 5, hints: 0, solution: false });
  return mots.concat(speciaux);
}
const sol = (n) => Array.from({ length: n }, () => ({ cells: 5, hints: 0, solution: true }));

// Bareme : 20 pts / mot trouve, -5 / indice (plancher 0 par mot), 0 si mot
// revele (Solution ou toutes lettres en indice) ; bonus 50/75/100 sous 10/5/3
// min, multiplie par la part de mots trouves seuls. Grilles de 16 mots ici.
const cases = [
  { in: { seconds: 120, words: grille(16) }, out: 420, label: "16 mots trouves seuls, < 3 min : 320 + bonus plein 100" },
  { in: { seconds: 240, words: grille(16) }, out: 395, label: "16 seuls, < 5 min : 320 + 75" },
  { in: { seconds: 480, words: grille(16) }, out: 370, label: "16 seuls, < 10 min : 320 + 50" },
  { in: { seconds: 700, words: grille(16) }, out: 320, label: "16 seuls mais > 10 min : pas de bonus" },
  { in: { seconds: 120, words: grille(15, [{ cells: 6, hints: 1, solution: false }]) }, out: 409, label: "1 indice sur un mot : ce mot vaut 15, et il ne compte pas comme trouve seul" },
  { in: { seconds: 120, words: grille(15, [{ cells: 5, hints: 0, solution: true }]) }, out: 394, label: "1 mot revele par Solution : 0 point, exclu du bonus" },
  { in: { seconds: 120, words: grille(8, sol(8)) }, out: 210, label: "moitie de la grille revelee : bonus reduit de moitie (base 160 + 50)" },
  { in: { seconds: 60, words: sol(16) }, out: 0, label: "grille entierement revelee par Solution : 0, meme tres vite" },
  { in: { seconds: 60, words: Array.from({ length: 16 }, () => ({ cells: 5, hints: 5, solution: false })) }, out: 0, label: "grille entierement devoilee en indices : 0 (pas d'exploit)" },
  { in: { seconds: 120, words: 16 }, out: 420, label: "appel avec un nombre : 16 mots supposes trouves seuls" },
];

let failures = 0;
for (const c of cases) {
  const got = scoreXP(c.in);
  if (got === c.out) { console.log("ok     " + c.label + " = " + got); }
  else { failures++; console.log("ÉCHEC  " + c.label + " : attendu " + c.out + ", obtenu " + got); }
}

// proprietes generales
function prop(name, cond){ if(cond){ console.log("ok     " + name); } else { failures++; console.log("ÉCHEC  " + name); } }
prop("un appel sans argument reste valide (grille de 20 mots seuls, tres vite)", scoreXP() === 500);
prop("le score n'est jamais negatif", [0, 5, 120, 999].every(s => scoreXP({ seconds: s, words: sol(16) }) === 0));
prop("un indice de plus sur un mot ne rapporte jamais plus", scoreXP({ seconds: 120, words: grille(15, [{ cells: 6, hints: 2 }]) }) <= scoreXP({ seconds: 120, words: grille(15, [{ cells: 6, hints: 1 }]) }));
prop("un mot entierement en indices ne rapporte pas plus qu'une solution", scoreXP({ seconds: 120, words: grille(15, [{ cells: 4, hints: 4 }]) }) === scoreXP({ seconds: 120, words: grille(15, [{ cells: 4, hints: 0, solution: true }]) }));
prop("reveler toute la grille ne donne aucun bonus de rapidite", detailScore({ seconds: 30, words: sol(16) }).bonus === 0);

// detail du score (pour l'ecran de fin)
const d = detailScore({ seconds: 120, words: grille(15, [{ cells: 6, hints: 1, solution: false }]) });
prop("detailScore : base, mots trouves seuls, mots aides et total", d.base === 315 && d.seuls === 15 && d.aides === 1 && d.reveles === 0 && d.bonus === 94 && d.xp === 409 && d.mots === 16);
const dRev = detailScore({ seconds: 120, words: grille(15, [{ cells: 3, hints: 3, solution: false }]) });
prop("detailScore : un mot court entierement en indices compte comme revele (0)", dRev.reveles === 1 && dRev.aides === 0 && dRev.base === 300);

// ---- echelle de niveaux ----
function nv(name, cond, got){ if(cond){ console.log("ok     " + name); } else { failures++; console.log("ÉCHEC  " + name + (got !== undefined ? " : " + JSON.stringify(got) : "")); } }

const n0 = niveauPourXp(0);
nv("XP 0 : niveau 1 Roturier", n0.niveau === 1 && n0.titre === "Roturier" && n0.seuil === 0, n0);
nv("XP 0 : progression nulle et prochain palier a 300", n0.progression === 0 && n0.prochain === 300 && n0.titreProchain === "Apprenti", n0);

const n299 = niveauPourXp(299);
nv("XP 299 : encore niveau 1, presque au palier", n299.niveau === 1 && n299.progression > 0.9 && n299.progression < 1, n299);

const n300 = niveauPourXp(300);
nv("XP 300 : passage au niveau 2 Apprenti", n300.niveau === 2 && n300.titre === "Apprenti" && n300.progression === 0, n300);

const nMid = niveauPourXp(1350); // milieu du niveau 3 (900..1800)
nv("XP 1350 : niveau 3, progression a mi-chemin", nMid.niveau === 3 && nMid.titre === "Aventurier" && Math.abs(nMid.progression - 0.5) < 1e-9, nMid);

const nMax = niveauPourXp(50000);
nv("XP 50000 : rang maximal Mythe", nMax.niveau === NIVEAUX.length && nMax.titre === "Mythe" && nMax.max === true && nMax.prochain === null, nMax);

const nOver = niveauPourXp(999999);
nv("XP tres eleve : reste au rang maximal, progression pleine", nOver.max === true && nOver.progression === 1, nOver);

const nNeg = niveauPourXp(-50);
nv("XP negatif : plancher au niveau 1", nNeg.niveau === 1, nNeg);

nv("les seuils de niveaux sont strictement croissants", NIVEAUX.every((x, i) => i === 0 || x.seuil > NIVEAUX[i - 1].seuil));
nv("le niveau ne recule jamais quand l'XP augmente", [0, 100, 300, 1000, 5000, 20000, 60000].every((x, i, a) => i === 0 || niveauPourXp(x).niveau >= niveauPourXp(a[i - 1]).niveau));

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
