// Test de l'autorité serveur sur le classement (Cloud Function + règles), sur
// les émulateurs auth + firestore + functions. On vérifie que :
//   1. écrire un résultat fait calculer le total côté serveur (la Function écrit
//      /leaderboard à partir des résultats) ;
//   2. un second résultat met le total à jour (recalcul, ventilation par mois) ;
//   3. un joueur ne peut PLUS forger sa propre fiche /leaderboard (règles) ;
//   4. supprimer un résultat fait redescendre le total (recalcul).
// À lancer via : npm run test:classement
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
    const file = clean === "/" ? "donjons.html" : clean.slice(1);
    const fsPath = file.startsWith("firebasejs/") ? path.join(vendorDir, file.slice("firebasejs/".length)) : path.join(root, file);
    const data = await readFile(fsPath);
    const type = file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : file.endsWith(".css") ? "text/css; charset=utf-8"
      : file.endsWith(".svg") ? "image/svg+xml"
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
    if (existsSync(base)) for (const d of readdirSync(base)) for (const p of [path.join(base, d, "chrome-linux", "chrome"), path.join(base, d, "chrome-linux", "headless_shell")]) if (existsSync(p)) candidates.push(p);
    candidates.push("/opt/pw-browsers/chromium");
    for (const exe of candidates) { try { return await chromium.launch({ ...opts, executablePath: exe }); } catch {} }
    throw first;
  }
}

const browser = await launchBrowser();
const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}
const errs = [];
const player = await (await browser.newContext()).newPage();
player.setDefaultTimeout(30000);
player.on("pageerror", e => errs.push("player: " + e));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const probe = fn => player.evaluate(fn);

// Lit la fiche de classement du joueur jusqu'à ce qu'elle satisfasse `pred`
// (la Cloud Function écrit de façon asynchrone après le résultat).
async function waitBoard(pred, label, tries = 40, delay = 400){
  let last = null;
  for (let i = 0; i < tries; i++){
    last = await probe(() => window.__ddef.classementProbe.readMine());
    if (last && !last.err && pred(last)) return last;
    await sleep(delay);
  }
  throw new Error(label + " — dernière lecture : " + JSON.stringify(last));
}

await check("le joueur se connecte sur le jeu", async () => {
  await player.goto(`${origin}/donjons.html#emu`);
  await player.waitForSelector("#gGoogle:not([disabled])");
  await player.click("#gGoogle");
  // Connexion aboutie quand la sonde ne renvoie plus « no-user »
  let ok = false;
  for (let i = 0; i < 40; i++){
    const r = await probe(() => (window.__ddef && window.__ddef.classementProbe) ? window.__ddef.classementProbe.readMine() : Promise.resolve({ err: "no-probe" }));
    if (r === null || (r && !r.err)) { ok = true; break; }
    await sleep(400);
  }
  if (!ok) throw new Error("connexion joueur non aboutie");
});

await check("écrire un résultat fait calculer le total côté serveur", async () => {
  const w = await probe(() => window.__ddef.classementProbe.writeResult("2026-06-10", 100));
  if (w !== "ok") throw new Error("écriture du résultat refusée : " + w);
  const b = await waitBoard(b => b.total === 100, "le classement serveur n'a pas atteint 100");
  if (b.months["2026-06"] !== 100) throw new Error("XP du mois absente/incorrecte : " + JSON.stringify(b.months));
});

await check("un second résultat met le total à jour (recalcul serveur)", async () => {
  const w = await probe(() => window.__ddef.classementProbe.writeResult("2026-06-11", 50));
  if (w !== "ok") throw new Error("écriture du 2e résultat refusée : " + w);
  const b = await waitBoard(b => b.total === 150, "le total n'a pas été recalculé à 150");
  if (b.months["2026-06"] !== 150) throw new Error("XP du mois non cumulée : " + JSON.stringify(b.months));
});

await check("un joueur ne peut plus forger sa propre fiche de classement", async () => {
  const w = await probe(() => window.__ddef.classementProbe.forgeOwn(999999));
  if (!/denied|permission/i.test(String(w))) throw new Error("la forge de sa propre fiche aurait dû être refusée, obtenu : " + w);
  // et le total réel reste celui calculé par le serveur
  await sleep(600);
  const b = await probe(() => window.__ddef.classementProbe.readMine());
  if (!b || b.total !== 150) throw new Error("le total a été altéré par la tentative de forge : " + JSON.stringify(b));
});

await check("supprimer un résultat fait redescendre le total (recalcul serveur)", async () => {
  const d = await probe(() => window.__ddef.classementProbe.deleteResult("2026-06-11"));
  if (d !== "ok") throw new Error("suppression du résultat refusée : " + d);
  await waitBoard(b => b.total === 100, "le total n'est pas redescendu à 100 après suppression");
});

await check("aucune erreur JavaScript", async () => {
  if (errs.length) throw new Error(errs.join(" | "));
});

await browser.close();
server.close();
if (failures.length) { console.error("\n" + failures.length + " controle(s) en echec."); process.exit(1); }
console.log("\nAutorite serveur du classement verifiee : tous les controles passent.");
