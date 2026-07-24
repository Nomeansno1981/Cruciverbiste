// Test de la moderation des membres (membres.html) et des regles Firestore
// associees, sur les emulateurs : un membre alimente ses donnees, l'auteur les
// voit et agit (corriger un pseudo, suspendre, reactiver, supprimer), le membre
// suspendu ne peut plus ecrire et voit « compte suspendu », et un non-admin ne
// peut pas moderer. A lancer via : npm run test:moderation
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
    const file = clean === "/" ? "membres.html" : clean.slice(1);
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
const admin = await (await browser.newContext()).newPage();
const victim = await (await browser.newContext()).newPage();
admin.setDefaultTimeout(30000); victim.setDefaultTimeout(30000);
admin.on("pageerror", e => errs.push("admin: " + e));
victim.on("pageerror", e => errs.push("victim: " + e));

async function signInMembres(page, hash){
  await page.goto(`${origin}/membres.html${hash}`);
  await page.waitForSelector("#gGoogle");
  await page.click("#gGoogle");
  await page.waitForFunction(() => window.__mod && window.__mod.ready);
}

let victimUid = null;

await check("un membre alimente ses propres donnees (classement, profil, resultat)", async () => {
  await signInMembres(victim, "#emu-guest");
  const role = await victim.evaluate(() => window.__mod.role);
  if (role !== "guest") throw new Error("le compte de test devrait etre un simple membre : " + role);
  const out = await victim.evaluate(() => window.__mod.seedSelf("Vilain", 120));
  if (out.profile !== "ok" || out.result !== "ok") throw new Error("ecriture de ses propres donnees refusee : " + JSON.stringify(out));
  victimUid = out.uid;
  if (!victimUid) throw new Error("uid du membre introuvable");
});

await check("un non-admin ne peut ni lire les autres, ni suspendre, ni ecrire au journal", async () => {
  const [read, ban, log] = await victim.evaluate(() => Promise.all([
    window.__mod.tryReadUser("un-autre-membre"),
    window.__mod.tryWriteBanned("un-autre-membre"),
    window.__mod.tryWriteModeration()
  ]));
  if (read === "ok") throw new Error("un membre a pu lire les donnees d'un autre");
  if (ban === "ok") throw new Error("un membre a pu suspendre quelqu'un");
  if (log === "ok") throw new Error("un membre a pu ecrire au journal");
});

await check("l'auteur voit le membre dans la liste et sa fiche detaillee", async () => {
  await signInMembres(admin, "#emu");
  const role = await admin.evaluate(() => window.__mod.role);
  if (role !== "admin") throw new Error("le compte auteur devrait etre admin : " + role);
  // La liste se construit a partir de /leaderboard, desormais ecrit par la Cloud
  // Function apres le resultat : on rafraichit jusqu'a ce que le membre apparaisse.
  let mem = null;
  for (let i = 0; i < 24; i++) {
    await admin.evaluate(() => window.__mod.load());
    mem = await admin.evaluate(u => (window.__mod.members.find(x => x.uid === u) || null), victimUid);
    if (mem) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!mem) throw new Error("membre absent de la liste (Cloud Function pas encore passee ?)");
  if (mem.pseudo !== "Vilain") throw new Error("pseudo inattendu dans la liste : " + mem.pseudo);
  const detail = await admin.evaluate(u => window.__mod.open(u), victimUid);
  if (detail.grids < 1) throw new Error("historique vide dans la fiche : " + JSON.stringify(detail));
  if (detail.totalXp < 120) throw new Error("XP totale incorrecte dans la fiche : " + detail.totalXp);
});

await check("l'auteur corrige un pseudo (profil et classement)", async () => {
  const ok = await admin.evaluate(u => window.__mod.fixPseudo(u, "Repenti"), victimUid);
  if (!ok) throw new Error("correction refusee");
  const mem = await admin.evaluate(u => (window.__mod.members.find(x => x.uid === u) || {}), victimUid);
  if (mem.pseudo !== "Repenti") throw new Error("pseudo non corrige dans la liste : " + mem.pseudo);
});

await check("l'auteur suspend un membre (retire du classement, marque suspendu)", async () => {
  const ok = await admin.evaluate(u => window.__mod.suspend(u), victimUid);
  if (!ok) throw new Error("suspension refusee");
  const mem = await admin.evaluate(u => (window.__mod.members.find(x => x.uid === u) || {}), victimUid);
  if (!mem.suspended) throw new Error("membre non marque suspendu apres la suspension");
});

await check("le membre suspendu ne peut plus ecrire ses donnees", async () => {
  const out = await victim.evaluate(() => window.__mod.seedSelf("Vilain2", 999));
  if (out.profile === "ok" || out.result === "ok") throw new Error("un membre suspendu a pu ecrire : " + JSON.stringify(out));
});

await check("l'accueil affiche « compte suspendu » au membre suspendu", async () => {
  await victim.goto(`${origin}/accueil.html#emu`);
  const needLogin = await victim.evaluate(() => { const g = document.getElementById("authGate"); return g && !g.hidden; }).catch(() => true);
  if (needLogin) { try { await victim.click("#gGoogle"); } catch (e) {} }
  await victim.waitForFunction(() => window.__home && window.__home.suspended === true, null, { timeout: 10000 });
  const shown = await victim.evaluate(() => !document.getElementById("suspended").hidden && document.getElementById("home").hidden);
  if (!shown) throw new Error("l'ecran de suspension n'est pas affiche");
});

await check("l'auteur reactive, resuspend, puis supprime — la suppression efface aussi la fiche /banned", async () => {
  const react = await admin.evaluate(u => window.__mod.reactivate(u), victimUid);
  if (!react) throw new Error("reactivation refusee");
  // On resuspend avant de supprimer : le membre a de nouveau une fiche /banned.
  // Si wipe ne l'effacait pas, il resterait affiche « Suspendu / 0 XP » dans la liste.
  const resusp = await admin.evaluate(u => window.__mod.suspend(u), victimUid);
  if (!resusp) throw new Error("re-suspension refusee");
  const wiped = await admin.evaluate(u => window.__mod.wipe(u), victimUid);
  if (!wiped) throw new Error("suppression refusee");
  const mem = await admin.evaluate(u => (window.__mod.members.find(x => x.uid === u) || null), victimUid);
  if (mem) throw new Error("le membre subsiste dans la liste apres suppression (fiche /banned non effacee ?)");
});

await check("le journal de moderation consigne les actions (immuable)", async () => {
  const rows = await admin.evaluate(() => window.__mod.loadJournal());
  const actions = rows.map(r => r.action);
  for (const a of ["pseudo", "suspendre", "reactiver", "suppression"]) {
    if (!actions.includes(a)) throw new Error("action absente du journal : " + a + " (" + JSON.stringify(actions) + ")");
  }
});

await check("aucune erreur JavaScript", async () => {
  if (errs.length) throw new Error(errs.join(" | "));
});

await browser.close();
server.close();
if (failures.length) { console.error("\n" + failures.length + " controle(s) en echec."); process.exit(1); }
console.log("\nModeration des membres verifiee : tous les controles passent.");
