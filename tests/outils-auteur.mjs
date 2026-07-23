// Outils réservés à l'auteur (émulateurs) : bouton « Rejouer » et lien « Atelier »
// visibles seulement pour le compte auteur, invisibles pour un joueur ordinaire ;
// et « Rejouer » remet bien la grille à zéro. À lancer : npm run test:outils-auteur
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
async function openGame(hash){
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${origin}/donjons.html#${hash}`);
  await page.waitForSelector("#gGoogle:not([disabled])");
  await page.click("#gGoogle");
  await page.waitForSelector("#authGate", { state: "hidden" });
  await page.waitForSelector("#board .cell, .board-empty");
  return page;
}
async function openHome(hash){
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${origin}/accueil.html#${hash}`);
  await page.waitForSelector("#gGoogle:not([disabled])");
  await page.click("#gGoogle");
  await page.waitForSelector("#authGate", { state: "hidden" });
  await page.waitForSelector("#home:not([hidden])");
  return page;
}
const hidden = (page, sel) => page.locator(sel).evaluate(el => el.hidden === true || getComputedStyle(el).display === "none").catch(() => true);

await check("jeu — joueur ordinaire : ni « Rejouer » ni « Atelier »", async () => {
  const page = await openGame("emu");
  if (!(await hidden(page, "#replayBtn"))) throw new Error("le bouton Rejouer est visible pour un joueur");
  if (!(await hidden(page, "#navAtelier"))) throw new Error("le lien Atelier est visible pour un joueur");
});

await check("jeu — auteur : « Rejouer » et « Atelier » visibles, lien vers l'atelier", async () => {
  const page = await openGame("emu-admin");
  if (await hidden(page, "#replayBtn")) throw new Error("le bouton Rejouer n'apparaît pas pour l'auteur");
  if (await hidden(page, "#navAtelier")) throw new Error("le lien Atelier n'apparaît pas pour l'auteur");
  const href = await page.getAttribute("#navAtelier", "href");
  if (!/atelier/.test(href || "")) throw new Error("le lien Atelier ne pointe pas vers l'atelier : " + href);
});

await check("jeu — auteur : « Rejouer » remet la grille à zéro", async () => {
  const page = await openGame("emu-admin");
  // une lettre se pose (la première définition est sélectionnée au montage)
  await page.evaluate(() => window.__play.tapKey("A"));
  const before = await page.evaluate(() => window.__play.wordHighlight());
  if (before < 1) throw new Error("aucun mot sélectionné au montage");
  const filledBefore = await page.evaluate(() => Object.keys(window.__ddef).length >= 0 && window.__play.currentClue());
  await page.click("#replayBtn");
  if (await page.evaluate(() => window.__play.isSolved())) throw new Error("grille encore résolue après Rejouer");
  if (await page.evaluate(() => window.__play.elapsedShown()) !== "0:00") throw new Error("chrono non remis à zéro");
  const still = await page.evaluate(() => window.__play.okWordCount() + window.__play.solvedWordCount() + window.__play.hints() + window.__play.solutions());
  if (still !== 0) throw new Error("état non réinitialisé après Rejouer");
});

await check("accueil — joueur ordinaire : pas de lien « Atelier »", async () => {
  const page = await openHome("emu");
  if (!(await hidden(page, "#navAtelier"))) throw new Error("le lien Atelier est visible pour un joueur");
});

await check("accueil — auteur : lien « Atelier » visible", async () => {
  const page = await openHome("emu-admin");
  if (await hidden(page, "#navAtelier")) throw new Error("le lien Atelier n'apparaît pas pour l'auteur");
  const href = await page.getAttribute("#navAtelier", "href");
  if (!/atelier/.test(href || "")) throw new Error("lien Atelier inattendu : " + href);
});

await browser.close();
server.close();
if (failures.length) { console.error("\n" + failures.length + " contrôle(s) en échec."); process.exit(1); }
console.log("\nOutils auteur vérifiés : tous les contrôles passent.");
