// Test de la page d'accueil (accueil.html) sur les emulateurs : l'auteur publie
// deux grilles (une ancienne, une du jour), le joueur resout celle du jour, puis
// l'accueil affiche la grille du jour comme resolue, la serie, les points, le
// compte a rebours et la liste des grilles precedentes (faites / pas faites).
// A lancer via : npm run test:accueil
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
    const file = clean === "/" ? "accueil.html" : clean.slice(1);
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
    if (existsSync(base)) for (const d of readdirSync(base)) for (const p of [path.join(base, d, "chrome-linux", "chrome"), path.join(base, d, "chrome-linux", "headless_shell")]) if (existsSync(p)) candidates.push(p);
    candidates.push("/opt/pw-browsers/chromium");
    for (const exe of candidates) { try { return await chromium.launch({ ...opts, executablePath: exe }); } catch {} }
    throw first;
  }
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const [Y, M, D] = today.split("-").map(Number);
const pd = new Date(Date.UTC(Y, M - 1, D)); pd.setUTCDate(pd.getUTCDate() - 10);
const pastDate = pd.toISOString().slice(0, 10);
const PUZZLE = { title: "Grille test", rows: 1, cols: 2, solution: { "0,0": "O", "0,1": "R" }, numbers: { "0,0": 1 }, bars: {}, across: [{ num: 1, clue: "Metal jaune.", cells: [[0,0],[0,1]] }], down: [] };

const browser = await launchBrowser();
const failures = [];
async function check(name, fn){
  try { await fn(); console.log("ok     " + name); }
  catch (err) { failures.push(name); console.log("ÉCHEC  " + name + " : " + (err && err.message ? err.message : err)); }
}
const errs = [];
const admin = await (await browser.newContext()).newPage();
const player = await (await browser.newContext()).newPage();
admin.setDefaultTimeout(30000); player.setDefaultTimeout(30000);
admin.on("pageerror", e => errs.push("admin: " + e));
player.on("pageerror", e => errs.push("player: " + e));

await check("l'auteur publie une grille ancienne puis celle du jour", async () => {
  await admin.goto(`${origin}/publier.html#emu`);
  await admin.waitForSelector("#gGoogle:not([disabled])");
  await admin.click("#gGoogle");
  await admin.waitForSelector("#adminPanel:not([hidden])");
  for (const date of [pastDate, today]) {
    await admin.evaluate(() => { document.getElementById("pmsg").textContent = ""; });
    await admin.fill("#pjson", JSON.stringify(PUZZLE));
    await admin.fill("#pdate", date);
    await admin.click("#publishBtn");
    await admin.waitForFunction(() => /publiee|refusee|erreur/i.test(document.getElementById("pmsg").textContent), { timeout: 15000 });
    const msg = await admin.evaluate(() => document.getElementById("pmsg").textContent);
    if (!/publiee/i.test(msg)) throw new Error("publication non confirmee (" + date + ") : " + msg);
  }
});

await check("le joueur resout la grille du jour", async () => {
  await player.goto(`${origin}/donjons.html#emu`);
  await player.waitForSelector("#gGoogle:not([disabled])");
  await player.click("#gGoogle");
  await player.waitForSelector("#authGate", { state: "hidden" });
  await player.waitForSelector("#board .cell");
  await player.waitForFunction(() => window.__ddef && window.__ddef.ready);
  await player.evaluate(() => window.__play.fillSolution());
  await player.waitForFunction(() => window.__ddef && window.__ddef.result && window.__ddef.result.solved);
  // la serie s'ecrit en fin de saveResult : on attend qu'elle soit prise en compte
  await player.waitForFunction(() => window.__ddef && window.__ddef.streak === 1);
});

await check("la banniere de victoire propose le retour a l'accueil", async () => {
  await player.waitForSelector("#banner .banner-home", { timeout: 5000 });
  const link = await player.evaluate(() => { const a = document.querySelector("#banner .banner-home"); return a ? a.getAttribute("href") : null; });
  if (link !== "accueil.html") throw new Error("lien de retour a l'accueil absent : " + link);
});

await check("l'accueil s'affiche apres connexion", async () => {
  await player.goto(`${origin}/accueil.html#emu`);
  await player.waitForSelector("#home:not([hidden])");
  await player.waitForFunction(() => window.__home && window.__home.ready);
});

await check("le compte a rebours est au format heures:minutes:secondes", async () => {
  const t = await player.evaluate(() => document.getElementById("countdown").textContent);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(t)) throw new Error("compte a rebours illisible : " + t);
});

await check("la grille du jour est marquee comme resolue", async () => {
  const state = await player.evaluate(() => document.getElementById("todayState").textContent);
  if (!/résolue/i.test(state)) throw new Error("etat de la grille du jour : " + state);
});

await check("serie, niveau et points refletent la reussite", async () => {
  const s = await player.evaluate(() => window.__home.stats);
  if (!s || s.streak < 1) throw new Error("serie non refletee : " + JSON.stringify(s));
  if (!(s.totalXp >= 20)) throw new Error("points non refletes : " + JSON.stringify(s));
  if (!(s.niveau >= 1)) throw new Error("niveau non reflete : " + JSON.stringify(s));
  const dispXp = await player.evaluate(() => document.getElementById("statXp").textContent);
  if (Number(dispXp) !== s.totalXp) throw new Error("points affiches != calcules : " + dispXp + " / " + s.totalXp);
  // le compteur « Badges » de l'accueil reflete les hauts faits gagnes au jeu
  const nb = await player.evaluate(() => Number(document.getElementById("statBadges").textContent));
  if (!(nb >= 1)) throw new Error("compteur de badges de l'accueil nul alors qu'une grille a ete reussie : " + nb);
});

