// Test de fumée : l'application se charge, une grille se génère réellement,
// l'état persiste dans IndexedDB et les grilles enregistrées se rechargent.
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
  } catch {
    res.writeHead(404); res.end("introuvable");
  }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

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
const count = sel => page.locator(sel).count();

await page.goto(url);
await page.waitForSelector("#board svg g.cell");

await check("la liste d'exemple contient 12 entrées", async () => {
  const n = await count("#entries .entry");
  if (n !== 12) throw new Error("attendu 12, obtenu " + n);
});

await check("une grille se génère réellement (cellules SVG présentes)", async () => {
  const cells = await count("#board svg g.cell");
  if (cells < 10) throw new Error("seulement " + cells + " cellules");
});

await check("les définitions horizontales et verticales sont listées", async () => {
  const a = await count("#acrossList li"), d = await count("#downList li");
  if (a + d < 2) throw new Error("listes de définitions vides (" + a + " + " + d + ")");
});

await check("les statistiques de placement s'affichent", async () => {
  const txt = await page.locator("#placedStat").innerText();
  if (!/\d+ mots/.test(txt)) throw new Error("statistique illisible : " + txt);
});

await check("enregistrement d'une grille", async () => {
  await page.click("#saveGrid");
  await page.waitForSelector("#savedList .saved-row");
});

await check("ajout d'un mot sans définition", async () => {
  await page.fill("#wIn", "banquet");
  await page.click("#addBtn");
  const n = await count("#entries .entry");
  if (n !== 13) throw new Error("attendu 13, obtenu " + n);
});

// Laisse la sauvegarde différée (350 ms) s'écrire avant de recharger.
await page.waitForTimeout(800);

await check("persistance IndexedDB après rechargement de la page", async () => {
  await page.reload();
  await page.waitForSelector("#board svg g.cell");
  const n = await count("#entries .entry");
  if (n !== 13) throw new Error("le mot ajouté a disparu (" + n + " entrées)");
  const saved = await count("#savedList .saved-row");
  if (saved !== 1) throw new Error("grille enregistrée absente après rechargement (" + saved + ")");
});

await check("rechargement d'une grille enregistrée", async () => {
  await page.click("#savedList .saved-row .btn-out");
  await page.waitForSelector("#board svg g.cell");
  const txt = await page.locator("#hstatus").innerText();
  if (!/chargée/i.test(txt)) throw new Error("statut inattendu : " + txt);
});

await check("le modèle migré porte bien des tableaux clues[]", async () => {
  const st = await page.evaluate(() => window.__vcState());
  const e = st.lists[0].entries[0];
  if (!Array.isArray(e.clues)) throw new Error("entrée sans tableau clues");
  if (e.clues.length !== 1 || !e.clues[0].id || !e.clues[0].text) throw new Error("clue mal formée : " + JSON.stringify(e.clues));
  const banquet = st.lists[0].entries.find(x => x.word === "banquet");
  if (!banquet || banquet.clues.length !== 0) throw new Error("le mot sans définition devrait avoir clues = []");
});

await check("aucune erreur JavaScript sur la page", async () => {
  if (pageErrors.length) throw new Error(pageErrors.join(" | "));
});

await browser.close();
server.close();

if (failures.length) {
  console.error("\n" + failures.length + " contrôle(s) en échec.");
  process.exit(1);
}
console.log("\nTous les contrôles passent.");
