// Test du moteur de resolution (jouer.html) : rendu de la grille, selection
// d'une definition, saisie au clavier, surlignage du mot, verification,
// completion, et bascule responsive. A lancer via : npm run test:play
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const server = http.createServer(async (req, res) => {
  try {
    const clean = (req.url || "/").split("?")[0];
    const file = clean === "/" ? "jouer.html" : clean.slice(1);
    const data = await readFile(path.join(root, file));
    const type = file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : file.endsWith(".css") ? "text/css; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch { res.writeHead(404); res.end("introuvable"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/jouer.html`;

async function launchBrowser(){
  const opts = { chromiumSandbox: false };
  try { return await chromium.launch(opts); }
  catch (first) {
    const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    const candidates = [];
    if (existsSync(dir)) {
      for (const d of readdirSync(dir)) {
        for (const p of [path.join(dir, d, "chrome-linux", "chrome"), path.join(dir, d, "chrome-linux", "headless_shell")]) {
          if (existsSync(p)) candidates.push(p);
        }
      }
    }
    candidates.push("/opt/pw-browsers/chromium");
    for (const exe of candidates) {
      try { return await chromium.launch({ ...opts, executablePath: exe }); } catch { /* suivant */ }
    }
    throw first;
  }
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.setDefaultTimeout(15000);
const errs = [];
page.on("pageerror", e => errs.push(String(e)));

const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}
// couleur de fond calculee d'une case reperee par (ligne, colonne)
async function bgAt(r, c){
  return await page.evaluate(([r, c]) => {
    for (const el of document.querySelectorAll("#board .cell")){
      const w = parseFloat(el.style.width);
      if (Math.round(parseFloat(el.style.top) / w) === r && Math.round(parseFloat(el.style.left) / w) === c)
        return getComputedStyle(el).backgroundColor;
    }
    return null;
  }, [r, c]);
}
const VERT = "rgb(234, 243, 233)", ROUGE = "rgb(247, 222, 222)";

await page.goto(base);
await page.waitForSelector("#board .cell");

await check("la grille se dessine (toutes les cases pleines)", async () => {
  const n = await page.locator("#board .cell").count();
  if (n !== 120) throw new Error("attendu 120 cases, obtenu " + n);
});

await check("bords : le quadrillage deborde d'une marge (epaisseur uniforme)", async () => {
  const r = await page.evaluate(() => {
    const svg = document.querySelector("#board .grid-svg");
    return { svgW: parseFloat(svg.getAttribute("width")), boardW: parseFloat(document.getElementById("board").style.width), left: svg.style.left };
  });
  if (!(r.svgW > r.boardW)) throw new Error("SVG pas plus large que la grille : " + r.svgW + " vs " + r.boardW);
  if (r.left === "0px" || r.left === "") throw new Error("marge non appliquee : " + r.left);
});

await check("choisir une definition surligne le mot entier", async () => {
  await page.click("#li-A1"); // KOBOLD, 6 lettres
  const id = await page.evaluate(() => window.__play.currentClue());
  if (id !== "A1") throw new Error("definition active : " + id);
  const hl = await page.evaluate(() => window.__play.wordHighlight());
  if (hl !== 6) throw new Error("cases surlignees : " + hl);
});

await check("saisie au clavier : les lettres se posent et avancent", async () => {
  await page.keyboard.type("kobold");
  const letters = await page.evaluate(() => [[0,2],[0,3],[0,4],[0,5],[0,6],[0,7]].map(([r,c]) => window.__play.letterAt(r,c)).join(""));
  if (letters !== "KOBOLD") throw new Error("lettres posees : " + letters);
});

await check("le chrono se declenche a la premiere lettre", async () => {
  const t = await page.evaluate(() => window.__play.elapsedShown());
  if (!/^\d+:\d\d$/.test(t)) throw new Error("chrono illisible : " + t);
});

await check("un mot rempli correctement se valide (vert) et se verrouille", async () => {
  // KOBOLD (A1) vient d'etre rempli correctement au controle precedent
  if (!(await page.evaluate(() => window.__play.isOk(0, 2)))) throw new Error("le mot rempli correctement n'est pas valide");
  if (await page.evaluate(() => window.__play.okWordCount()) < 1) throw new Error("aucun mot valide compte");
  await page.evaluate(() => window.__play.selectClue("across", 1));
  await page.keyboard.type("z");
  const still = await page.evaluate(() => window.__play.letterAt(0, 2));
  if (still !== "K") throw new Error("une case validee a ete ecrasee : " + still);
});

await check("Indice revele une lettre du mot selectionne, verrouillee", async () => {
  await page.evaluate(() => window.__play.selectClue("across", 7)); // VAMPIRE, vide
  const before = await page.evaluate(() => window.__play.hints());
  await page.click("#hintBtn");
  const after = await page.evaluate(() => window.__play.hints());
  if (after !== before + 1) throw new Error("compteur d'indices : " + before + " -> " + after);
  if (!(await page.evaluate(() => window.__play.isGiven(3, 3)))) throw new Error("lettre revelee non marquee donnee");
  if (await page.evaluate(() => window.__play.letterAt(3, 3)) !== "V") throw new Error("mauvaise lettre revelee");
});

await check("Solution revele le mot en entier (rouge, jamais valide)", async () => {
  await page.evaluate(() => window.__play.selectClue("down", 6)); // MAGE, vide
  const before = await page.evaluate(() => window.__play.solvedWordCount());
  await page.click("#solveBtn");
  if (await page.evaluate(() => window.__play.solutions()) < 1) throw new Error("compteur de solutions non incremente");
  if (await page.evaluate(() => window.__play.solvedWordCount()) !== before + 1) throw new Error("mot non compte comme donne");
  const letters = await page.evaluate(() => [[2,4],[3,4],[4,4],[5,4]].map(([r,c]) => window.__play.letterAt(r,c)).join(""));
  if (letters !== "MAGE") throw new Error("mot non revele en entier : " + letters);
  if (!(await page.evaluate(() => [[2,4],[3,4],[4,4],[5,4]].every(([r,c]) => window.__play.isSolvedCell(r,c))))) throw new Error("cases non marquees comme donnees par Solution");
  if (await page.evaluate(() => [[2,4],[3,4],[4,4],[5,4]].some(([r,c]) => window.__play.isOk(r,c)))) throw new Error("un mot donne par Solution est marque valide (vert)");
  // le mot doit virer au rouge tout de suite, alors qu'il est encore selectionne
  if (await page.evaluate(() => window.__play.currentClue()) !== "D6") throw new Error("le mot donne n'est plus selectionne");
  const bg = await bgAt(2, 4);
  if (bg !== ROUGE) throw new Error("mot donne pas rouge alors qu'encore selectionne : " + bg);
});

await check("un mot complete avec un indice se valide (vert) tout en gardant l'indice rouge", async () => {
  await page.evaluate(() => window.__play.selectClue("across", 5)); // SIRENE, vide
  await page.click("#hintBtn");                                     // revele S en [1,9], rouge
  await page.keyboard.type("sirene");                              // complete IRENE
  if (!(await page.evaluate(() => window.__play.isOk(1, 10)))) throw new Error("le mot complete avec indice n'est pas valide");
  if (!(await page.evaluate(() => window.__play.isOk(1, 9)))) throw new Error("la case d'indice n'appartient pas au mot valide");
  if (!(await page.evaluate(() => window.__play.isGiven(1, 9)))) throw new Error("la lettre d'indice n'est plus marquee donnee (rouge)");
});

await check("un mot valide vire au vert et le jeu enchaine sur le mot suivant", async () => {
  await page.evaluate(() => window.__play.selectClue("across", 23)); // HEAUME, vide
  await page.keyboard.type("heaume");
  if (!(await page.evaluate(() => window.__play.isOk(14, 9)))) throw new Error("HEAUME non valide apres saisie");
  const first = await bgAt(14, 9), last = await bgAt(14, 14);
  if (first !== VERT) throw new Error("premiere case pas verte apres validation : " + first);
  if (last !== VERT) throw new Error("derniere case pas verte apres validation : " + last);
  const cur = await page.evaluate(() => window.__play.currentClue());
  if (!cur) throw new Error("aucun mot selectionne apres validation");
  if (cur === "A23") throw new Error("le jeu n'a pas enchaine sur le mot suivant (toujours A23)");
});

await check("completer la grille declenche la victoire", async () => {
  await page.evaluate(() => window.__play.fillSolution());
  const solved = await page.evaluate(() => window.__play.isSolved());
  if (!solved) throw new Error("la grille n'est pas reconnue resolue");
  const shown = await page.locator("#banner.show").count();
  if (shown !== 1) throw new Error("banniere de victoire absente");
});

await check("mobile : clavier integre visible, listes masquees, touche active", async () => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload();
  await page.waitForSelector("#board .cell");
  const kb = await page.evaluate(() => getComputedStyle(document.getElementById("kbd")).display);
  const aside = await page.evaluate(() => getComputedStyle(document.querySelector(".aside")).display);
  if (kb === "none") throw new Error("clavier integre masque sur mobile");
  if (aside !== "none") throw new Error("listes encore visibles sur mobile");
  // une touche du clavier integre pose une lettre dans la case courante (KOBOLD, [0,2])
  await page.click('#kbd [data-k="K"]');
  const l = await page.evaluate(() => window.__play.letterAt(0, 2));
  if (l !== "K") throw new Error("touche du clavier integre sans effet : " + l);
});

await check("mobile : la grille entiere tient dans la vue (sans defilement)", async () => {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight <= window.innerHeight + 1,
    board: (() => { const b = document.getElementById("board").getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight + 1; })()
  }));
  if (!overflow.doc) throw new Error("la page defile sur mobile");
  if (!overflow.board) throw new Error("la grille depasse de la vue");
});

