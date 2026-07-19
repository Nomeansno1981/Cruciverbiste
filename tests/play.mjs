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

await check("Verifier signale les cases fausses", async () => {
  await page.evaluate(() => window.__play.selectClue("across", 9)); // RUNE
  await page.keyboard.type("zzzz");
  await page.click("#checkBtn");
  const bad = await page.locator("#board .cell.bad").count();
  if (bad < 1) throw new Error("aucune case signalee fausse");
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

await check("le double-tap-zoom est neutralise (touch-action manipulation)", async () => {
  const vals = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).touchAction,
    key: getComputedStyle(document.querySelector("#kbd .key")).touchAction
  }));
  if (!/manipulation/.test(vals.html)) throw new Error("html touch-action : " + vals.html);
  if (!/manipulation/.test(vals.key)) throw new Error("touche touch-action : " + vals.key);
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
