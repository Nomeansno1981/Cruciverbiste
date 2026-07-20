// Test du bareme d'experience (scoreXP), fonction pure sans DOM.
// A lancer via : npm run test:score
import { scoreXP } from "../jeu.js";

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

if (failures) { console.error("\n" + failures + " controle(s) en echec."); process.exit(1); }
console.log("\nBareme d'experience verifie : tous les controles passent.");
