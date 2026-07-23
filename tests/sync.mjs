// Test de synchronisation en ligne : deux navigateurs isolés (les deux Macs
// simulés) partagent le même compte via les émulateurs Firebase (Auth +
// Firestore). À lancer via : npm run test:sync
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// En mode #emu la page importe le SDK depuis ./firebasejs/ : on télécharge une
// copie locale (une seule fois) et on réécrit son import interne absolu en relatif.
const SDK_VERSION = "12.8.0";
const vendorDir = path.join(root, "tests", "vendor", "firebasejs");
const sdkFiles = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-functions.js"];
if (sdkFiles.some(f => !existsSync(path.join(vendorDir, f)))) {
  mkdirSync(vendorDir, { recursive: true });
  for (const f of sdkFiles) {
    execSync(`curl -sf -o "${path.join(vendorDir, f)}" "https://www.gstatic.com/firebasejs/${SDK_VERSION}/${f}"`);
    const p = path.join(vendorDir, f);
    writeFileSync(p, readFileSync(p, "utf8").replaceAll(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`, "./firebase-app.js"));
  }
  console.log("SDK Firebase téléchargé dans tests/vendor/firebasejs/");
}

const server = http.createServer(async (req, res) => {
  try {
    const clean = (req.url || "/").split("?")[0];
    const file = clean === "/" ? "index.html" : clean.slice(1);
    const fsPath = file.startsWith("firebasejs/") ? path.join(vendorDir, file.slice("firebasejs/".length)) : path.join(root, file);
    const data = await readFile(fsPath);
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("introuvable");
  }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/#emu-flat`;

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
const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}

const ctxA = await browser.newContext();   // « iMac »
const ctxB = await browser.newContext();   // « MacBook Air »
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
pageA.setDefaultTimeout(30000);
pageB.setDefaultTimeout(30000);
const errsA = [], errsB = [];
pageA.on("pageerror", e => errsA.push(String(e)));
pageB.on("pageerror", e => errsB.push(String(e)));

async function openAndLogin(page){
  await page.goto(url);
  await page.waitForSelector("#loginBtn:not([hidden])");
  await page.click("#loginBtn");
  await page.waitForSelector("#authGate", { state: "hidden" });
}

await check("premier navigateur : connexion et reprise de la liste d'exemple", async () => {
  await openAndLogin(pageA);
  await pageA.waitForSelector("#entries .entry");
  const n = await pageA.locator("#entries .entry").count();
  if (n !== 12) throw new Error("attendu 12 entrées, obtenu " + n);
});

await check("le compte connecté est affiché dans l'entête", async () => {
  const mail = await pageA.locator("#accountMail").innerText();
  if (!mail.includes("nominesnow@gmail.com")) throw new Error("compte affiché : " + mail);
});

await check("ajout d'un mot sur le premier navigateur", async () => {
  await pageA.fill("#wIn", "banquise");
  await pageA.fill("#cIn", "La plaque de glace flottante");
  await pageA.click("#addBtn");
  const n = await pageA.locator("#entries .entry").count();
  if (n !== 13) throw new Error("attendu 13, obtenu " + n);
});

await check("second navigateur : les données arrivent sans aucun import", async () => {
  await new Promise(r => setTimeout(r, 1200));
  await openAndLogin(pageB);
  await pageB.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 13);
  const has = await pageB.locator("#entries .entry").filter({ hasText: "banquise" }).count();
  if (has !== 1) throw new Error("banquise introuvable sur le second navigateur");
});

await check("ajout sur le second navigateur, répercuté en direct sur le premier", async () => {
  await pageB.fill("#wIn", "toundra");
  await pageB.click("#addBtn");
  await pageA.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 14);
});

await check("grille enregistrée sur un navigateur, visible sur l'autre", async () => {
  await pageA.waitForSelector("#board svg g.cell");
  await pageA.click("#saveGrid");
  await pageA.waitForSelector("#savedList .saved-row");
  await pageB.waitForFunction(() => document.querySelectorAll("#savedList .saved-row").length === 1);
});

await check("suppression de la grille sur l'autre navigateur, répercutée en retour", async () => {
  await pageB.hover("#savedList .saved-row");
  await pageB.click("#savedList .saved-row .icon-btn.del");
  await pageA.waitForFunction(() => document.querySelectorAll("#savedList .saved-row").length === 0);
});

await check("définition rédigée depuis une grille synchronisée entre navigateurs", async () => {
  await pageA.fill("#wIn", "sérac");
  await pageA.click("#addBtn");
  await pageA.click("#genBtn");
  await pageA.waitForSelector("#board svg g.cell");
  const inp = pageA.locator('.clues .definebox input[placeholder*="SÉRAC"]');
  if (await inp.count() === 1) {
    await inp.fill("Le bloc de glace du glacier");
    await inp.press("Enter");
  } else {
    // le mot n'a pas été placé dans cette grille : on définit depuis le dictionnaire
    const row = pageA.locator("#entries .entry").filter({ hasText: "sérac" });
    await row.hover({ timeout: 8000 });
    await row.locator(".edit").click();
    await pageA.locator(".entry-editor .cluerow input").last().fill("Le bloc de glace du glacier");
    await pageA.click(".entry-editor .btn-primary");
  }
  await pageB.waitForFunction(() => {
    const rows = [...document.querySelectorAll("#entries .entry")];
    const r = rows.find(x => x.textContent.includes("sérac"));
    return r && r.textContent.includes("1 définition");
  });
});

await check("aucune erreur JavaScript sur les deux navigateurs", async () => {
  const all = errsA.concat(errsB);
  if (all.length) throw new Error(all.join(" | "));
});

await browser.close();
server.close();

if (failures.length) {
  console.error("\n" + failures.length + " contrôle(s) en échec.");
  process.exit(1);
}
console.log("\nSynchronisation vérifiée : tous les contrôles passent.");
