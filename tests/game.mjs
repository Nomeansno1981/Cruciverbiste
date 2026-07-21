// Test du site public (donjons.html) sur les emulateurs Firebase : connexion,
// lecture de la grille du jour (repli sur la demonstration si aucune n'est
// publiee), jeu, et enregistrement du resultat du joueur.
// A lancer via : npm run test:game
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// En mode #emu la page importe le SDK depuis ./firebasejs/ : copie locale.
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
  console.log("SDK Firebase telecharge dans tests/vendor/firebasejs/");
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

await page.goto(url);

await check("connexion Google puis montage du jeu", async () => {
  await page.waitForSelector("#gGoogle:not([disabled])");
  await page.click("#gGoogle");
  await page.waitForSelector("#authGate", { state: "hidden" });
  await page.waitForSelector("#board .cell");
  const n = await page.locator("#board .cell").count();
  if (n !== 120) throw new Error("attendu 120 cases (demonstration), obtenu " + n);
});

await check("le profil par defaut affiche le pseudo tire de l'e-mail", async () => {
  await page.waitForFunction(() => window.__ddef && window.__ddef.profile);
  const pseudo = await page.locator("#hdrPseudo").innerText();
  if (pseudo !== "joueur") throw new Error("pseudo affiche : " + pseudo);
});

await check("faute de grille publiee, la demonstration est jouee", async () => {
  const src = await page.evaluate(() => window.__ddef.source);
  if (src !== "demo") throw new Error("source de la grille : " + src);
});

await check("saisie au clavier", async () => {
  await page.evaluate(() => window.__play.selectClue("across", 1)); // KOBOLD, [0,2]
  await page.keyboard.type("k");
  const l = await page.evaluate(() => window.__play.letterAt(0, 2));
  if (l !== "K") throw new Error("touche sans effet : " + l);
});

await check("resolution : le resultat du joueur (avec XP) est enregistre en ligne", async () => {
  await page.evaluate(() => window.__play.fillSolution());
  await page.waitForFunction(() => window.__ddef && window.__ddef.result);
  const r = await page.evaluate(() => window.__ddef.result);
  if (!r || r.solved !== true) throw new Error("resultat non enregistre : " + JSON.stringify(r));
  if (typeof r.seconds !== "number") throw new Error("duree absente du resultat");
  if (typeof r.xp !== "number" || r.xp < 20) throw new Error("XP absente ou invalide dans le resultat : " + JSON.stringify(r));
  if (typeof r.words !== "number") throw new Error("nombre de mots absent du resultat");
});

await check("badges : la fenetre annonce les hauts faits gagnes a la resolution", async () => {
  await page.waitForSelector("#badgeModal:not([hidden])", { timeout: 6000 });
  const info = await page.evaluate(() => ({
    nouveaux: window.__ddef.newBadges || [],
    lignes: document.querySelectorAll("#badgeWon li").length,
    titre: document.getElementById("badgeTitle").textContent
  }));
  // demonstration resolue d'un coup, sans aide : au moins 1re grille, vitesse, puriste
  for (const id of ["grilles-1", "vitesse-3", "puriste"]) {
    if (!info.nouveaux.includes(id)) throw new Error("badge attendu absent (" + id + ") : " + JSON.stringify(info.nouveaux));
  }
  if (info.lignes !== info.nouveaux.length) throw new Error("la fenetre ne liste pas tous les badges : " + info.lignes + " / " + info.nouveaux.length);
  if (!/badge/i.test(info.titre)) throw new Error("titre de la fenetre inattendu : " + info.titre);
  const closed = await page.evaluate(() => { document.getElementById("closeBadge").click(); return document.getElementById("badgeModal").hidden; });
  if (closed !== true) throw new Error("la fenetre de badge ne s'est pas fermee");
});

await check("le profil affiche le niveau, l'XP totale et le detail par grille", async () => {
  await page.click("#profileBtn");
  await page.waitForSelector("#profileModal:not([hidden])");
  await page.waitForSelector("#histList li");
  const info = await page.evaluate(() => {
    const box = document.getElementById("levelBox");
    const first = document.querySelector("#histList li .t");
    return {
      boxHidden: box.hidden,
      num: document.getElementById("levelNum").textContent,
      title: document.getElementById("levelTitle").textContent,
      total: document.getElementById("xpTotal").textContent,
      next: document.getElementById("levelNext").textContent,
      fill: document.getElementById("levelFill").style.width,
      line: first ? first.textContent : ""
    };
  });
  if (info.boxHidden) throw new Error("bloc de niveau masque dans le profil");
  if (!/^\d+$/.test(info.num) || Number(info.num) < 1) throw new Error("numero de niveau invalide : " + info.num);
  if (!info.title) throw new Error("titre de niveau absent");
  if (!/^\d+$/.test(info.total) || Number(info.total) < 20) throw new Error("total d'XP invalide : " + info.total);
  if (!/XP/.test(info.next)) throw new Error("indication du prochain palier absente : " + info.next);
  if (!/%$/.test(info.fill)) throw new Error("barre de progression sans largeur : " + info.fill);
  if (!/XP/.test(info.line)) throw new Error("XP absente de la ligne d'historique : " + info.line);
  await page.click("#closeProfile");
});

