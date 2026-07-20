// Onglets de l'atelier (mode #local, onglets actifs) : bascule entre
// Dictionnaire, Grilles et Grilles publiées. Le comportement fonctionnel est
// couvert par smoke.mjs (mode déplié) ; ici on ne vérifie que la navigation.
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
    const file = clean === "/" ? "index.html" : clean.slice(1);
    const data = await readFile(path.join(root, file));
    res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("introuvable"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/#local`;

async function launchBrowser(){
  const opts = { chromiumSandbox: false };
  try { return await chromium.launch(opts); }
  catch (first) {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    const candidates = [];
    if (existsSync(base)) {
      for (const d of readdirSync(base)) {
        for (const p of [path.join(base, d, "chrome-linux", "chrome"), path.join(base, d, "chrome-linux", "headless_shell")]) {
          if (existsSync(p)) candidates.push(p);
        }
      }
    }
    candidates.push("/opt/pw-browsers/chromium");
    for (const exe of candidates) {
      try { return await chromium.launch({ ...opts, executablePath: exe }); } catch { /* candidat suivant */ }
    }
    throw first;
  }
}

const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(20000);
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e)));

const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}

await page.goto(url);
await page.waitForSelector("#entries .entry");   // atelier chargé, onglet Dictionnaire actif

await check("au départ : Dictionnaire visible, Grilles masqué, barre d'onglets présente", async () => {
  if (await page.locator("#paneDict").isVisible() !== true) throw new Error("Dictionnaire devrait être visible");
  if (await page.locator("#paneGrids").isVisible() !== false) throw new Error("Grilles devrait être masqué");
  if (await page.locator(".tabs").isVisible() !== true) throw new Error("barre d'onglets absente");
  if (await page.locator("#tabDict").getAttribute("aria-selected") !== "true") throw new Error("onglet Dictionnaire non marqué actif");
});

await check("onglet Grilles : le plateau devient visible", async () => {
  await page.click("#tabGrids");
  await page.waitForSelector("#board svg g.cell", { state: "visible" });
  if (await page.locator("#paneDict").isVisible() !== false) throw new Error("Dictionnaire aurait dû se masquer");
  if (await page.locator("#tabGrids").getAttribute("aria-selected") !== "true") throw new Error("onglet Grilles non actif");
});

await check("onglet Grilles publiées : hors ligne, invite à se connecter", async () => {
  await page.click("#tabPub");
  await page.waitForSelector("#panePub:not([hidden])");
  const txt = await page.locator("#pubList").innerText();
  if (!/connect/i.test(txt)) throw new Error("message attendu sur la connexion, obtenu : " + txt);
});

await check("retour à Dictionnaire", async () => {
  await page.click("#tabDict");
  if (await page.locator("#paneGrids").isVisible() !== false) throw new Error("Grilles aurait dû se masquer");
  if (await page.locator("#entries .entry").first().isVisible() !== true) throw new Error("entrées du dictionnaire masquées");
});

await check("aucune erreur JavaScript", async () => {
  if (pageErrors.length) throw new Error(pageErrors.join(" | "));
});

await browser.close();
server.close();

if (failures.length) {
  console.error("\n" + failures.length + " contrôle(s) en échec.");
  process.exit(1);
}
console.log("\nOnglets vérifiés : tous les contrôles passent.");
