// Robustesse du moteur : une grille absente ou malformee (document vide, sans
// cases ni mots) ne doit JAMAIS produire une page blanche ni planter — le moteur
// affiche « Grille indisponible ». On injecte la grille via la cle d'apercu
// (dd-apercu) que lit jouer.html, puis on verifie le rendu.
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
    const file = clean === "/" ? "jouer.html" : clean.slice(1);
    const data = await readFile(path.join(root, file));
    const type = file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : file.endsWith(".css") ? "text/css; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch { res.writeHead(404); res.end("introuvable"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/jouer.html`;

async function launchBrowser(){
  const opts = { chromiumSandbox: false };
  try { return await chromium.launch(opts); }
  catch (first) {
    const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
    const candidates = [];
    if (existsSync(dir)) for (const d of readdirSync(dir))
      for (const p of [path.join(dir, d, "chrome-linux", "chrome"), path.join(dir, d, "chrome-linux", "headless_shell")])
        if (existsSync(p)) candidates.push(p);
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

// charge jouer.html avec une grille d'apercu injectee, renvoie { page, errs }
async function mount(puzzle){
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await context.addInitScript(v => { try { localStorage.setItem("dd-apercu", v); } catch(e){} }, JSON.stringify(puzzle));
  await page.goto(base);
  await page.waitForLoadState("networkidle");
  return { page, errs, context };
}

// 1. document existant mais sans across/down (l'ancien bug : plantait for..of PUZZLE.across)
await check("grille { solution:{} } sans mots : message, pas de page blanche ni de plantage", async () => {
  const { page, errs, context } = await mount({ solution: {} });
  await page.waitForSelector(".board-empty", { timeout: 8000 });
  const txt = await page.locator(".board-empty").innerText();
  if (!/indisponible/i.test(txt)) throw new Error("message attendu « indisponible », obtenu : " + txt);
  const a = await page.locator("#acrossList li").count(), d = await page.locator("#downList li").count();
  if (a + d !== 0) throw new Error("les listes de definitions devraient etre vides (" + a + " + " + d + ")");
  const cells = await page.locator("#board .cell").count();
  if (cells !== 0) throw new Error("aucune case attendue, obtenu " + cells);
  if (errs.length) throw new Error("erreur JS : " + errs.join(" | "));
  await context.close();
});

// 2. grille vide mais bien formee (solution {}, mots [], dimensions) : idem
await check("grille vide (0 case, 0 mot) : message, pas de plantage", async () => {
  const { page, errs, context } = await mount({ solution: {}, across: [], down: [], rows: 5, cols: 5, numbers: {} });
  await page.waitForSelector(".board-empty", { timeout: 8000 });
  if (errs.length) throw new Error("erreur JS : " + errs.join(" | "));
  await context.close();
});

// 3. garde-fou non declenche a tort : une vraie grille se monte normalement
await check("une grille valide se monte normalement (le garde-fou ne se declenche pas a tort)", async () => {
  const valid = {
    title: "Test", rows: 1, cols: 3,
    solution: { "0,0": "O", "0,1": "U", "0,2": "I" }, numbers: { "0,0": 1 }, bars: {},
    across: [{ num: 1, clue: "Affirmation", cells: [[0,0],[0,1],[0,2]] }], down: []
  };
  const { page, errs, context } = await mount(valid);
  await page.waitForSelector("#board .cell", { timeout: 8000 });
  const cells = await page.locator("#board .cell").count();
  if (cells !== 3) throw new Error("3 cases attendues, obtenu " + cells);
  if (await page.locator(".board-empty").count() !== 0) throw new Error("message « indisponible » affiche a tort");
  const a = await page.locator("#acrossList li").count();
  if (a < 1) throw new Error("la definition horizontale devrait etre listee");
  if (errs.length) throw new Error("erreur JS : " + errs.join(" | "));
  await context.close();
});

await browser.close();
server.close();

if (failures.length) { console.error("\n" + failures.length + " contrôle(s) en échec."); process.exit(1); }
console.log("\nGrille indisponible : tous les contrôles passent.");