await check("badges : le profil affiche les badges gagnes (couleur) et a debloquer (grises)", async () => {
  await page.click("#profileBtn");
  await page.waitForSelector("#profileModal:not([hidden])");
  await page.waitForSelector("#badgeGrid .badge");
  const info = await page.evaluate(() => ({
    total: document.querySelectorAll("#badgeGrid .badge").length,
    gagnes: document.querySelectorAll("#badgeGrid .badge.on").length,
    compteur: document.getElementById("badgesCount").textContent
  }));
  if (info.total !== 13) throw new Error("grille de badges incomplete : " + info.total + " (attendu 13)");
  if (info.gagnes < 3) throw new Error("badges gagnes non mis en couleur : " + info.gagnes);
  if (!/\d+\s*\/\s*13/.test(info.compteur)) throw new Error("compteur de badges inattendu : " + info.compteur);
  await page.click("#closeProfile");
});

await check("classement : la fiche du joueur est publiee (total et mois courant)", async () => {
  await page.waitForFunction(() => window.__ddef && window.__ddef.myBoard && window.__ddef.myBoard.total > 0);
  const b = await page.evaluate(() => window.__ddef.myBoard);
  const r = await page.evaluate(() => window.__ddef.result);
  if (b.total !== r.xp) throw new Error("total du classement != XP du resultat : " + b.total + " vs " + r.xp);
  const mk = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
  if (b.months[mk] !== r.xp) throw new Error("XP du mois courant absente du classement : " + JSON.stringify(b.months) + " (mois " + mk + ")");
});

// L'affichage du tableau de classement (onglets mois/cumul, joueur mis en avant)
// est verifie sur l'accueil : voir tests/accueil.mjs. Ici on garde la publication
// de la fiche (ci-dessus) et les regles de securite (ci-dessous).
await check("classement : regles de securite (lecture d'autrui permise, ecriture refusee)", async () => {
  const probe = await page.evaluate(() => window.__ddef.lbProbe());
  if (probe.read !== "ok") throw new Error("la lecture du classement d'un autre joueur a ete refusee : " + probe.read);
  if (!/denied|permission/i.test(probe.write)) throw new Error("l'ecriture dans la fiche d'un autre joueur aurait du etre refusee, obtenu : " + probe.write);
});

await check("la serie passe a 1 apres la premiere reussite", async () => {
  await page.waitForFunction(() => window.__ddef && window.__ddef.streak === 1);
  const s = await page.evaluate(() => { const el = document.getElementById("streak"); return { hidden: el.hidden, text: el.textContent.trim() }; });
  if (s.hidden) throw new Error("badge de serie masque apres reussite");
  if (!/1/.test(s.text)) throw new Error("serie affichee : " + s.text);
});

await check("calcul de la serie : jours consecutifs et remise a zero apres un trou", async () => {
  const r = await page.evaluate(() => {
    const n = window.__ddef.nextStreakCount, e = window.__ddef.effectiveStreak;
    return {
      fresh: n(null, "2026-07-19"),
      consec: n({ count: 4, lastDate: "2026-07-18" }, "2026-07-19"),
      sameDay: n({ count: 4, lastDate: "2026-07-19" }, "2026-07-19"),
      gap: n({ count: 4, lastDate: "2026-07-10" }, "2026-07-19"),
      aliveToday: e({ count: 5, lastDate: "2026-07-19" }, "2026-07-19"),
      aliveYesterday: e({ count: 5, lastDate: "2026-07-18" }, "2026-07-19"),
      broken: e({ count: 5, lastDate: "2026-07-17" }, "2026-07-19")
    };
  });
  const exp = { fresh: 1, consec: 5, sameDay: 4, gap: 1, aliveToday: 5, aliveYesterday: 5, broken: 0 };
  for (const k in exp) if (r[k] !== exp[k]) throw new Error(`${k} : attendu ${exp[k]}, obtenu ${r[k]}`);
});

await check("profil : redimensionnement d'une image en petit JPEG (data URL)", async () => {
  const d = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 12; c.height = 8;
    c.getContext("2d").fillRect(0, 0, 12, 8);
    const blob = await new Promise(res => c.toBlob(res, "image/png"));
    const file = new File([blob], "a.png", { type: "image/png" });
    return window.__ddef.resize(file, 128);
  });
  if (!/^data:image\/jpeg/.test(d)) throw new Error("resize n'a pas produit un JPEG : " + String(d).slice(0, 30));
});

await check("profil : pseudo et avatar enregistres et persistants apres rechargement", async () => {
  await page.click("#profileBtn");
  await page.waitForSelector("#profileModal:not([hidden])");
  await page.fill("#pseudoInput", "Rolista");
  await page.evaluate(() => window.__ddef.setPendingAvatar("data:image/jpeg;base64,TESTAVATAR=="));
  await page.click("#saveProfile");
  await page.waitForFunction(() => window.__ddef.profile && window.__ddef.profile.pseudo === "Rolista");
  const p = await page.evaluate(() => window.__ddef.profile);
  if (!/^data:image/.test(p.avatar || "")) throw new Error("avatar non enregistre");
  const hp = await page.locator("#hdrPseudo").innerText();
  if (hp !== "Rolista") throw new Error("pseudo entete apres enregistrement : " + hp);
  await page.reload();
  await page.waitForFunction(() => window.__ddef && window.__ddef.profile);
  const p2 = await page.evaluate(() => window.__ddef.profile);
  if (p2.pseudo !== "Rolista" || !/^data:image/.test(p2.avatar || "")) throw new Error("profil non persistant : " + JSON.stringify(p2).slice(0, 60));
});

await check("profil : l'historique liste la grille reussie", async () => {
  await page.waitForSelector("#board .cell");
  await page.click("#profileBtn");
  await page.waitForSelector("#profileModal:not([hidden])");
  await page.waitForSelector("#histList li");
  const rows = await page.locator("#histList li:not(.empty)").count();
  if (rows < 1) throw new Error("historique vide alors qu'une grille a ete reussie");
  await page.click("#closeProfile");
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
console.log("\nSite public verifie : tous les controles passent.");
