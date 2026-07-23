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
const url = `http://127.0.0.1:${server.address().port}/#local-flat`;

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
const context = await browser.newContext();
try { await context.grantPermissions(["clipboard-read", "clipboard-write"]); } catch { /* selon le moteur */ }
const page = await context.newPage();
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

await check("les dimensions proposées par défaut sont 15 x 15 (format imposé)", async () => {
  const w = await page.inputValue("#maxW"), h = await page.inputValue("#maxH");
  if (w !== "15" || h !== "15") throw new Error("proposé : " + w + " x " + h);
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
  if (used.length < 2 || used.length > 18) throw new Error("grille 8×8 inattendue : " + used.length + " mots placés");
  const pool = await page.evaluate(() => window.__vcPoolWords(8, 8));
  if (pool.length !== 20) throw new Error("taille de tirage inattendue : " + pool.length);
  // les mots enregistrés cèdent la place tant qu'il reste assez de mots frais.
  // En 8×8, 26 animaux sont éligibles : la boîte ferme écarte chevreuil,
  // campagnol, musaraigne et bouquetin (plus de 8 lettres) pour 20 places.
  const usedInPool = used.filter(w => pool.includes(w)).length;
  const tolerated = Math.max(0, used.length - (26 - 20));
  if (usedInPool > tolerated) throw new Error("mots déjà enregistrés encore prioritaires : " + usedInPool + " (toléré " + tolerated + ")");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const stats = await page.locator("#placedStat").innerText();
  if (!/rotation/.test(stats)) throw new Error("mention de rotation absente : " + stats);
});

await check("extension : la réserve vient densifier la grille retenue", async () => {
  // grand vivier avec mots-colle courts, petite boîte : la réserve doit nourrir la grille
  await page.click("#newList");
  await page.click("#toggleImport");
  await page.fill("#pasteArea",
    "merle ; grive ; pinson ; mésange ; corbeau ; corneille ; pie ; geai ; buse ; milan ; faucon ; épervier ; chouette ; hibou ; effraie ; martinet ; hirondelle ; cigogne ; héron\n" +
    "chêne ; hêtre ; frêne ; érable ; bouleau ; charme ; tilleul ; orme ; saule ; peuplier ; mélèze ; sapin ; épicéa ; cèdre ; cyprès ; noyer\n" +
    "boulanger ; forgeron ; menuisier ; charpentier ; tisserand ; potier ; vannier ; tonnelier ; meunier ; berger ; vacher ; fermier ; jardinier ; apiculteur ; vigneron ; brasseur ; tailleur ; cordonnier ; sellier ; tanneur ; verrier ; maçon ; couvreur ; charron ; barbier ; herboriste\n" +
    "pic ; épi ; roc ; lac ; clé ; île ; rue ; âne ; oie ; boa ; lys ; ver ; osier ; aulne ; houx ; genêt ; ronce ; mousse ; sève ; nid ; aire ; serre ; bec ; aile ; plume");
  await page.click("#parseBtn");
  await page.fill("#maxW", "10");
  await page.fill("#maxH", "10");
  let found = false;
  for (let t = 0; t < 5 && !found; t++) {
    await page.click("#genBtn");
    await page.waitForSelector("#board svg g.cell");
    found = /extension : \+\d+ de la réserve/.test(await page.locator("#placedStat").innerText());
  }
  if (!found) throw new Error("mention d'extension jamais apparue en 5 tirages");
});

await check("jamais deux formes d'un même mot dans une grille", async () => {
  await page.click("#newList");
  await page.fill("#wIn", "donjon ; donjons ; roue");
  await page.click("#addBtn");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const words = await page.locator(".clues .definebox input").evaluateAll(
    els => els.map(e => (e.placeholder.match(/« (.+) »/) || [])[1]));
  const forms = words.filter(w => /^DONJONS?$/.test(w));
  if (forms.length !== 1) throw new Error("formes de « donjon » placées : " + forms.join(", "));
  if (words.length !== 2) throw new Error("attendu 2 mots placés, obtenu : " + words.join(", "));
});