await check("le double-tap-zoom est neutralise (touch-action + parade au double-appui)", async () => {
  const vals = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).touchAction,
    key: getComputedStyle(document.querySelector("#kbd .key")).touchAction
  }));
  if (!/manipulation|none/.test(vals.html)) throw new Error("html touch-action : " + vals.html);
  // les touches desactivent tout geste par defaut (none)
  if (!/none/.test(vals.key)) throw new Error("touche touch-action : " + vals.key);
});

await check("ordinateur : clavier integre masque, listes visibles", async () => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.reload();
  await page.waitForSelector("#board .cell");
  const kb = await page.evaluate(() => getComputedStyle(document.getElementById("kbd")).display);
  const aside = await page.evaluate(() => getComputedStyle(document.querySelector(".aside")).display);
  if (kb !== "none") throw new Error("clavier integre visible sur ordinateur");
  if (aside === "none") throw new Error("listes masquees sur ordinateur");
});

await check("apercu depuis l'atelier : jouer.html monte la grille passee par le stockage", async () => {
  const custom = { title: "Apercu test", rows: 1, cols: 2, solution: { "0,0": "O", "0,1": "R" }, numbers: { "0,0": 1 }, bars: {}, across: [{ num: 1, clue: "Metal *jaune*.", cells: [[0,0],[0,1]] }], down: [] };
  await page.evaluate(p => localStorage.setItem("dd-apercu", JSON.stringify(p)), custom);
  await page.reload();
  await page.waitForSelector("#board .cell");
  const n = await page.locator("#board .cell").count();
  if (n !== 2) throw new Error("apercu non monte : " + n + " cases (attendu 2)");
  const left = await page.evaluate(() => localStorage.getItem("dd-apercu"));
  if (left !== null) throw new Error("le stockage d'apercu aurait du etre vide apres lecture");
  // les asterisques de la definition sont rendues en italique
  const clueHtml = await page.evaluate(() => document.getElementById("cluebarTxt").innerHTML);
  if (!/<em>jaune<\/em>/.test(clueHtml)) throw new Error("asterisques non mises en italique : " + clueHtml);
});

await check("aucune erreur JavaScript", async () => {
  if (errs.length) throw new Error(errs.join(" | "));
});

await browser.close();
server.close();

if (failures.length) {
  console.error("\n" + failures.length + " controle(s) en echec.");
  process.exit(1);
}
console.log("\nMoteur de resolution verifie : tous les controles passent.");
