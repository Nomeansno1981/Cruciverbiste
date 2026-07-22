// Publication directe depuis l'atelier unifié (émulateurs) : l'auteur (admin)
// génère une grille, la publie au jeu, elle apparaît dans l'onglet « Grilles
// publiées », et le joueur la reçoit sur donjons.html.
// À lancer via : npm run test:atelier-publish
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
    const type = file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : file.endsWith(".css") ? "text/css; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch { res.writeHead(404); res.end("introuvable"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

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
      try { return await chromium.launch({ ...opts, executablePath: exe }); } catch { /* suivant */ }
    }
    throw first;
  }
}

const parisDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const browser = await launchBrowser();
const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}

const auteur = await (await browser.newContext()).newPage();
const joueur = await (await browser.newContext()).newPage();
auteur.setDefaultTimeout(30000); joueur.setDefaultTimeout(30000);
const errs = [];
auteur.on("pageerror", e => errs.push("auteur: " + e));
joueur.on("pageerror", e => errs.push("joueur: " + e));

await check("l'auteur ouvre l'atelier et génère une grille", async () => {
  await auteur.goto(`${origin}/#emu`);
  await auteur.waitForSelector("#loginBtn:not([hidden])");
  await auteur.click("#loginBtn");
  await auteur.waitForSelector("#authGate", { state: "hidden" });
  await auteur.click("#tabGrids");
  await auteur.waitForSelector("#board svg g.cell", { state: "visible" });
});

await check("« Publier au jeu » écrit la grille du jour dans le jeu", async () => {
  await auteur.click("#publishGame");
  await auteur.waitForSelector("#publishBox:not([hidden])");
  const d = await auteur.inputValue("#pubDate");
  if (d !== parisDate) throw new Error("date préremplie inattendue : " + d + " (attendu " + parisDate + ")");
  await auteur.click("#pubConfirm");
  await auteur.waitForFunction(() => /publiée|refusée/i.test(document.getElementById("pubMsg").textContent), { timeout: 15000 });
  const msg = await auteur.evaluate(() => document.getElementById("pubMsg").textContent);
  if (!/publiée/i.test(msg)) throw new Error("publication non confirmée : " + msg);
});

await check("la grille apparaît dans l'onglet « Grilles publiées »", async () => {
  await auteur.click("#tabPub");
  await auteur.waitForSelector("#pubList li .d");
  const dates = await auteur.locator("#pubList li .d").allInnerTexts();
  if (!dates.includes(parisDate)) throw new Error("date absente de la liste : " + dates.join(", "));
});

await check("le joueur reçoit la grille publiée (et non la démonstration)", async () => {
  await joueur.goto(`${origin}/donjons.html#emu`);
  await joueur.waitForSelector("#gGoogle:not([disabled])");
  await joueur.click("#gGoogle");
  await joueur.waitForSelector("#authGate", { state: "hidden" });
  await joueur.waitForSelector("#board .cell");
  const src = await joueur.evaluate(() => window.__ddef.source);
  if (src !== "firestore") throw new Error("source de la grille : " + src + " (attendu firestore)");
});

await check("« Éditer » corrige le titre et une définition d'une grille publiée", async () => {
  await auteur.click("#tabPub");
  await auteur.waitForSelector("#pubList li .pub-del");
  await auteur.locator("#pubList button", { hasText: "Éditer" }).first().click();
  await auteur.waitForSelector("#editPubBox:not([hidden])");
  await auteur.fill("#editPubTitle", "Titre corrigé");
  await auteur.locator("#editClueList input").first().fill("Définition corrigée (test)");
  await auteur.click("#editPubSave");
  // succès : la liste se réaffiche avec le titre corrigé
  await auteur.waitForFunction(() => {
    const t = document.querySelector("#pubList li .t");
    return t && t.textContent === "Titre corrigé";
  }, { timeout: 15000 });
  // la correction a persisté : on rouvre l'éditeur et on relit la définition
  await auteur.locator("#pubList button", { hasText: "Éditer" }).first().click();
  await auteur.waitForSelector("#editPubBox:not([hidden])");
  const val = await auteur.locator("#editClueList input").first().inputValue();
  if (val !== "Définition corrigée (test)") throw new Error("définition non persistée : " + val);
  // le joueur reçoit bien la définition corrigée
  await joueur.reload();
  await joueur.waitForSelector("#board .cell");
  const clues = await joueur.evaluate(() => {
    const p = window.__ddef && window.__ddef.puzzle;
    return p ? p.across.concat(p.down).map(w => w.clue) : [];
  });
  if (!clues.includes("Définition corrigée (test)")) throw new Error("définition corrigée absente côté joueur : " + JSON.stringify(clues));
});

await check("aucune erreur JavaScript", async () => {
  if (errs.length) throw new Error(errs.join(" | "));
});

await browser.close();
server.close();

if (failures.length) {
  console.error("\n" + failures.length + " contrôle(s) en échec.");
  process.exit(1);
}
console.log("\nPublication depuis l'atelier vérifiée : tous les contrôles passent.");
