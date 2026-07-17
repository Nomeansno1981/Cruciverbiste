// Test de fumée en mode #local : l'application se charge, une grille se génère
// réellement, l'état persiste dans IndexedDB et les grilles enregistrées se
// rechargent. La synchronisation en ligne a son propre test (tests/sync.mjs).
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

await check("dictionnaire affiché par ordre alphabétique", async () => {
  const first = await page.locator("#entries .entry .word").first().innerText();
  if (first.toLowerCase() !== "amour") throw new Error("premier mot attendu « amour », obtenu : " + first);
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

await check("doublons refusés à l'ajout, définitions fusionnées", async () => {
  // même mot aux accents et à la casse près : EPEE == épée, rien n'est ajouté
  await page.fill("#wIn", "EPEE");
  await page.click("#addBtn");
  let n = await count("#entries .entry");
  if (n !== 13) throw new Error("le doublon EPEE/épée a été ajouté (" + n + " entrées)");
  // une définition nouvelle sur un mot existant rejoint ce mot
  await page.fill("#wIn", "épée");
  await page.fill("#cIn", "Elle se croise aussi en duel");
  await page.click("#addBtn");
  n = await count("#entries .entry");
  if (n !== 13) throw new Error("doublon ajouté au lieu de fusionner (" + n + " entrées)");
  const badge = await page.locator("#entries .entry").filter({ hasText: "épée" }).locator(".cluecount").innerText();
  if (badge !== "2 définitions") throw new Error("définition non fusionnée : " + badge);
  // collage : seuls les mots nouveaux entrent
  await page.click("#toggleImport");
  await page.fill("#pasteArea", "pont ; dragon ; REINE");
  await page.click("#parseBtn");
  n = await count("#entries .entry");
  if (n !== 14) throw new Error("attendu 14 entrées après collage (seul dragon est nouveau), obtenu " + n);
});

await check("suppression d'un mot : uniquement depuis l'éditeur, en deux touches", async () => {
  const dels = await count("#entries .entry .del");
  if (dels !== 0) throw new Error("les lignes ne devraient plus porter de croix de suppression (" + dels + ")");
  const seedCount = () => page.evaluate(() => window.__vcState().lists[0].entries.length);
  const row = page.locator("#entries .entry").filter({ hasText: "dragon" });
  await row.click();
  await page.waitForSelector(".entry-editor");
  await page.click(".entry-editor .btn-danger");
  if (await seedCount() !== 14) throw new Error("la première touche ne doit pas supprimer");
  const label = await page.locator(".entry-editor .btn-danger").innerText();
  if (!/Confirmer/.test(label)) throw new Error("bouton non armé : " + label);
  await page.click(".entry-editor .btn-danger");
  if (await seedCount() !== 13) throw new Error("le mot n'a pas été supprimé");
  const gone = await page.locator("#entries .entry").filter({ hasText: "dragon" }).count();
  if (gone !== 0) throw new Error("dragon encore présent dans l'affichage");
});

/* ---- J2 : définitions différées et multiples ---- */

await check("création d'une liste et ajout de mots sans définition", async () => {
  await page.click("#newList");
  await page.fill("#wIn", "lac ; cave");
  await page.click("#addBtn");
  const n = await count("#entries .entry");
  if (n !== 2) throw new Error("attendu 2 entrées, obtenu " + n);
  const zeros = await count("#entries .cluecount.zero");
  if (zeros !== 2) throw new Error("attendu 2 compteurs « 0 définition », obtenu " + zeros);
  const badge = await page.locator("#entries .cluecount").first().innerText();
  if (badge !== "0 définition") throw new Error("libellé de compteur inattendu : " + badge);
});

await check("génération : les mots sans définition proposent un champ « définir »", async () => {
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const boxes = await count(".clues .definebox input");
  if (boxes !== 2) throw new Error("attendu 2 champs de saisie, obtenu " + boxes);
});

await check("définition rédigée depuis la grille et mémorisée au dictionnaire", async () => {
  const inp = page.locator('.clues .definebox input[placeholder*="LAC"]');
  await inp.fill("Étendue d'eau douce");
  await inp.press("Enter");
  const shown = await page.locator(".clues li").filter({ hasText: "Étendue d'eau douce" }).count();
  if (shown !== 1) throw new Error("la définition ne s'affiche pas dans la grille");
  const badge = await page.locator("#entries .entry").filter({ hasText: "lac" }).locator(".cluecount").innerText();
  if (badge !== "1 définition") throw new Error("compteur du dictionnaire inattendu : " + badge);
  const st = await page.evaluate(() => window.__vcState());
  const lac = st.lists.find(l => l.id === st.currentId).entries.find(e => e.word === "lac");
  if (!lac || lac.clues.length !== 1 || lac.clues[0].text !== "Étendue d'eau douce") throw new Error("définition absente du dictionnaire");
  if (lac.lastClueId !== lac.clues[0].id) throw new Error("lastClueId non mémorisé");
});

await check("éditeur du dictionnaire : ajout d'une seconde définition", async () => {
  const row = page.locator("#entries .entry").filter({ hasText: "lac" });
  await row.hover();
  await row.locator(".edit").click();
  await page.click(".entry-editor .btn-out");
  await page.locator(".entry-editor .cluerow input").last().fill("Le Bourget par exemple");
  await page.click(".entry-editor .btn-primary");
  const badge = await page.locator("#entries .entry").filter({ hasText: "lac" }).locator(".cluecount").innerText();
  if (badge !== "2 définitions") throw new Error("compteur inattendu après ajout : " + badge);
});

await check("choix de la définition par grille via le sélecteur", async () => {
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const li = page.locator(".clues li").filter({ hasText: "Étendue d'eau douce" });
  if (await li.count() !== 1) throw new Error("la définition par défaut (dernière utilisée) n'est pas affichée");
  await li.hover();
  await li.locator('[title^="Choisir la définition"]').click();
  await page.locator(".clues select.clue-select").selectOption({ index: 1 });
  const chosen = await page.locator(".clues li").filter({ hasText: "Le Bourget par exemple" }).count();
  if (chosen !== 1) throw new Error("le changement de définition ne s'applique pas");
  const st = await page.evaluate(() => window.__vcState());
  const lac = st.lists.find(l => l.id === st.currentId).entries.find(e => e.word === "lac");
  if (lac.lastClueId !== lac.clues[1].id) throw new Error("lastClueId non mis à jour après le choix");
});

await check("la dernière définition utilisée devient le défaut de la grille suivante", async () => {
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const shown = await page.locator(".clues li").filter({ hasText: "Le Bourget par exemple" }).count();
  if (shown !== 1) throw new Error("le défaut n'est pas la dernière définition utilisée");
});

await check("grille enregistrée : instantané identifiant + texte de la définition", async () => {
  await page.click("#saveGrid");
  const st = await page.evaluate(() => window.__vcState());
  const g = st.savedGrids[0];
  const items = [].concat(g.across, g.down);
  const lacItem = items.find(it => it.word === "LAC");
  const lac = st.lists.find(l => l.id === st.currentId).entries.find(e => e.word === "lac");
  if (!lacItem) throw new Error("LAC absent de la grille enregistrée");
  if (lacItem.clueId !== lac.clues[1].id) throw new Error("clueId absent de l'instantané");
  if (lacItem.clue !== "Le Bourget par exemple") throw new Error("texte absent de l'instantané");
});

await page.waitForTimeout(800);

await check("persistance des définitions multiples après rechargement", async () => {
  await page.reload();
  await page.waitForSelector("#board svg g.cell");
  const badge = await page.locator("#entries .entry").filter({ hasText: "lac" }).locator(".cluecount").innerText();
  if (badge !== "2 définitions") throw new Error("définitions perdues après rechargement : " + badge);
  const saved = await count("#savedList .saved-row");
  if (saved !== 2) throw new Error("attendu 2 grilles enregistrées, obtenu " + saved);
});

await check("grand dictionnaire : la boîte se remplit, le surplus reste en réserve", async () => {
  await page.click("#newList");
  await page.click("#toggleImport");
  await page.fill("#pasteArea",
    "loutre ; blaireau ; renard ; sanglier ; chevreuil ; écureuil ; hérisson ; belette ; fouine ; martre\n" +
    "campagnol ; mulot ; musaraigne ; taupe ; lièvre ; lapin ; cerf ; biche ; faon ; loup\n" +
    "lynx ; chamois ; bouquetin ; marmotte ; castor ; loir ; genette ; putois ; hermine ; vison");
  await page.click("#parseBtn");
  const n = await count("#entries .entry");
  if (n !== 30) throw new Error("attendu 30 entrées, obtenu " + n);
  await page.fill("#maxW", "12");
  await page.fill("#maxH", "12");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const stats = await page.locator("#placedStat").innerText();
  if (!/30 mots au total/.test(stats)) throw new Error("mention du dictionnaire absente : " + stats);
});

await check("ligatures décomposées : cœur se place comme COEUR", async () => {
  const r = await page.evaluate(() => ({
    coeur: window.__vcSanitize("cœur"),
    oeil: window.__vcSanitize("œil"),
    naevus: window.__vcSanitize("nævus")
  }));
  if (r.coeur.clean !== "COEUR" || r.coeur.display !== "COEUR") throw new Error("cœur : " + JSON.stringify(r.coeur));
  if (r.oeil.clean !== "OEIL") throw new Error("œil : " + JSON.stringify(r.oeil));
  if (r.naevus.clean !== "NAEVUS") throw new Error("nævus : " + JSON.stringify(r.naevus));
});

await check("rotation : les mots d'une grille enregistrée cèdent la place aux autres", async () => {
  // sur la liste de 30 animaux : petite boîte, grille enregistrée, puis
  // les candidats suivants doivent exclure les mots déjà enregistrés
  await page.fill("#maxW", "8");
  await page.fill("#maxH", "8");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  await page.click("#saveGrid");
  const st = await page.evaluate(() => window.__vcState());
  const used = [].concat(st.savedGrids[0].across, st.savedGrids[0].down).map(it => it.word);
  if (used.length < 2 || used.length > 10) throw new Error("grille 8×8 inattendue : " + used.length + " mots placés");
  const pool = await page.evaluate(() => window.__vcPoolWords(8, 8));
  if (pool.length !== 20) throw new Error("taille de tirage inattendue : " + pool.length);
  for (const w of used) if (pool.includes(w)) throw new Error("mot déjà enregistré encore prioritaire : " + w);
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const stats = await page.locator("#placedStat").innerText();
  if (!/rotation/.test(stats)) throw new Error("mention de rotation absente : " + stats);
});

await check("frontières de mots : espaces et traits d'union barrés, pas l'apostrophe", async () => {
  const r = await page.evaluate(() => ({
    dnd: window.__vcSanitize("donjons et dragons"),
    appel: window.__vcSanitize("L'Appel de Cthulhu"),
    pm: window.__vcSanitize("porte-monnaie")
  }));
  if (r.dnd.clean !== "DONJONSETDRAGONS" || r.dnd.breaks.join(",") !== "7,9") throw new Error("donjons et dragons : " + JSON.stringify(r.dnd));
  if (r.appel.clean !== "LAPPELDECTHULHU" || r.appel.breaks.join(",") !== "6,8") throw new Error("L'Appel de Cthulhu : " + JSON.stringify(r.appel));
  if (r.pm.clean !== "PORTEMONNAIE" || r.pm.breaks.join(",") !== "5") throw new Error("porte-monnaie : " + JSON.stringify(r.pm));
});

await check("barres épaisses dans la grille, conservées après enregistrement", async () => {
  await page.click("#newList");
  await page.fill("#wIn", "donjons et dragons");
  await page.click("#addBtn");
  await page.fill("#wIn", "griffon");
  await page.click("#addBtn");
  await page.fill("#maxW", "17");
  await page.fill("#maxH", "17");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const bars = await count('#board svg line[stroke-width="4.5"]');
  if (bars !== 2) throw new Error("attendu 2 barres épaisses, obtenu " + bars);
  await page.click("#saveGrid");
  await page.click("#savedList .saved-row .btn-out");
  await page.waitForFunction(() => /chargée/i.test(document.getElementById("hstatus").textContent));
  const after = await count('#board svg line[stroke-width="4.5"]');
  if (after !== 2) throw new Error("barres perdues au rechargement : " + after);
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
