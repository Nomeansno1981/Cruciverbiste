// Anti-triche : la partie en cours (lettres + chrono) survit a un rafraichissement.
// On verifie qu'apres avoir saisi des lettres puis rechargé la page :
//   - les lettres sont restaurees (la grille ne repart pas a vide) ;
//   - le chrono repart du depart ancre cote serveur (et non de zero) ;
//   - une fois la grille resolue, le brouillon est efface (rechargement = revue).
// A lancer via : npm run test:progress
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
      : file.endsWith(".svg") ? "image/svg+xml"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch { res.writeHead(404); res.end("introuvable"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/donjons.html#emu`;

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

const browser = await launchBrowser();
const page = await browser.newPage();
page.setDefaultTimeout(30000);
const errs = [];
page.on("pageerror", e => errs.push(String(e)));

const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}
const secondsOf = t => { const m = String(t || "").match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };

async function signInAndMount(){
  // au 1er chargement, on attend le bouton de connexion actif ; apres un
  // rechargement, la session Firebase persiste et le plateau apparait direct.
  await page.waitForFunction(() => {
    const g = document.getElementById("gGoogle");
    const gatePret = g && g.offsetParent !== null && !g.disabled;
    return gatePret || document.querySelector("#board .cell");
  });
  if (await page.locator("#gGoogle:not([disabled])").isVisible().catch(() => false)) {
    await page.click("#gGoogle").catch(() => {});
  }
  try { await page.waitForSelector("#board .cell"); }
  catch (e) { if (errs.length) console.log("  (erreurs page : " + errs.join(" | ") + ")"); throw e; }
  await page.waitForFunction(() => window.__ddef && window.__ddef.profile);
}

await page.goto(url);
await signInAndMount();

let startedFirst = 0, secondsBefore = -1;

await check("le depart est ancre cote serveur des la 1re ouverture", async () => {
  await page.waitForFunction(() => window.__ddef && typeof window.__ddef.startedAtMs === "number" && window.__ddef.startedAtMs > 0);
  startedFirst = await page.evaluate(() => window.__ddef.startedAtMs);
  if (!(startedFirst > 0)) throw new Error("startedAtMs absent : " + startedFirst);
});

await check("saisie de quelques lettres puis chrono > 0", async () => {
  await page.evaluate(() => window.__play.selectClue("across", 1)); // KOBOLD, [0,2]
  await page.keyboard.type("kob");
  const l = await page.evaluate(() => [window.__play.letterAt(0,2), window.__play.letterAt(0,3), window.__play.letterAt(0,4)].join(""));
  if (l !== "KOB") throw new Error("saisie inattendue : " + l);
  // le chrono doit avancer (au moins 2 s) avant le rechargement
  await page.waitForFunction(() => { const m = String(document.getElementById("timer").textContent).match(/(\d+):(\d+)/); return m && (Number(m[1]) * 60 + Number(m[2])) >= 2; }, { timeout: 8000 });
  secondsBefore = await page.evaluate(() => window.__play.elapsedShown());
  secondsBefore = secondsOf(secondsBefore);
});

await check("vidage force de la progression (ecriture immediate)", async () => {
  await page.evaluate(() => window.__ddef.flushProgress());
});

// --- rechargement : c'est ici que se joue l'anti-triche ---------------------
await check("apres rechargement : lettres restaurees, grille toujours jouable", async () => {
  await page.reload();
  await signInAndMount();
  const l = await page.evaluate(() => [window.__play.letterAt(0,2), window.__play.letterAt(0,3), window.__play.letterAt(0,4)].join(""));
  if (l !== "KOB") throw new Error("lettres non restaurees apres rechargement : « " + l + " »");
  const review = await page.evaluate(() => window.__play.isReview());
  if (review) throw new Error("la grille est passee en revue alors qu'elle n'est pas resolue");
});

await check("apres rechargement : meme depart serveur, chrono repris (jamais remis a zero)", async () => {
  const startedAgain = await page.evaluate(() => window.__ddef.startedAtMs);
  if (startedAgain !== startedFirst) throw new Error("le depart a change au rechargement : " + startedFirst + " -> " + startedAgain);
  const after = secondsOf(await page.evaluate(() => window.__play.elapsedShown()));
  if (after < 2) throw new Error("le chrono est reparti de zero (" + after + " s)");
  if (after < secondsBefore) throw new Error("le chrono a recule : " + secondsBefore + " -> " + after);
});

await check("resolution : le brouillon de progression est efface (rechargement = revue)", async () => {
  await page.waitForFunction(() => window.__ddef && window.__ddef.ready);
  await page.evaluate(() => window.__play.fillSolution());
  await page.waitForFunction(() => window.__ddef && window.__ddef.result);
  // fermer l'ecran de fin s'il s'affiche
  await page.evaluate(() => { const b = document.getElementById("closeBadge"); if (b) b.click(); });
  await page.reload();
  await signInAndMount();
  const review = await page.evaluate(() => window.__play.isReview());
  if (!review) throw new Error("la grille resolue ne se rouvre pas en revue (brouillon non efface ?)");
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
console.log("\nProgression continue verifiee : la partie survit au rafraichissement.");
