// Badge « Aux aguets » (émulateurs) : le tout premier à terminer la grille du
// jour l'obtient, pas les suivants. Le verrou premiers/{date} est atomique et
// figé (règles Firestore). Deux comptes distincts (e-mail) résolvent la démo.
// À lancer : npm run test:premier
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
const errs = [];
const p1 = await (await browser.newContext()).newPage();
const p2 = await (await browser.newContext()).newPage();
p1.setDefaultTimeout(30000); p2.setDefaultTimeout(30000);
p1.on("pageerror", e => errs.push("p1: " + e));
p2.on("pageerror", e => errs.push("p2: " + e));

// connexion par e-mail (comptes distincts → uid distincts) puis résolution de la démo du jour
async function connecteEtResout(page, email){
  await page.goto(`${origin}/donjons.html#emu`);
  await page.waitForSelector("#gGoogle:not([disabled])");
  await page.fill("#gEmail", email);
  await page.fill("#gPass", "motdepasse123");
  await page.click("#gCreate");
  await page.waitForSelector("#authGate", { state: "hidden" });
  await page.waitForSelector("#board .cell");
  await page.waitForFunction(() => window.__ddef && window.__ddef.ready);
  await page.evaluate(() => window.__play.fillSolution());
  await page.waitForFunction(() => window.__ddef && Array.isArray(window.__ddef.newBadges) && window.__ddef.result && window.__ddef.result.solved);
  return page.evaluate(() => window.__ddef.newBadges);
}

await check("le tout premier a terminer la grille du jour obtient « Aux aguets »", async () => {
  const badges = await connecteEtResout(p1, "premier@example.com");
  if (!badges.includes("premier")) throw new Error("le premier joueur n'a pas obtenu « Aux aguets » : " + JSON.stringify(badges));
});

await check("le joueur suivant n'obtient pas « Aux aguets » (verrou tenu)", async () => {
  const badges = await connecteEtResout(p2, "second@example.com");
  if (badges.includes("premier")) throw new Error("le second joueur a obtenu « Aux aguets » a tort : " + JSON.stringify(badges));
  // il obtient tout de meme ses propres badges (1re grille)
  if (!badges.includes("grilles-1")) throw new Error("le second joueur devrait tout de meme decrocher « premiere grille » : " + JSON.stringify(badges));
});

await check("regles du verrou : usurper l'uid d'autrui est refuse, poser sa fiche est permis", async () => {
  const probe = await p2.evaluate(() => window.__ddef.firstProbe());
  if (!/denied|permission/i.test(probe.spoof)) throw new Error("poser un verrou au nom d'autrui aurait du etre refuse, obtenu : " + probe.spoof);
  if (probe.self !== "ok") throw new Error("poser sa propre fiche de verrou aurait du etre permis, obtenu : " + probe.self);
});

await check("aucune erreur JavaScript", async () => {
  if (errs.length) throw new Error(errs.join(" | "));
});

await browser.close();
server.close();
if (failures.length) { console.error("\n" + failures.length + " controle(s) en echec."); process.exit(1); }
console.log("\nBadge « Aux aguets » verifie : tous les controles passent.");
