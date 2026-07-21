// Revue en lecture seule (émulateurs) : un joueur résout la grille du jour en
// utilisant un indice et une solution ; en la rouvrant, il retrouve sa grille
// complétée, les cases dévoilées en rouge, le reste en vert, sans pouvoir saisir.
// À lancer : npm run test:revue
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SDK_VERSION = "12.8.0";
const vendorDir = path.join(root, "tests", "vendor", "firebasejs");
const sdkFiles = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"];
if (sdkFiles.some(f => !existsSync(path.join(vendorDir, f)))) {
  mkdirSync(vendorDir, { recursive: true });
  for (const f of sdkFiles) {
    execSync(`curl -sf -o "${path.join(vendorDir, f)}" "https://www.gstatic.com/firebasejs/${SDK_VERSION}/${f}"`);
    const p = path.join(vendorDir, f);
    writeFileSync(p, readFileSync(p, "utf8").replaceAll(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`, "./firebase-app.js"));
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const clean = (req.url || "/").split("?")[0];
    const file = clean === "/" ? "index.html" : clean.slice(1);
    const fsPath = file.startsWith("firebasejs/") ? path.join(vendorDir, file.slice("firebasejs/".length)) : path.join(root, file);
    const data = await readFile(fsPath);
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "content-type": type }); res.end(data);
  } catch { res.writeHead(404); res.end("introuvable"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
async function launchBrowser(){
  const opts = { chromiumSandbox: false };
  try { return await chromium.launch(opts); }
  catch (first) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    const cands = [];
    if (existsSync(base)) for (const d of readdirSync(base)) for (const p of [path.join(base,d,"chrome-linux","chrome"), path.join(base,d,"chrome-linux","headless_shell")]) if (existsSync(p)) cands.push(p);
    cands.push("/opt/pw-browsers/chromium");
    for (const exe of cands) { try { return await chromium.launch({ ...opts, executablePath: exe }); } catch {} }
    throw first;
  }
}
const browser = await launchBrowser();
const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(25000);
const errs = []; page.on("pageerror", e => errs.push(String(e)));

await page.goto(`${origin}/donjons.html#emu`);
await page.waitForSelector("#gGoogle:not([disabled])");
await page.click("#gGoogle");
await page.waitForSelector("#authGate", { state: "hidden" });
await page.waitForSelector("#board .cell");

await check("résolution avec un indice (A1) et une solution (D6), puis victoire", async () => {
  // grille de démonstration : A1 = KOBOLD, D6 = MAGE
  await page.evaluate(() => window.__play.selectClue("across", 1));
  await page.click("#hintBtn");                                   // révèle une lettre de KOBOLD (donnée, rouge)
  await page.evaluate(() => window.__play.selectClue("down", 6));
  await page.click("#solveBtn");                                  // révèle MAGE en entier (rouge)
  await page.evaluate(() => window.__play.fillSolution());        // complète le reste → victoire
  if (!(await page.evaluate(() => window.__play.isSolved()))) throw new Error("la grille n'est pas résolue");
  await page.waitForFunction(() => window.__ddef.result && Array.isArray(window.__ddef.result.given));
  const r = await page.evaluate(() => window.__ddef.result);
  if (!r.given.length) throw new Error("aucune case d'indice enregistrée");
  if (!(r.solvedWords || []).includes("D6")) throw new Error("mot donné (D6) non enregistré : " + JSON.stringify(r.solvedWords));
});

await check("réouverture : revue en lecture seule (isReview, grille complétée)", async () => {
  await page.reload();
  // l'auth persiste généralement au reload : on remonte directement. Le bouton
  // « Se connecter » reste dans le DOM même quand l'écran de connexion est masqué
  // (un count() est donc trompeur, d'où l'ancien timeout) : on ne reclique que
  // s'il est réellement visible, et on ignore l'échec si l'auth se résout entre-temps.
  if (await page.locator("#gGoogle").isVisible().catch(() => false)) {
    await page.click("#gGoogle").catch(() => {});
  }
  await page.waitForSelector("#board .cell");
  await page.waitForFunction(() => window.__play && window.__play.isReview && window.__play.isReview());
  if (!(await page.evaluate(() => window.__ddef.review))) throw new Error("le mode revue n'est pas signalé");
  // grille complétée : une case connue porte sa lettre
  if (await page.evaluate(() => window.__play.letterAt(0, 2)) !== "K") throw new Error("la grille n'est pas complétée (case 0,2)");
});

await check("revue : cases dévoilées en rouge, reste en vert", async () => {
  // A1 (KOBOLD, cases (0,2)→(0,7)) a reçu un indice sur UNE case au hasard (l'indice
  // n'est plus déterministe) : cette case est « donnée » (lettre rouge) et tout le
  // mot reste « ok » (fond vert), les autres cases ayant été trouvées par le joueur.
  const kob = await page.evaluate(() => [[0,2],[0,3],[0,4],[0,5],[0,6],[0,7]]
    .map(([r,c]) => ({ r, c, given: window.__play.isGiven(r,c), ok: window.__play.isOk(r,c) })));
  const givens = kob.filter(x => x.given);
  if (givens.length !== 1) throw new Error("attendu exactement une case d'indice (rouge) dans KOBOLD, obtenu " + givens.length + " : " + JSON.stringify(kob));
  if (!kob.every(x => x.ok)) throw new Error("tout le mot d'indice devrait rester vert (ok) : " + JSON.stringify(kob));
  // D6 (MAGE) donné en entier par « Solution » → cases au fond rouge (solved)
  if (!(await page.evaluate(() => window.__play.isSolvedCell(3, 4)))) throw new Error("le mot donné n'est pas marqué rouge");
  const bg = await page.evaluate(() => document.querySelectorAll("#board .cell.solved").length);
  if (bg < 1) throw new Error("aucune case au fond rouge (solved)");
});

await check("revue : lecture seule — pas de clavier, pas d'indice, saisie sans effet", async () => {
  if (!(await page.locator("#kbd").evaluate(el => getComputedStyle(el).display === "none"))) throw new Error("le clavier est visible en revue");
  if (!(await page.locator("#hintBtn").evaluate(el => el.hidden))) throw new Error("le bouton Indice est visible en revue");
  if (!(await page.locator("#solveBtn").evaluate(el => el.hidden))) throw new Error("le bouton Solution est visible en revue");
  // taper ne modifie rien
  const before = await page.evaluate(() => window.__play.letterAt(0, 3));
  await page.evaluate(() => { window.__play.selectClue("across", 1); window.__play.tapKey("Z"); });
  const after = await page.evaluate(() => window.__play.letterAt(0, 3));
  if (before !== after) throw new Error("la saisie a modifié la grille en revue (" + before + " → " + after + ")");
});

await check("aucune erreur JavaScript", async () => {
  if (errs.length) throw new Error(errs.join(" | "));
});

await browser.close();
server.close();
if (failures.length) { console.error("\n" + failures.length + " contrôle(s) en échec."); process.exit(1); }
console.log("\nRevue en lecture seule vérifiée : tous les contrôles passent.");