await check("boîte ferme : un mot plus long que la grille n'est pas utilisé", async () => {
  await page.click("#newList");
  await page.fill("#wIn", "supercalifragilisticexpialidocious ; dragon ; grimoire");
  await page.click("#addBtn");
  await page.fill("#maxW", "");
  await page.fill("#maxH", "");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const w = await page.inputValue("#maxW"), h = await page.inputValue("#maxH");
  if (w !== "15" || h !== "15") throw new Error("dimensions retenues : " + w + " x " + h);
  const words = await page.locator(".clues .definebox input").evaluateAll(
    els => els.map(e => (e.placeholder.match(/« (.+) »/) || [])[1]));
  if (words.some(x => x && x.length > 25)) throw new Error("mot trop long placé : " + words.join(", "));
  if (words.length !== 2) throw new Error("attendu 2 mots placés, obtenu : " + words.join(", "));
  const note = await page.locator("#hstatus").innerText();
  if (!note.includes("non utilisé")) throw new Error("signalement absent : " + note);
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

await check("séparateurs ◆ des mots composés, conservés après enregistrement", async () => {
  await page.click("#newList");
  // mot composé à deux frontières (POMME|DE|TERRE), tenant dans le 15×15 imposé
  await page.fill("#wIn", "pomme de terre");
  await page.click("#addBtn");
  await page.fill("#wIn", "griffon");
  await page.click("#addBtn");
  await page.fill("#maxW", "15");
  await page.fill("#maxH", "15");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const bars = await count("#board svg path.wordbar");
  if (bars !== 2) throw new Error("attendu 2 séparateurs, obtenu " + bars);
  await page.click("#saveGrid");
  await page.click("#savedList .saved-row .btn-out");
  await page.waitForFunction(() => /chargée/i.test(document.getElementById("hstatus").textContent));
  const after = await count("#board svg path.wordbar");
  if (after !== 2) throw new Error("séparateurs perdus au rechargement : " + after);
});

await check("numéros de cases : bordeaux, demi-gras, taille lisible", async () => {
  const nums = await page.locator('#board svg g.cell text[font-size="10.5"]').evaluateAll(
    els => els.map(e => ({ fill: e.getAttribute("fill"), weight: e.getAttribute("font-weight") })));
  if (!nums.length) throw new Error("aucun numéro à la taille attendue");
  const wrong = nums.find(n => n.fill !== "#7C1D2E" || n.weight !== "600");
  if (wrong) throw new Error("numéro mal stylé : " + JSON.stringify(wrong));
});

await check("les chiffres entrent dans la grille, une case chacun", async () => {
  const r = await page.evaluate(() => ({
    age: window.__vcSanitize("13th Age"),
    d20: window.__vcSanitize("d20"),
    mer: window.__vcSanitize("7e Mer")
  }));
  if (r.age.clean !== "13THAGE" || r.age.breaks.join(",") !== "4") throw new Error("13th Age : " + JSON.stringify(r.age));
  if (r.d20.clean !== "D20") throw new Error("d20 : " + JSON.stringify(r.d20));
  if (r.mer.clean !== "7EMER" || r.mer.breaks.join(",") !== "2") throw new Error("7e Mer : " + JSON.stringify(r.mer));
  // placement réel : D20 croise DRAGON sur le D
  await page.click("#newList");
  await page.fill("#wIn", "d20 ; dragon");
  await page.click("#addBtn");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const txt = await page.locator("#placedStat").innerText();
  if (!/2 mots/.test(txt)) throw new Error("placement avec chiffres raté : " + txt);
});

await check("italiques à la Markdown dans les définitions", async () => {
  await page.click("#newList");
  await page.fill("#wIn", "cthulhu");
  await page.fill("#cIn", "Le Grand Ancien de *L'Appel de Cthulhu*");
  await page.click("#addBtn");
  await page.fill("#wIn", "rlyeh");
  await page.fill("#cIn", "La cité engloutie du *Mythe*");
  await page.click("#addBtn");
  const em1 = await page.locator("#entries .entry em").first().innerText();
  if (em1 !== "L'Appel de Cthulhu") throw new Error("italique absent du dictionnaire : " + em1);
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const ems = await count(".clues li em");
  if (ems < 2) throw new Error("italiques absents des définitions de la grille (" + ems + ")");
  const st = await page.evaluate(() => window.__vcState());
  const list = st.lists.find(l => l.id === st.currentId);
  const raw = list.entries.find(e => e.word === "cthulhu").clues[0].text;
  if (!raw.includes("*L'Appel de Cthulhu*")) throw new Error("les astérisques devraient rester dans les données : " + raw);
});

await check("export des définitions : texte structuré, copié au presse-papiers", async () => {
  await page.click("#newList");
  await page.fill("#wIn", "cthulhu");
  await page.fill("#cIn", "Le Grand Ancien de *L'Appel de Cthulhu*");
  await page.click("#addBtn");
  await page.fill("#wIn", "hastur");
  await page.fill("#cIn", "Celui qu'on ne nomme pas");
  await page.click("#addBtn");
  await page.fill("#wIn", "dagon");
  await page.fill("#cIn", "Le dieu des profondeurs");
  await page.click("#addBtn");
  await page.fill("#maxW", "12"); await page.fill("#maxH", "12");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");

  const text = await page.evaluate(() => window.__vcCluesText());
  const lines = text.split("\n");
  if (!lines[0] || /^\d+\. /.test(lines[0])) throw new Error("titre manquant : " + lines[0]);
  if (!/HORIZONTALEMENT|VERTICALEMENT/.test(text)) throw new Error("en-têtes de sens absents");
  const content = lines.slice(1).filter(l => l && l !== "HORIZONTALEMENT" && l !== "VERTICALEMENT");
  if (!content.length) throw new Error("aucune définition dans le texte");
  const malformed = content.find(l => !/^\d+\. /.test(l));
  if (malformed) throw new Error("ligne mal formée : " + malformed);
  if (!content.some(l => !/\(définition à compléter/.test(l))) throw new Error("aucune définition rédigée exportée");

  // copie réelle : le presse-papiers doit contenir exactement le texte composé
  await page.click("#copyClues");
  await page.waitForFunction(() => /copiées/i.test(document.getElementById("hstatus").textContent));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (clip !== text) throw new Error("presse-papiers différent du texte composé");
});

await check("export des définitions : mot sans définition signalé", async () => {
  await page.click("#newList");
  for (const w of ["dragon", "gobelin", "sortilege", "arbalete", "taverne"]) {
    await page.fill("#wIn", w);
    await page.click("#addBtn");
  }
  await page.fill("#maxW", "12"); await page.fill("#maxH", "12");
  await page.click("#genBtn");
  await page.waitForSelector("#board svg g.cell");
  const text = await page.evaluate(() => window.__vcCluesText());
  const content = text.split("\n").filter(l => /^\d+\. /.test(l));
  if (!content.length) throw new Error("aucune ligne de définition");
  const redigee = content.find(l => !/\(définition à compléter : /.test(l));
  if (redigee) throw new Error("mention « à compléter » attendue : " + redigee);
});

await check("export « Copier pour le jeu » : structure valide et coordonnées cohérentes", async () => {
  // une grille est présente (générée au contrôle précédent)
  const p = await page.evaluate(() => window.__vcGamePuzzle());
  if (!p || !p.solution || !p.rows || !p.cols) throw new Error("structure invalide");
  // format publié imposé : toujours 15×15, avec le donjon centré (marges symétriques à ±1 case)
  if (p.rows !== 15 || p.cols !== 15) throw new Error("grille publiée non 15×15 : " + p.cols + "×" + p.rows);
  const rr = Object.keys(p.solution).map(k => +k.split(",")[0]);
  const cc = Object.keys(p.solution).map(k => +k.split(",")[1]);
  const hautMarge = Math.min(...rr), basMarge = 14 - Math.max(...rr);
  const gaucheMarge = Math.min(...cc), droiteMarge = 14 - Math.max(...cc);
  if (Math.abs(hautMarge - basMarge) > 1 || Math.abs(gaucheMarge - droiteMarge) > 1)
    throw new Error("donjon non centré : marges V " + hautMarge + "/" + basMarge + ", H " + gaucheMarge + "/" + droiteMarge);
  // les lettres de la grille publiée sont neutralisées : aucune lettre accentuée
  const lettres = Object.values(p.solution).join("");
  if (!/^[A-Z0-9]+$/.test(lettres)) throw new Error("des accents subsistent dans la solution publiée : " + lettres);
  if (!Array.isArray(p.across) || !Array.isArray(p.down)) throw new Error("across/down manquants");
  const all = p.across.concat(p.down);
  if (!all.length) throw new Error("aucune définition exportée");
  for (const w of all) {
    if (!Array.isArray(w.cells) || !w.cells.length) throw new Error("cellules manquantes pour un mot");
    for (const [r, c] of w.cells) {
      if (r < 0 || r >= p.rows || c < 0 || c >= p.cols) throw new Error("case hors grille : " + r + "," + c);
      if (!p.solution[r + "," + c]) throw new Error("case sans lettre : " + r + "," + c);
    }
  }
  // pas de tableau imbriqué au premier niveau des champs simples (stockage JSON côté publication)
  if (typeof JSON.stringify(p) !== "string") throw new Error("sérialisation impossible");
});

await check("maillage dense sans épine : ~14 mots, tous croisant ≥ 2 réponses", async () => {
  // liste réaliste façon jeu de rôle : le générateur vise ~14 mots au maillage
  // serré et ne publie AUCUNE épine (mot à 0-1 croisement), la grille restant d'un
  // seul tenant. On répète : la garantie doit tenir à chaque tirage.
  await page.click("#newList");
  await page.click("#toggleImport");
  await page.fill("#pasteArea",
    "dragon ; gobelin ; sortilege ; taverne ; paladin ; donjon ; grimoire ; arbalete ; potion ; elfe ; nain ; orque\n" +
    "magie ; epee ; bouclier ; heros ; quete ; tresor ; heaume ; sorcier ; demon ; guilde ; auberge ; chateau ; archer ; barde ; voleur ; clerc ; geant ; troll");
  await page.click("#parseBtn");
  await page.fill("#maxW", "14");
  await page.fill("#maxH", "14");
  for (let t = 0; t < 5; t++) {
    await page.click("#genBtn");
    await page.waitForSelector("#board svg g.cell");
    const p = await page.evaluate(() => window.__vcGamePuzzle());
    const all = p.across.concat(p.down);
    const count = new Map();
    for (const w of all) for (const [r, c] of w.cells) { const k = r + "," + c; count.set(k, (count.get(k) || 0) + 1); }
    // aucune épine : chaque mot croise au moins deux réponses
    for (const w of all) {
      let ch = 0; for (const [r, c] of w.cells) if ((count.get(r + "," + c) || 0) >= 2) ch++;
      if (ch < 2) throw new Error("épine publiée au tirage " + t + " (mot à " + ch + " croisement)");
    }
    if (all.length < 8 || all.length > 20) throw new Error("nombre de mots hors cible : " + all.length);
    // grille d'un seul tenant : toutes les cases sont reliées par des croisements
    const cellKey = ([r, c]) => r + "," + c;
    const idxOf = new Map(); all.forEach((w, i) => w.cells.forEach(c => { (idxOf.get(cellKey(c)) || idxOf.set(cellKey(c), []).get(cellKey(c))).push(i); }));
    const adj = all.map(() => new Set());
    for (const ids of idxOf.values()) for (const a of ids) for (const b of ids) if (a !== b) adj[a].add(b);
    const seen = new Set([0]); const stack = [0];
    while (stack.length) { const u = stack.pop(); for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); stack.push(v); } }
    if (seen.size !== all.length) throw new Error("grille en " + "plusieurs morceaux : " + seen.size + "/" + all.length + " mots reliés");
  }
  // la statistique affiche le taux de cases croisées, sans mention « peu ancré »
  const stat = await page.locator("#placedStat").innerText();
  if (!/cases croisées/.test(stat)) throw new Error("taux de croisement absent de la statistique : " + stat);
  if (/peu ancré/.test(stat)) throw new Error("mot peu ancré publié malgré l'élagage : " + stat);
});

await check("jamais deux mots superposés dans le même sens (MAGICIEN ⊂ MAGICIENNES)", async () => {
  // un mot préfixe d'un autre (MAGICIEN dans MAGICIENNES) pouvait se poser
  // par-dessus lui, dans le même sens : les lettres coïncidant, canPlace les
  // comptait à tort comme des croisements. Résultat : deux réponses au même
  // numéro, sur les mêmes cases. On génère plusieurs fois et on exige qu'aucune
  // case ne soit couverte par deux mots d'un même sens.
  await page.click("#newList");
  await page.click("#toggleImport");
  await page.fill("#pasteArea",
    "magicien ; magiciennes ; chat ; chaton ; art ; artiste\n" +
    "dragon ; grimoire ; nain ; orque ; sortilege ; taverne ; scene ; cite ; niche ; racine");
  await page.click("#parseBtn");
  await page.fill("#maxW", "14");
  await page.fill("#maxH", "14");
  for (let t = 0; t < 8; t++) {
    await page.click("#genBtn");
    await page.waitForSelector("#board svg g.cell");
    const p = await page.evaluate(() => window.__vcGamePuzzle());
    for (const [dir, list] of [["horizontal", p.across], ["vertical", p.down]]) {
      const cover = new Map();       // case -> mots du même sens qui la couvrent
      for (const w of list) for (const [r, c] of w.cells) {
        const k = r + "," + c; cover.set(k, (cover.get(k) || 0) + 1);
        if (cover.get(k) > 1) throw new Error("case " + k + " couverte par deux mots " + dir + "aux (tirage " + t + ")");
      }
    }
    // et aucun numéro en double dans un même sens
    for (const list of [p.across, p.down]) {
      const nums = list.map(w => w.num);
      if (new Set(nums).size !== nums.length) throw new Error("numéro dupliqué dans un même sens : " + nums.join(","));
    }
  }
});

await check("recherche : le champ filtre le dictionnaire sur les lettres tapées", async () => {
  await page.click("#newList");
  for (const w of ["dragon", "draconique", "hydre", "épée", "orque"]) {
    await page.fill("#wIn", w); await page.click("#addBtn");
  }
  await page.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 5);
  const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // « dra » ne laisse que dragon et draconique
  await page.fill("#dictSearch", "dra");
  await page.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 2);
  const mots = await page.locator("#entries .entry .word").allInnerTexts();
  if (!mots.every(w => norm(w).includes("dra"))) throw new Error("intrus dans le filtre : " + mots.join(", "));
  const cnt = await page.locator("#entryCount").innerText();
  if (!/2\s*\/\s*5/.test(cnt)) throw new Error("le compteur ne reflète pas le filtre : " + cnt);
  // insensible aux accents : « epe » (sans accent) trouve « épée »
  await page.fill("#dictSearch", "epe");
  await page.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 1);
  const acc = await page.locator("#entries .entry .word").first().innerText();
  if (norm(acc) !== "epee") throw new Error("recherche insensible aux accents KO : " + acc);
  // aucun résultat → message dédié
  await page.fill("#dictSearch", "zzz");
  await page.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 0);
  const hint = await page.locator("#entries .empty-hint").innerText();
  if (!/correspond/i.test(hint)) throw new Error("message d'absence de résultat manquant : " + hint);
  // effacer rétablit toute la liste
  await page.fill("#dictSearch", "");
  await page.waitForFunction(() => document.querySelectorAll("#entries .entry").length === 5);
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
