// Test du circuit de publication sur les emulateurs Firebase : l'auteur publie
// une grille depuis publier.html, un joueur la recoit sur donjons.html, et un
// compte non administrateur n'a pas acces a la publication.
// A lancer via : npm run test:publish
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
const sdkFiles = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-functions.js"];
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
    const file = clean === "/" ? "donjons.html" : clean.slice(1);
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
const PUZZLE = { title: "Test", rows: 1, cols: 2, solution: { "0,0": "O", "0,1": "R" }, numbers: { "0,0": 1 }, bars: {}, across: [{ num: 1, clue: "Metal jaune.", cells: [[0,0],[0,1]] }], down: [] };

const browser = await launchBrowser();
const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}

const admin = await (await browser.newContext()).newPage();
const player = await (await browser.newContext()).newPage();
const guest = await (await browser.newContext()).newPage();
admin.setDefaultTimeout(30000); player.setDefaultTimeout(30000); guest.setDefaultTimeout(30000);
const errs = [];
for (const [p, tag] of [[admin, "admin"], [player, "player"], [guest, "guest"]]) p.on("pageerror", e => errs.push(tag + ": " + e));

await check("l'auteur publie la grille du jour", async () => {
  await admin.goto(`${origin}/publier.html#emu`);
  await admin.waitForSelector("#gGoogle:not([disabled])");
  await admin.click("#gGoogle");
  await admin.waitForSelector("#adminPanel:not([hidden])");
  await admin.fill("#pjson", JSON.stringify(PUZZLE));
  await admin.fill("#pdate", parisDate);
  await admin.click("#publishBtn");
  try{
    await admin.waitForFunction(() => /publiee|refusee/i.test(document.getElementById("pmsg").textContent), { timeout: 15000 });
  }catch(e){ /* on lira le message ci-dessous */ }
  const msg = await admin.evaluate(() => document.getElementById("pmsg").textContent);
  const prov = await admin.evaluate(async () => { try{ const r = await window.__admin.provider(); return r; }catch(e){ return "?"; } });
  if(!/publiee/i.test(msg)) throw new Error("publication non confirmee. message='" + msg + "' provider='" + prov + "'");
  const pub = await admin.evaluate(() => window.__admin.lastPublished);
  if (!pub || !pub.puzzle || pub.puzzle.solution["0,0"] !== "O") throw new Error("grille non enregistree : " + JSON.stringify(pub));
});

await check("le joueur recoit la grille publiee (et non la demonstration)", async () => {
  await player.goto(`${origin}/donjons.html#emu`);
  await player.waitForSelector("#gGoogle:not([disabled])");
  await player.click("#gGoogle");
  await player.waitForSelector("#authGate", { state: "hidden" });
  await player.waitForSelector("#board .cell");
  const src = await player.evaluate(() => window.__ddef.source);
  if (src !== "firestore") throw new Error("source de la grille : " + src + " (attendu firestore)");
  const n = await player.locator("#board .cell").count();
  if (n !== 2) throw new Error("grille du jour non chargee : " + n + " cases (attendu 2)");
});

await check("un compte non administrateur ne peut pas publier (UI et regles)", async () => {
  await guest.goto(`${origin}/publier.html#emu-guest`);
  await guest.waitForSelector("#gGoogle:not([disabled])");
  await guest.click("#gGoogle");
  await guest.waitForFunction(() => window.__admin && (window.__admin.role === "admin" || window.__admin.role === "guest"));
  const role = await guest.evaluate(() => window.__admin.role);
  if (role !== "guest") throw new Error("role inattendu : " + role);
  await guest.waitForSelector("#guestPanel:not([hidden])");
  const res = await guest.evaluate(() => window.__admin.tryWrite());
  if (!/denied|permission/i.test(res)) throw new Error("l'ecriture d'un non-admin aurait du etre refusee, obtenu : " + res);
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
console.log("\nCircuit de publication verifie : tous les controles passent.");