await check("la liste des grilles precedentes montre l'ancienne, pas encore faite", async () => {
  await player.waitForSelector("#gridList .gl-item");
  const info = await player.evaluate(d => {
    const items = Array.from(document.querySelectorAll("#gridList .gl-item a")).map(a => a.getAttribute("href"));
    const past = document.querySelector('#gridList a[href="donjons.html?d=' + d + '"]');
    const li = past ? past.closest(".gl-item") : null;
    return { hrefs: items, hasPast: !!past, todo: li ? li.classList.contains("todo") : false };
  }, pastDate);
  if (!info.hasPast) throw new Error("grille ancienne absente de la liste : " + JSON.stringify(info.hrefs));
  if (!info.todo) throw new Error("grille ancienne devrait etre marquee a faire");
  if (info.hrefs.some(h => h.includes(today))) throw new Error("la grille du jour ne devrait pas figurer dans les precedentes");
});

await check("le classement est affiche sur l'accueil, le joueur mis en avant (mois puis cumul)", async () => {
  await player.waitForSelector("#lbList li.me", { timeout: 8000 });
  const month = await player.evaluate(() => {
    const me = document.querySelector("#lbList li.me");
    return { onMonth: document.getElementById("lbTabMonth").classList.contains("on"), meText: me ? me.textContent : "", status: document.getElementById("lbStatus").textContent };
  });
  if (!month.onMonth) throw new Error("l'onglet mensuel n'est pas actif par defaut");
  if (!month.meText) throw new Error("le joueur n'est pas mis en avant dans le classement mensuel");
  if (!/XP/.test(month.meText)) throw new Error("XP absente de la ligne du joueur : " + month.meText);
  if (!/\d/.test(month.status)) throw new Error("rang du joueur non indique : " + month.status);
  await player.evaluate(() => document.getElementById("lbTabAll").click());
  await player.waitForFunction(() => document.getElementById("lbTabAll").classList.contains("on"), null, { timeout: 5000 });
  const allMe = await player.evaluate(() => { const me = document.querySelector("#lbList li.me"); return me ? me.textContent : ""; });
  if (!allMe) throw new Error("le joueur n'est pas mis en avant dans le classement cumule");
  await player.evaluate(() => document.getElementById("lbTabMonth").click());   // on revient au mois pour la suite
});

await check("le profil s'ouvre depuis l'entete : niveau, badges, et enregistrement du pseudo", async () => {
  await player.click("#who");
  await player.waitForSelector("#profileModal:not([hidden])");
  await player.waitForSelector("#histList li");
  await player.waitForSelector("#badgeGrid .badge.on");
  const info = await player.evaluate(() => ({
    boxHidden: document.getElementById("levelBox").hidden,
    total: document.querySelectorAll("#badgeGrid .badge").length,
    gagnes: document.querySelectorAll("#badgeGrid .badge.on").length,
    compteur: document.getElementById("badgesCount").textContent
  }));
  if (info.boxHidden) throw new Error("bloc de niveau masque dans le profil");
  if (info.total !== 13) throw new Error("grille de badges incomplete au profil : " + info.total);
  if (info.gagnes < 1) throw new Error("aucun badge gagne affiche au profil : " + info.gagnes);
  if (!/\d+\s*\/\s*13/.test(info.compteur)) throw new Error("compteur de badges inattendu : " + info.compteur);
  await player.fill("#pseudoInput", "Rolista");
  await player.click("#saveProfile");
  await player.waitForFunction(() => window.__home.profile && window.__home.profile.pseudo === "Rolista");
  const hp = await player.evaluate(() => document.getElementById("hdrPseudo").textContent);
  if (hp !== "Rolista") throw new Error("pseudo entete apres enregistrement : " + hp);
  // saveProfile ferme la fenetre de lui-meme
  const closed = await player.evaluate(() => document.getElementById("profileModal").hidden);
  if (closed !== true) throw new Error("la fenetre de profil devrait se fermer apres enregistrement");
});

await check("depuis l'accueil connecte, la grille du jour s'ouvre sans redemander la connexion", async () => {
  await player.goto(`${origin}/donjons.html#emu`);
  await player.waitForSelector("#authGate", { state: "hidden", timeout: 8000 });
  await player.waitForSelector("#board .cell");
});

await check("rejouer une grille precedente : donjons.html?d= monte la bonne grille", async () => {
  await player.goto(`${origin}/donjons.html?d=${pastDate}#emu`);
  await player.waitForSelector("#board .cell");
  await player.waitForFunction(() => window.__ddef && window.__ddef.ready);
  const pd2 = await player.evaluate(() => window.__ddef.playedDate);
  if (pd2 !== pastDate) throw new Error("date jouee : " + pd2 + " (attendu " + pastDate + ")");
  const src = await player.evaluate(() => window.__ddef.source);
  if (src !== "firestore") throw new Error("la grille ancienne n'a pas ete chargee (source " + src + ")");
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
console.log("\nPage d'accueil verifiee : tous les controles passent.");
