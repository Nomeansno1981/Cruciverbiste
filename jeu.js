// Donjons & Definitions : moteur de resolution partage.
// monterJeu(PUZZLE, opts) construit la grille interactive dans la page hote
// (elements attendus par id : board, gridarea, cluebar, cluebarTxt, prevClue,
// nextClue, hintBtn, solveBtn, muteBtn, kbd, acrossList, downList, timer,
// banner, date). opts.onSolved(secondes, {hints, solutions, words, xp}) a la
// resolution ; opts.dateText remplace la date affichee. Renvoie une petite API
// de controle (aussi exposee en window.__play pour les tests).

// Score d'une grille resolue (XP), fonction pure et reutilisable (banniere,
// ecran de fin, historique, classement). Bareme « par mot » :
//   - chaque mot trouve rapporte 20 points ;
//   - chaque indice demande sur un mot lui coute 5 points (plancher a 0) ;
//   - un mot revele par « Solution », ou dont TOUTES les lettres ont ete
//     demandees en indices, ne rapporte rien ;
//   - bonus de rapidite +50 / +75 / +100 sous 10 / 5 / 3 minutes, multiplie
//     par la part de mots trouves entierement seul : reveler la grille (ou la
//     completer surtout a coups d'indices) ne rapporte donc aucun bonus.
// `words` est soit la liste des mots [{ cells, hints, solution }], soit un
// simple nombre (grille supposee sans aide, pour un appel de commodite).
// detailScore renvoie le detail (pour l'ecran de fin) ; scoreXP juste l'XP.
export function detailScore({ seconds = 0, words = 20 } = {}){
  const liste = Array.isArray(words)
    ? words
    : Array.from({ length: Math.max(1, words) }, () => ({ cells: 5, hints: 0, solution: false }));
  let base = 0, seuls = 0, aides = 0, reveles = 0;
  for(const w of liste){
    const cells = w.cells || 0, hints = w.hints || 0;
    // mot entierement devoile (Solution, ou toutes ses lettres en indices) : 0 point
    if(w.solution || (cells > 0 && hints >= cells)){ reveles++; continue; }
    base += Math.max(0, 20 - 5 * hints);
    if(hints === 0) seuls++; else aides++;
  }
  let seuilVitesse = 0;
  if(seconds < 180) seuilVitesse = 100;
  else if(seconds < 300) seuilVitesse = 75;
  else if(seconds < 600) seuilVitesse = 50;
  const part = liste.length ? seuls / liste.length : 0;
  const bonus = Math.round(seuilVitesse * part);
  return { xp: base + bonus, base, bonus, seuilVitesse, part, seuls, aides, reveles, mots: liste.length };
}
export function scoreXP(args){ return detailScore(args).xp; }

// Echelle de progression facon jeu de role : titres et seuils d'XP cumulee.
// Donnees volontairement isolees pour etre faciles a retoucher (renommer un
// rang, ajuster un palier) sans toucher a la logique.
// Seuils calibres pour le bareme « par mot » (une grille propre et rapide vaut
// quelques centaines d'XP) : environ le double de l'ancienne echelle, pour que
// la progression garde le meme rythme qu'avant sur plusieurs mois de jeu.
export const NIVEAUX = [
  { seuil: 0,     titre: "Roturier" },
  { seuil: 300,   titre: "Apprenti" },
  { seuil: 900,   titre: "Aventurier" },
  { seuil: 1800,  titre: "Éclaireur" },
  { seuil: 3200,  titre: "Vétéran" },
  { seuil: 5200,  titre: "Chevalier" },
  { seuil: 8000,  titre: "Héros" },
  { seuil: 12000, titre: "Champion" },
  { seuil: 17000, titre: "Maître" },
  { seuil: 24000, titre: "Grand Maître" },
  { seuil: 34000, titre: "Légende" },
  { seuil: 50000, titre: "Mythe" }
];

// Niveau atteint pour une XP cumulee : renvoie le rang (1..N), son titre, le
// seuil courant, le seuil du rang suivant (null au maximum) et la progression
// (0..1) vers ce rang suivant. Fonction pure, testable et reutilisable.
export function niveauPourXp(xpTotal){
  const xp = Math.max(0, xpTotal || 0);
  let i = 0;
  for(let k = 0; k < NIVEAUX.length; k++){ if(xp >= NIVEAUX[k].seuil) i = k; }
  const cur = NIVEAUX[i], next = NIVEAUX[i + 1] || null;
  return {
    niveau: i + 1,
    titre: cur.titre,
    seuil: cur.seuil,
    prochain: next ? next.seuil : null,
    titreProchain: next ? next.titre : null,
    max: !next,
    progression: next ? (xp - cur.seuil) / (next.seuil - cur.seuil) : 1
  };
}

// ---- Badges : hauts faits du joueur ----
// Definitions partagees (jeu + accueil). `emoji` illustre le badge de facon
// provisoire, en attendant les icones fournies ; `icon` (chemin/URL), s'il est
// present, le remplace a l'affichage. `cat` regroupe les badges sur le profil.
export const BADGES = [
  { id: "grilles-1",   nom: "Touriste des catacombes",    cat: "Grilles terminées", icon: "icones/grilles-1.svg",   emoji: "🗺️", desc: "Terminer une première grille." },
  { id: "grilles-10",  nom: "Explorateur des profondeurs", cat: "Grilles terminées", icon: "icones/grilles-10.svg",  emoji: "🏮", desc: "Terminer dix grilles." },
  { id: "grilles-100", nom: "Maître des ténèbres",         cat: "Grilles terminées", icon: "icones/grilles-100.svg", emoji: "👑", desc: "Terminer cent grilles." },
  { id: "vitesse-10",  nom: "Lame preste",        cat: "Rapidité", icon: "icones/vitesse-10.svg", emoji: "🗡️", desc: "Terminer une grille en moins de 10 minutes." },
  { id: "vitesse-5",   nom: "Vif comme l'éclair",  cat: "Rapidité", icon: "icones/vitesse-5.svg",  emoji: "⚡", desc: "Terminer une grille en moins de 5 minutes." },
  { id: "vitesse-3",   nom: "Foudre de guerre",   cat: "Rapidité", icon: "icones/vitesse-3.svg",  emoji: "🌩️", desc: "Terminer une grille en moins de 3 minutes." },
  { id: "premier",     nom: "Aux aguets", cat: "Rang du jour", icon: "icones/premier.svg", emoji: "👁️", desc: "Être le premier à terminer la grille du jour." },
  { id: "dernier",     nom: "Sur le fil", cat: "Rang du jour", icon: "icones/dernier.svg", emoji: "🌙", desc: "Terminer la grille du jour après 23 h 50." },
  { id: "serie-10",  nom: "Braise ardente",  cat: "Série", icon: "icones/serie-10.svg",  emoji: "🔥", desc: "Atteindre une série de dix jours." },
  { id: "serie-50",  nom: "Flamme vivace",   cat: "Série", icon: "icones/serie-50.svg",  emoji: "🎆", desc: "Atteindre une série de cinquante jours." },
  { id: "serie-100", nom: "Brasier éternel", cat: "Série", icon: "icones/serie-100.svg", emoji: "🌋", desc: "Atteindre une série de cent jours." },
  { id: "puriste",   nom: "Puriste",   cat: "Talent", icon: "icones/puriste.svg",   emoji: "💎", desc: "Terminer une grille sans aucun indice ni solution." },
  { id: "necromant", nom: "Nécromant", cat: "Talent", icon: "icones/necromant.svg", emoji: "💀", desc: "Ranimer une grille d'archive (terminer une grille précédente)." }
];
const BADGE_IDS = new Set(BADGES.map(b => b.id));

// Badges pour lesquels le joueur QUALIFIE au vu d'une resolution et de ses
// totaux. Fonction pure : la page hote fait la difference avec ceux deja acquis
// (on n'attribue jamais deux fois, et un badge deja gagne reste acquis).
export function evaluerBadges(ctx = {}){
  const g = [];
  const t = ctx.totalSolved || 0;
  if(t >= 1)   g.push("grilles-1");
  if(t >= 10)  g.push("grilles-10");
  if(t >= 100) g.push("grilles-100");
  if(typeof ctx.seconds === "number"){
    if(ctx.seconds < 600) g.push("vitesse-10");
    if(ctx.seconds < 300) g.push("vitesse-5");
    if(ctx.seconds < 180) g.push("vitesse-3");
  }
  const st = ctx.streak || 0;
  if(st >= 10)  g.push("serie-10");
  if(st >= 50)  g.push("serie-50");
  if(st >= 100) g.push("serie-100");
  if(ctx.noAid)        g.push("puriste");
  if(ctx.isArchive)    g.push("necromant");
  if(ctx.lateFinish)   g.push("dernier");
  if(ctx.isFirstOfDay) g.push("premier");
  return g;
}

// Badges rattrapables a posteriori depuis l'historique du joueur : grilles
// terminees (compte), meilleur temps (rapidite), une reussite sans aide
// (puriste) et la serie courante. Les badges « de l'instant » (premier a finir,
// sur le fil, necromant) ne se decernent qu'au moment voulu, pas retroactivement.
export function badgesRetroactifs(results, streakCount){
  const g = [];
  const solved = (results || []).filter(r => r && r.solved);
  const n = solved.length;
  if(n >= 1)   g.push("grilles-1");
  if(n >= 10)  g.push("grilles-10");
  if(n >= 100) g.push("grilles-100");
  let minSec = Infinity, sansAide = false;
  for(const r of solved){
    if(typeof r.seconds === "number") minSec = Math.min(minSec, r.seconds);
    if(r.hints === 0 && r.solutions === 0) sansAide = true;   // champs presents = reussite enregistree
  }
  if(minSec < 600) g.push("vitesse-10");
  if(minSec < 300) g.push("vitesse-5");
  if(minSec < 180) g.push("vitesse-3");
  if(sansAide) g.push("puriste");
  const s = streakCount || 0;
  if(s >= 10)  g.push("serie-10");
  if(s >= 50)  g.push("serie-50");
  if(s >= 100) g.push("serie-100");
  return g;
}

// Nombre de badges valides reellement acquis (ignore les cles inconnues).
export function compterBadges(earned){
  return Object.keys(earned || {}).filter(id => BADGE_IDS.has(id)).length;
}

// Rendu de la grille de badges dans un conteneur (profil des deux pages).
// `earned` : objet { id: date }, un badge absent est affiche grise (a debloquer).
export function rendreBadges(container, earned = {}){
  if(!container) return;
  container.innerHTML = "";
  for(const b of BADGES){
    const acquis = !!(earned && earned[b.id]);
    const el = document.createElement("div");
    el.className = "badge" + (acquis ? " on" : "");
    el.title = b.nom + " — " + b.desc + (acquis ? "" : " (à débloquer)");
    const ico = b.icon ? '<img class="badge-img" alt="" src="' + b.icon + '">' : b.emoji;
    el.innerHTML = '<span class="badge-ico" aria-hidden="true">' + ico + '</span>'
      + '<span class="badge-nom"></span>';
    el.querySelector(".badge-nom").textContent = b.nom;
    container.appendChild(el);
  }
}

// ---- Apercu du donjon (forme seule, sans lettres) ----
// Dessine le plan de donjon facon plan dessine (methode Dyson Logos) dans un
// <svg> : uniquement la forme (salles, murs interieurs pointilles, murs
// exterieurs epais, portes et bande de rocher hachuree). Aucune lettre ni
// definition. Partage par le jeu (grille interactive) et par l'accueil (apercus
// statiques de la grille du jour et des grilles precedentes).
//   svgEl : element <svg> a remplir (width/height/viewBox poses ici) ;
//   cell  : taille d'une case (echelle interne ; le SVG est ensuite mis a
//           l'echelle par son viewBox), band : marge de rocher en cases,
//   has(r,c) : la case est-elle une salle jouable ?  bars : portes,
//   simple : true = salles/murs/portes seulement (petits apercus, sans rocher).
export function dessinerDonjon(svgEl, { rows, cols, cell, band = 1, has, bars = {}, simple = false } = {}){
  if(!svgEl || !(rows > 0) || !(cols > 0) || typeof has !== "function") return;
  const K = (r,c) => r + "," + c;
  const M = Math.round(cell * band);
  svgEl.setAttribute("width", cols*cell + 2*M);
  svgEl.setAttribute("height", rows*cell + 2*M);
  svgEl.setAttribute("viewBox", `${-M} ${-M} ${cols*cell + 2*M} ${rows*cell + 2*M}`);
  const rnd = (a,b) => { const t = Math.sin(a*12.9898 + b*78.233) * 43758.5453; return t - Math.floor(t); };
  const clip = (x1,y1,x2,y2, xmin,ymin,xmax,ymax) => {
    let t0=0, t1=1; const dx=x2-x1, dy=y2-y1;
    const p=[-dx,dx,-dy,dy], q=[x1-xmin,xmax-x1,y1-ymin,ymax-y1];
    for(let k=0;k<4;k++){ if(p[k]===0){ if(q[k]<0) return null; } else { const rr=q[k]/p[k]; if(p[k]<0){ if(rr>t1) return null; if(rr>t0) t0=rr; } else { if(rr<t0) return null; if(rr<t1) t1=rr; } } }
    return [x1+t0*dx, y1+t0*dy, x1+t1*dx, y1+t1*dy];
  };
  const EDGES = [ {ei:0,dr:-1,dc:0,nx:0,ny:-1}, {ei:1,dr:1,dc:0,nx:0,ny:1}, {ei:2,dr:0,dc:-1,nx:-1,ny:0}, {ei:3,dr:0,dc:1,nx:1,ny:0} ];
  const pts = (r,c,e) => {
    const x=c*cell, y=r*cell;
    if(e.dr===-1) return [x,y, x+cell,y];
    if(e.dr===1)  return [x,y+cell, x+cell,y+cell];
    if(e.dc===-1) return [x,y, x,y+cell];
    return [x+cell,y, x+cell,y+cell];
  };
  const barAt = (r,c,e) => { const b = bars[K(r,c)]; return !!b && ((e.dc===-1 && b.left) || (e.dr===-1 && b.top)); };
  const small = cell < 26;
  const wobAmp = cell * 0.045;
  const wob = (x0,y0,x1,y1) => {
    const dx=x1-x0, dy=y1-y0, len=Math.hypot(dx,dy)||1;
    const off=(rnd(x0+x1+1.3, y0+y1+2.7)*2-1)*wobAmp*(len/cell);
    const cx=(x0+x1)/2 - dy/len*off, cy=(y0+y1)/2 + dx/len*off;
    return `M ${x0} ${y0} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x1} ${y1} `;
  };
  let interior="", outer="", doors="", hatch="", greyRects="", pebbles="";
  // 1) murs exterieurs epais, bords interieurs pointilles et portes.
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    if(!has(r,c)) continue;
    for(const e of EDGES){
      const [x0,y0,x1,y1] = pts(r,c,e);
      const isBar = barAt(r,c,e);
      if(has(r+e.dr, c+e.dc) && !isBar){
        if(e.dr===-1 || e.dc===-1) interior += `M ${x0} ${y0} L ${x1} ${y1} `;
        continue;
      }
      if(isBar){
        const tx=(x1-x0)/cell, ty=(y1-y0)/cell;
        const mx=(x0+x1)/2, my=(y0+y1)/2, half=cell*0.20, d=cell*0.11;
        const ax=mx-tx*half, ay=my-ty*half, bx=mx+tx*half, by=my+ty*half;
        doors += wob(x0,y0,ax,ay) + wob(bx,by,x1,y1);
        doors += `M ${(ax+e.nx*d).toFixed(1)} ${(ay+e.ny*d).toFixed(1)} L ${(bx+e.nx*d).toFixed(1)} ${(by+e.ny*d).toFixed(1)} L ${(bx-e.nx*d).toFixed(1)} ${(by-e.ny*d).toFixed(1)} L ${(ax-e.nx*d).toFixed(1)} ${(ay-e.ny*d).toFixed(1)} Z `;
        continue;
      }
      outer += wob(x0,y0,x1,y1);
    }
  }
  // 2) bande de rocher hachuree (omise en mode simple : petits apercus).
  if(!simple){
    const bandN = cell ? M/cell : 2;
    const winCells = Math.ceil(bandN) + 1;
    const REACH = small ? 0.85 : 1.05, AMP = small ? 0.42 : 0.72, CORE = 0.5, JIT = small ? 0.3 : 0.5;
    const fbm = (X,Y) => 0.34*Math.sin(X*1.4 + Y*0.9 + 0.5)
                       + 0.38*Math.sin(X*2.8 - Y*1.8 + 2.4)
                       + 0.32*Math.sin(X*1.7 + Y*3.2 + 4.1)
                       + 0.18*Math.sin((X - Y)*4.6 + 1.1)
                       + 0.10*Math.sin(X*7.1 + Y*6.0 + 2.7);
    const NMAX = 1.32, maxReach = REACH + AMP*NMAX + JIT*0.5;
    const distGrid = (px,py) => {
      let best = Infinity;
      const cc = Math.floor(px/cell), cr = Math.floor(py/cell);
      for(let r=cr-winCells; r<=cr+winCells; r++) for(let c=cc-winCells; c<=cc+winCells; c++){
        if(!has(r,c)) continue;
        const dx = Math.max(c*cell - px, 0, px - (c+1)*cell), dy = Math.max(r*cell - py, 0, py - (r+1)*cell);
        const d = dx*dx + dy*dy; if(d<best) best=d;
      }
      return Math.sqrt(best)/cell;
    };
    const contourAt = (X,Y,ti,tj) => {
      const wx = X + 0.6*Math.sin(Y*1.9 + 0.7), wy = Y + 0.6*Math.sin(X*1.7 + 2.3);
      const jit = (rnd(ti*13.1+7, tj*7.7+3) - 0.5) * JIT;
      return REACH + AMP*fbm(wx, wy) + jit;
    };
    const nT = small ? 3 : 4, gap = cell*(small ? 0.15 : 0.115);
    for(let r=-winCells;r<rows+winCells;r++) for(let c=-winCells;c<cols+winCells;c++){
      if(has(r,c)) continue;
      const x=c*cell, y=r*cell;
      if(distGrid(x+cell/2, y+cell/2) - 0.72 > maxReach) continue;
      for(let iu=0; iu<nT; iu++) for(let iv=0; iv<nT; iv++){
        const u0=iu*cell/nT, u1=(iu+1)*cell/nT, v0=iv*cell/nT, v1=(iv+1)*cell/nT;
        const cx=x+(u0+u1)/2, cy=y+(v0+v1)/2, dG=distGrid(cx,cy);
        if(dG >= CORE && dG > contourAt(cx/cell, cy/cell, c*nT+iu, r*nT+iv)) continue;
        const phi = rnd(r*7 + c*13 + iu*29 + iv*53 + 1, c*11 + r*17 + iu*23 + iv*7 + 1) * Math.PI;
        const dir=[Math.cos(phi),Math.sin(phi)], perp=[-Math.sin(phi),Math.cos(phi)];
        let sMin=Infinity, sMax=-Infinity;
        for(const p of [[u0,v0],[u1,v0],[u0,v1],[u1,v1]]){ const ss=p[0]*perp[0]+p[1]*perp[1]; if(ss<sMin)sMin=ss; if(ss>sMax)sMax=ss; }
        const BIG=cell*2;
        let si=0;
        for(let sp=sMin+gap*0.5; sp<sMax; sp+=gap){
          const bx=sp*perp[0], by=sp*perp[1];
          const cl=clip(bx-BIG*dir[0], by-BIG*dir[1], bx+BIG*dir[0], by+BIG*dir[1], u0,v0,u1,v1);
          if(!cl) continue;
          const t0=rnd(r*3+c*5+iu+iv*2+si*7+1, c*3+r*5+iu*2+iv+si*11+1)*0.34;
          const t1=1 - rnd(r*5+c*3+iu*3+iv+si*13+2, c*7+r+iu+iv*3+si*5+2)*0.34;
          const ax=cl[0]+(cl[2]-cl[0])*t0, ay=cl[1]+(cl[3]-cl[1])*t0;
          const zx=cl[0]+(cl[2]-cl[0])*t1, zy=cl[1]+(cl[3]-cl[1])*t1;
          hatch += `M ${(x+ax).toFixed(1)} ${(y+ay).toFixed(1)} L ${(x+zx).toFixed(1)} ${(y+zy).toFixed(1)} `;
          si++;
        }
      }
      const cgx=x+cell/2, cgy=y+cell/2, dGc=distGrid(cgx,cgy);
      if((dGc < CORE || dGc <= REACH + AMP*fbm(cgx/cell, cgy/cell) - 0.2) && rnd(r*3+c*29+91, c*13+r*23+91) > 0.7){
        const px=cgx + (rnd(r*5+c*7+3, c*3+r*9+3)-0.5)*cell*0.42, py=cgy + (rnd(r*9+c*3+5, c*7+r*5+5)-0.5)*cell*0.42;
        const R0p=cell*(0.11+0.06*rnd(r+c+7, c+r+7)), nv=6+Math.floor(rnd(r*2+c*5+1, c*2+r*5+1)*4);
        let dd="";
        for(let k=0;k<nv;k++){
          const ang=(k/nv)*6.2832 + (rnd(r*3+c+k*7, c*3+r+k*5)-0.5)*0.7;
          const rad=R0p*(0.55 + 0.6*rnd(r+c*4+k*9, c+r*4+k*3));
          dd += (k===0?"M ":"L ") + (px+Math.cos(ang)*rad).toFixed(1) + " " + (py+Math.sin(ang)*rad).toFixed(1) + " ";
        }
        pebbles += dd + "Z ";
      }
    }
  }
  const wallW = Math.max(2, cell*0.08), hatchW = Math.max(0.7, cell*0.032), pebbleW = Math.max(0.8, cell*0.045);
  const dash = Math.max(1, cell*0.03).toFixed(1) + " " + Math.max(2, cell*0.07).toFixed(1);
  svgEl.innerHTML =
    greyRects +
    (hatch ? `<path d="${hatch.trim()}" fill="none" stroke="#1a1712" stroke-width="${hatchW.toFixed(2)}" stroke-linecap="round"/>` : "") +
    (pebbles ? `<path d="${pebbles.trim()}" fill="#fff" stroke="#1a1712" stroke-width="${pebbleW.toFixed(2)}" stroke-linejoin="round"/>` : "") +
    `<path d="${interior.trim()}" fill="none" stroke="#8f8674" stroke-width="1" stroke-dasharray="${dash}" stroke-linecap="round"/>` +
    `<path d="${outer.trim()}" fill="none" stroke="#1a1712" stroke-width="${wallW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${doors.trim()}" fill="none" stroke="#1a1712" stroke-width="${wallW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Apercu statique d'une grille (forme du donjon) dans un conteneur, a partir
// d'un objet grille ou de son JSON (champ `puzzle` de Firestore). Ne montre
// jamais les lettres : seule la presence d'une case (cle de `solution`) sert.
// La forme est recentree dans la grille (decalage entier de cases) pour que
// toutes les vignettes soient homogenes, meme si la grille n'occupe qu'une
// partie de l'espace (format fixe 15x15 a la creation).
export function apercuDonjon(container, puzzle, opts = {}){
  if(!container) return false;
  let p = puzzle;
  if(typeof p === "string"){ try{ p = JSON.parse(p); }catch(e){ p = null; } }
  if(!p || !p.solution || !(p.rows > 0) || !(p.cols > 0)){ container.innerHTML = ""; return false; }
  // cases occupees (cle "r,c") et leur boite englobante
  const cases = new Set();
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for(const k in p.solution){
    const i = k.indexOf(",");
    if(i < 0) continue;
    const r = +k.slice(0, i), c = +k.slice(i + 1);
    if(!Number.isFinite(r) || !Number.isFinite(c)) continue;
    cases.add(r + "," + c);
    if(r < minR) minR = r; if(r > maxR) maxR = r;
    if(c < minC) minC = c; if(c > maxC) maxC = c;
  }
  if(!cases.size){ container.innerHTML = ""; return false; }
  // decalage entier pour centrer la boite englobante dans la grille
  const offR = Math.round(((p.rows - 1) - (minR + maxR)) / 2);
  const offC = Math.round(((p.cols - 1) - (minC + maxC)) / 2);
  const has = (r, c) => cases.has((r - offR) + "," + (c - offC));
  let bars = p.bars || {};
  if((offR || offC) && bars){
    const shifted = {};
    for(const k in bars){ const i = k.indexOf(","); if(i < 0) continue; shifted[(+k.slice(0, i) + offR) + "," + (+k.slice(i + 1) + offC)] = bars[k]; }
    bars = shifted;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "donjon-preview");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");
  dessinerDonjon(svg, {
    rows: p.rows, cols: p.cols,
    cell: opts.cell || 22,
    band: (opts.band != null ? opts.band : 1),
    has, bars, simple: !!opts.simple
  });
  container.innerHTML = "";
  container.appendChild(svg);
  return true;
}

export function monterJeu(PUZZLE, opts = {}){
  // Grille absente ou malformee (document vide, sans cases ni mots) : on affiche
  // un message clair au lieu d'une page blanche, et on ne monte pas le reste.
  const jouable = !!(PUZZLE && PUZZLE.solution && typeof PUZZLE.solution === "object"
    && Object.keys(PUZZLE.solution).length
    && Array.isArray(PUZZLE.across) && Array.isArray(PUZZLE.down)
    && (PUZZLE.across.length + PUZZLE.down.length)
    && PUZZLE.rows > 0 && PUZZLE.cols > 0);
  if(!jouable){
    const b = document.getElementById("board");
    if(b) b.innerHTML = '<p class="board-empty">Grille indisponible pour cette date.</p>';
    for(const id of ["acrossList", "downList"]){ const el = document.getElementById(id); if(el) el.innerHTML = ""; }
    const dateEl = document.getElementById("date"); if(dateEl){ try{ dateEl.textContent = opts.dateText || ""; }catch(e){} }
    return { isSolved: () => false, isReview: () => false, elapsedShown: () => "0:00", type(){}, tapKey(){}, hint(){}, solution(){}, selectClue(){}, fillSolution(){}, replay(){} };
  }
  const K = (r,c) => r + "," + c;
  const filled = k => Object.prototype.hasOwnProperty.call(PUZZLE.solution, k);
  const norm = ch => (ch||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Grille \u00e0 la fran\u00e7aise : on saisit sans accent. On neutralise donc les accents
  // de la solution une fois pour toutes (\u00c9\u2192E, \u00c8\u2192E, \u00c2\u2192A\u2026), pour que l'affichage,
  // les indices et la r\u00e9v\u00e9lation \u00ab Solution \u00bb montrent des lettres nues, comme la
  // saisie. La comparaison passait d\u00e9j\u00e0 par norm() ; la grille reste donc jouable.
  for(const k in PUZZLE.solution) PUZZLE.solution[k] = norm(PUZZLE.solution[k]);
  const hasDigits = Object.values(PUZZLE.solution).some(ch => /[0-9]/.test(ch));

  const cellWord = {};
  for(const w of PUZZLE.across){ w.dir = "across"; w.id = "A" + w.num; for(const [r,c] of w.cells){ (cellWord[K(r,c)] = cellWord[K(r,c)] || {}).across = w; } }
  for(const w of PUZZLE.down){ w.dir = "down"; w.id = "D" + w.num; for(const [r,c] of w.cells){ (cellWord[K(r,c)] = cellWord[K(r,c)] || {}).down = w; } }
  const orderedClues = PUZZLE.across.concat(PUZZLE.down);

  const user = {};                 // lettres saisies ou revelees
  const given = {};                // lettres revelees par Indice : rouges, verrouillees
  const okWords = new Set();       // mots complets et corrects : verts, verrouilles
  const solvedWords = new Set();   // mots reveles par Solution : rouges, verrouilles
  let hintCount = 0, solutionCount = 0;
  let muted = false; try{ muted = localStorage.getItem("dd-mute") === "1"; }catch(e){}
  let audioCtx = null;
  let sel = null, solved = false, started = 0, tick = null, cell = 30, noSave = false, readonly = false;

  const correct = k => norm(user[k]) === norm(PUZZLE.solution[k]);
  const wordsAt = k => { const cw = cellWord[k]; return cw ? [cw.across, cw.down].filter(Boolean) : []; };
  const inOkWord = k => wordsAt(k).some(w => okWords.has(w.id));
  const inSolvedWord = k => wordsAt(k).some(w => solvedWords.has(w.id));
  const isLocked = k => !!given[k] || inOkWord(k) || inSolvedWord(k);
  function beep(freq, dur){
    if(muted) return;
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if(audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.07, audioCtx.currentTime);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    }catch(e){ /* audio indisponible */ }
  }
  // Signal de validation d'un mot : le carillon fourni par l'auteur, embarque
  // en data-URI (DING_SRC, defini en fin de module). Rejoue depuis le debut a
  // chaque validation ; muet si le son est coupe.
  let dingEl = null;
  function ding(){
    if(muted) return;
    try{
      if(!dingEl){ dingEl = new Audio(DING_SRC); dingEl.preload = "auto"; }
      dingEl.currentTime = 0;
      const p = dingEl.play(); if(p && typeof p.catch === "function") p.catch(() => {});
    }catch(e){ /* audio indisponible */ }
  }

  const board = document.getElementById("board");
  const gridarea = document.querySelector(".gridarea");
  const svgNS = "http://www.w3.org/2000/svg";
  const cellEls = {};
  let latticeSvg = null;
  // marge autour de la grille (en cases) reservee a la bande de rocher : plus large
  // sur ordinateur (bord organique ample) que sur mobile (on preserve la place de jeu).
  const bandCells = () => (window.innerWidth < 860 ? 1.7 : 2.5);

  function buildBoard(){
    board.innerHTML = "";
    for(const k in PUZZLE.solution){
      const [r,c] = k.split(",").map(Number);
      const d = document.createElement("div");
      d.className = "cell";
      const num = PUZZLE.numbers[k];
      if(num){ const n = document.createElement("span"); n.className = "num"; n.textContent = num; d.appendChild(n); }
      const ch = document.createElement("span"); ch.className = "ch"; d.appendChild(ch);
      d.addEventListener("pointerdown", e => { e.preventDefault(); onCellTap(r,c); });
      board.appendChild(d);
      cellEls[k] = d;
    }
    latticeSvg = document.createElementNS(svgNS, "svg");
    latticeSvg.setAttribute("class", "grid-svg");
    board.appendChild(latticeSvg);
    layout();
  }

  function layout(){
    const mobile = window.innerWidth < 860;
    // grand ecran (iMac / moniteur) : la grille peut grossir davantage et la
    // colonne grille est en 'auto' (elle epouse la grille). On ne peut alors pas
    // lire .gridarea (dependance circulaire) : on lit la largeur du conteneur
    // .layout moins le panneau des definitions.
    const wide = window.innerWidth >= 1600;
    const cap = mobile ? 40 : (wide ? 54 : 46);
    const layEl = gridarea.parentElement;
    let availW;
    if(wide && layEl){
      const asideEl = document.querySelector(".aside");
      availW = layEl.clientWidth - (asideEl ? asideEl.offsetWidth : 0) - 50;
    } else {
      availW = (gridarea.clientWidth || 700) - 2;
    }
    // on reserve la bande de rocher (bandCells() cases de chaque cote) dans le calcul
    const band = bandCells();
    let c = Math.min(cap, Math.floor(availW / (PUZZLE.cols + 2*band)));
    // on borne aussi par la hauteur disponible (mobile ET bureau plein ecran) :
    // la grille doit tenir dans sa zone sans pousser la barre d'indice / les
    // outils hors de l'ecran.
    // hauteur disponible pour la grille. Attention : sur bureau, .gridarea
    // grandit avec la grille qu'elle contient (dependance circulaire), donc on
    // ne peut pas lire sa hauteur. On lit celle du conteneur .layout (bornee par
    // la fenetre) moins la rangee d'outils : la grille tient ainsi toujours dans
    // l'ecran, sans deborder sur l'entete ni sur les boutons.
    let availH;
    if(mobile){
      availH = gridarea.clientHeight - 8;
    } else {
      const toolsEl = document.querySelector(".tools");
      availH = (layEl ? layEl.clientHeight : gridarea.clientHeight)
             - (toolsEl ? toolsEl.offsetHeight : 0) - 22;
    }
    if(availH > 0) c = Math.min(c, Math.floor(availH / (PUZZLE.rows + 2*band)));
    cell = Math.max(16, c);
    const W = cell * PUZZLE.cols, H = cell * PUZZLE.rows;
    board.style.width = W + "px";
    board.style.height = H + "px";
    board.style.margin = Math.round(cell * bandCells()) + "px";   // espace pour la bande de rocher
    for(const k in cellEls){
      const [r,c2] = k.split(",").map(Number);
      const el = cellEls[k];
      el.style.left = (c2*cell) + "px"; el.style.top = (r*cell) + "px";
      el.style.width = cell + "px"; el.style.height = cell + "px";
      el.querySelector(".ch").style.fontSize = Math.round(cell*0.52) + "px";
      const nEl = el.querySelector(".num"); if(nEl) nEl.style.fontSize = Math.max(7, Math.round(cell*0.26)) + "px";
    }
    drawLattice(W, H);
  }

  // La forme du donjon (salles, murs, portes, bande de rocher) est dessinee
  // par dessinerDonjon (partagee avec les apercus de l'accueil) ; ici on place
  // seulement le SVG sur le plateau et on lui passe la grille courante.
  function drawLattice(W, H){
    const M = Math.round(cell * bandCells());
    latticeSvg.style.left = -M + "px"; latticeSvg.style.top = -M + "px";
    dessinerDonjon(latticeSvg, {
      rows: PUZZLE.rows, cols: PUZZLE.cols, cell, band: bandCells(),
      has: (r,c) => filled(K(r,c)), bars: PUZZLE.bars || {}
    });
  }

  function currentWord(){
    if(!sel) return null;
    const cw = cellWord[K(sel.r, sel.c)] || {};
    return cw[sel.dir] || cw[sel.dir === "across" ? "down" : "across"] || null;
  }
  function onCellTap(r, c){
    if(solved) return;
    const cw = cellWord[K(r,c)] || {};
    const dir = sel && sel.r === r && sel.c === c
      ? (cw[sel.dir === "across" ? "down" : "across"] ? (sel.dir === "across" ? "down" : "across") : sel.dir)
      : (sel ? (cw[sel.dir] ? sel.dir : (cw.across ? "across" : "down")) : (cw.across ? "across" : "down"));
    sel = { r, c, dir };
    render();
  }

  function place(ch){
    if(readonly || solved || !sel) return;
    const k = K(sel.r, sel.c);
    if(isLocked(k)){ advance(1); render(); return; }   // case verrouillee : on n'ecrit pas
    user[k] = ch.toUpperCase();
    startTimer();
    const w = currentWord();            // mot en cours de saisie
    advance(1);
    checkWords();
    // si ce mot vient d'etre valide, filer directement au mot suivant a remplir
    let advanced = false;
    if(w && okWords.has(w.id) && !solved) advanced = gotoNextUnfinished(w);
    if(!advanced) render();
    checkSolved();
  }
  function erase(){
    if(readonly || solved || !sel) return;
    const k = K(sel.r, sel.c);
    if(isLocked(k)){ advance(-1); render(); return; }   // case verrouillee : on n'efface pas
    if(user[k]){ delete user[k]; }
    else { advance(-1); const k2 = K(sel.r, sel.c); if(!isLocked(k2)) delete user[k2]; }
    render();
  }
  function advance(step){
    const w = currentWord(); if(!w) return;
    const idx = w.cells.findIndex(([r,c]) => r === sel.r && c === sel.c);
    const ni = idx + step;
    if(ni >= 0 && ni < w.cells.length) sel = { r:w.cells[ni][0], c:w.cells[ni][1], dir:sel.dir };
  }
  function moveTo(dr, dc){
    if(!sel) return;
    let r = sel.r + dr, c = sel.c + dc;
    while(r >= 0 && r < PUZZLE.rows && c >= 0 && c < PUZZLE.cols){
      if(filled(K(r,c))){ sel = { r, c, dir: dr !== 0 ? "down" : "across" }; render(); return; }
      r += dr; c += dc;
    }
  }
  function gotoClue(w, toEmpty){
    let target = w.cells[0];
    if(toEmpty){ const e = w.cells.find(([r,c]) => !user[K(r,c)]); if(e) target = e; }
    sel = { r: target[0], c: target[1], dir: w.dir };
    render();
  }
  function stepClue(delta){
    const w = currentWord();
    let i = w ? orderedClues.findIndex(x => x.id === w.id) : -1;
    i = (i + delta + orderedClues.length) % orderedClues.length;
    gotoClue(orderedClues[i], true);
  }
  // va au prochain mot non termine (ni valide ni donne), dans l'ordre des
  // definitions, en se posant sur sa premiere case vide. Renvoie false si tout
  // est resolu.
  function gotoNextUnfinished(fromWord){
    const n = orderedClues.length;
    const i = fromWord ? orderedClues.findIndex(x => x.id === fromWord.id) : -1;
    for(let s = 1; s <= n; s++){
      const w = orderedClues[((i + s) % n + n) % n];
      if(!okWords.has(w.id) && !solvedWords.has(w.id)){ gotoClue(w, true); return true; }
    }
    return false;
  }
  function toggleDir(){
    if(!sel) return;
    const cw = cellWord[K(sel.r,sel.c)] || {};
    const o = sel.dir === "across" ? "down" : "across";
    if(cw[o]){ sel.dir = o; render(); }
  }

  function render(){
    const cw = currentWord();
    const inWord = new Set(cw ? cw.cells.map(([r,c]) => K(r,c)) : []);
    for(const k in cellEls){
      const el = cellEls[k];
      const ok = inOkWord(k);
      const inSolved = inSolvedWord(k);
      el.classList.toggle("word", inWord.has(k));
      el.classList.toggle("here", !!sel && k === K(sel.r, sel.c));
      el.classList.toggle("ok", ok);                        // fond vert : mot valide
      el.classList.toggle("solved", inSolved && !ok);       // fond rouge : mot donne
      el.classList.toggle("given", !!given[k] || inSolved); // lettre rouge : indice ou solution
      el.querySelector(".ch").textContent = user[k] || "";
    }
    for(const w of orderedClues){
      const li = document.getElementById("li-" + w.id);
      if(!li) continue;
      li.classList.toggle("on", !!cw && w.id === cw.id);
      const done = w.cells.every(([r,c]) => user[K(r,c)]);
      li.classList.toggle("filled", done && !(cw && w.id === cw.id));
    }
    if(cw){
      const label = cw.dir === "across" ? "Horizontal" : "Vertical";
      document.getElementById("cluebarTxt").innerHTML =
        `<span class="dir">${cw.num} ${label}</span>${formatClue(cw.clue)}`;
      showDir(cw.dir, cw.id);
    }
  }

  // Panneau des definitions (ordinateur) : n'affiche qu'une direction a la fois.
  // Suit le mot courant (appel depuis render) et se pilote a la main via la
  // bascule Horizontal/Vertical. activeId : garde la definition active en vue.
  function showDir(dir, activeId){
    const aside = document.getElementById("clueAside");
    if(!aside) return;
    aside.setAttribute("data-dir", dir);
    const a = document.getElementById("dirAcross"), d = document.getElementById("dirDown");
    if(a){ a.classList.toggle("on", dir === "across"); a.setAttribute("aria-selected", String(dir === "across")); }
    if(d){ d.classList.toggle("on", dir === "down"); d.setAttribute("aria-selected", String(dir === "down")); }
    if(activeId != null){
      const li = document.getElementById("li-" + activeId);
      if(li && aside.scrollHeight > aside.clientHeight + 2){
        const at = aside.getBoundingClientRect(), lt = li.getBoundingClientRect();
        if(lt.top < at.top) aside.scrollTop -= (at.top - lt.top) + 6;
        else if(lt.bottom > at.bottom) aside.scrollTop += (lt.bottom - at.bottom) + 6;
      }
    }
  }

  function buildLists(){
    const fillList = (ol, arr) => {
      ol.innerHTML = "";
      for(const w of arr){
        const li = document.createElement("li");
        li.id = "li-" + w.id;
        li.innerHTML = `<span class="ln">${w.num}</span><span>${formatClue(w.clue)}</span>`;
        li.addEventListener("click", () => gotoClue(w, true));
        ol.appendChild(li);
      }
    };
    fillList(document.getElementById("acrossList"), PUZZLE.across);
    fillList(document.getElementById("downList"), PUZZLE.down);
    // bascule Horizontal/Vertical : change seulement la direction affichee
    const da = document.getElementById("dirAcross"), dd = document.getElementById("dirDown");
    if(da) da.addEventListener("click", () => showDir("across"));
    if(dd) dd.addEventListener("click", () => showDir("down"));
  }

  function buildKeyboard(){
    const kbd = document.getElementById("kbd");
    kbd.innerHTML = "";
    const rows = ["AZERTYUIOP", "QSDFGHJKLM", "WXCVBN"];
    if(hasDigits) rows.unshift("1234567890");
    rows.forEach((row, i) => {
      const rowEl = document.createElement("div");
      rowEl.className = "krow";
      for(const ch of row){
        const key = document.createElement("div");
        key.className = "key"; key.textContent = ch; key.setAttribute("data-k", ch);
        key.addEventListener("pointerdown", e => { e.preventDefault(); place(ch); });
        rowEl.appendChild(key);
      }
      if(i === rows.length - 1){
        const del = document.createElement("div");
        del.className = "key wide"; del.innerHTML = "&#9003;"; del.setAttribute("data-act", "del");
        del.addEventListener("pointerdown", e => { e.preventDefault(); erase(); });
        rowEl.appendChild(del);
      }
      kbd.appendChild(rowEl);
    });
  }

  function checkSolved(){
    for(const k in PUZZLE.solution){ if(norm(user[k]) !== norm(PUZZLE.solution[k])) return false; }
    win();
    return true;
  }
  // Tout mot entierement correct se valide (vert, verrouille), meme si le joueur
  // s'est aide d'un indice ; les lettres d'indice y restent rouges. Un mot
  // revele par « Solution » (deja dans solvedWords) n'est pas concerne : il reste
  // rouge. Petit signal sonore de reussite a chaque validation.
  function checkWords(){
    for(const w of orderedClues){
      if(okWords.has(w.id) || solvedWords.has(w.id)) continue;
      if(w.cells.every(([r,c]) => correct(K(r,c)))){ okWords.add(w.id); ding(); }
    }
  }
  function win(){
    if(solved) return;
    solved = true; stopTimer();
    board.classList.add("done");
    for(const k in cellEls) cellEls[k].classList.remove("here", "word");
    beep(660, 0.14); setTimeout(() => beep(988, 0.3), 150);
    const secs = elapsed(), words = orderedClues.length;
    // detail par mot pour le bareme : nombre de lettres, lettres devoilees en
    // indice, et mot revele en entier par « Solution »
    const parMot = orderedClues.map(w => ({
      cells: w.cells.length,
      hints: w.cells.reduce((n, [r, c]) => n + (given[K(r, c)] ? 1 : 0), 0),
      solution: solvedWords.has(w.id)
    }));
    const detail = detailScore({ seconds: secs, words: parMot });
    const xp = detail.xp;
    const b = document.getElementById("banner");
    b.innerHTML = `<b>Bravo !</b> Grille résolue en ${fmt(secs)}. <b>+${xp} XP</b>`;
    b.classList.add("show");
    if(opts.onSolved && !noSave){ try{ opts.onSolved(secs, { hints: hintCount, solutions: solutionCount, words, xp, detail, given: Object.keys(given), solvedWords: [...solvedWords] }); }catch(e){ /* la page hote gere */ } }
  }
  // Rejouer (outil d'auteur) : remet la grille a zero pour la retester. On
  // n'enregistre plus de resultat ensuite — un essai ne doit pas ecraser le
  // vrai resultat du jour ni toucher au classement.
  function replay(){
    noSave = true;
    readonly = false;                          // sort d'une éventuelle revue : la grille redevient jouable
    for(const k in user) delete user[k];
    for(const k in given) delete given[k];
    okWords.clear(); solvedWords.clear();
    hintCount = 0; solutionCount = 0;
    solved = false; sel = null;
    if(tick){ clearInterval(tick); tick = null; }
    started = 0;
    const t = document.getElementById("timer"); if(t) t.textContent = "0:00";
    board.classList.remove("done");
    const kb = document.getElementById("kbd"); if(kb) kb.style.display = "";           // le clavier redevient piloté par le CSS
    for(const id of ["hintBtn", "solveBtn"]){ const el = document.getElementById(id); if(el) el.hidden = false; }
    const b = document.getElementById("banner"); if(b){ b.classList.remove("show", "review"); b.innerHTML = ""; }
    gotoClue(PUZZLE.across[0] || PUZZLE.down[0], true);
  }
  // Revue en lecture seule (joueur ayant résolu la grille) : la grille complétée,
  // les cases dévoilées par Indice/Solution en rouge, le reste (trouvé par le
  // joueur) en vert. Aucune saisie, ni indice, ni clavier — juste la navigation
  // entre définitions pour se relire.
  function enterReview(rv){
    readonly = true;
    for(const k in PUZZLE.solution) user[k] = PUZZLE.solution[k];
    for(const k of (rv.given || [])) given[k] = true;
    for(const id of (rv.solvedWords || [])) solvedWords.add(id);
    for(const w of orderedClues) if(!solvedWords.has(w.id)) okWords.add(w.id);
    const kb = document.getElementById("kbd"); if(kb) kb.style.display = "none";
    for(const id of ["hintBtn", "solveBtn"]){ const el = document.getElementById(id); if(el) el.hidden = true; }
    const t = document.getElementById("timer"); if(t && rv.seconds != null) t.textContent = fmt(rv.seconds);
    const bn = document.getElementById("banner");
    if(bn){ bn.innerHTML = 'Grille résolue. <b>En rouge</b>, les cases que vous avez dévoilées (indice ou solution).'; bn.classList.add("show", "review"); }
    render();
  }
  // Indice : revele une lettre encore introuvable du mot selectionne. La lettre
  // donnee reste rouge (given) et verrouillee ; si elle complete le mot, celui-ci
  // se valide (vert) tout en gardant sa lettre d'indice rouge.
  function hint(){
    if(readonly || solved) return;
    const w = currentWord(); if(!w) return;
    // une lettre AU HASARD parmi celles encore introuvables (ni déjà donnée, ni déjà correcte)
    const cands = w.cells.filter(([r,c]) => !given[K(r,c)] && !correct(K(r,c)));
    if(!cands.length) return;
    const t = cands[Math.floor(Math.random() * cands.length)];
    const k = K(t[0], t[1]);
    user[k] = PUZZLE.solution[k]; given[k] = true; hintCount++;
    startTimer(); checkWords(); render(); checkSolved();
  }
  // Solution : revele le mot selectionne en entier. Le mot est marque solvedWords
  // (rouge, verrouille) et n'est jamais compte comme valide.
  function solution(){
    if(readonly || solved) return;
    const w = currentWord(); if(!w) return;
    if(okWords.has(w.id) || solvedWords.has(w.id)) return;   // deja resolu
    for(const [r,c] of w.cells){ const k = K(r,c); user[k] = PUZZLE.solution[k]; }
    solvedWords.add(w.id); solutionCount++;
    startTimer(); render(); checkSolved();
  }

  function escapeHtml(s){ return (s||"").replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m])); }
  // Rendu d'une definition : on echappe le HTML, puis on met en italique les
  // segments places entre asterisques par l'auteur (*mot* devient <em>mot</em>).
  function formatClue(s){ return escapeHtml(s || "Definition a venir").replace(/\*([^*]+)\*/g, "<em>$1</em>"); }
  function elapsed(){ return started ? Math.floor((Date.now() - started)/1000) : 0; }
  function fmt(s){ return Math.floor(s/60) + ":" + String(s%60).padStart(2,"0"); }
  function startTimer(){ if(started) return; started = Date.now(); tick = setInterval(() => { document.getElementById("timer").textContent = fmt(elapsed()); }, 1000); }
  function stopTimer(){ if(tick){ clearInterval(tick); tick = null; } document.getElementById("timer").textContent = fmt(elapsed()); }

  // clavier physique (ordinateur) : la page capte les touches globalement
  window.addEventListener("keydown", e => {
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if(t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    const k = e.key;
    if(k.length === 1 && /[0-9a-zA-ZÀ-ÿ]/.test(k)){ e.preventDefault(); place(k); }
    else if(k === "Backspace"){ e.preventDefault(); erase(); }
    else if(k === "ArrowLeft"){ e.preventDefault(); moveTo(0,-1); }
    else if(k === "ArrowRight"){ e.preventDefault(); moveTo(0,1); }
    else if(k === "ArrowUp"){ e.preventDefault(); moveTo(-1,0); }
    else if(k === "ArrowDown"){ e.preventDefault(); moveTo(1,0); }
    else if(k === "Tab"){ e.preventDefault(); stepClue(e.shiftKey ? -1 : 1); }
    else if(k === " "){ e.preventDefault(); toggleDir(); }
  });

  document.getElementById("prevClue").addEventListener("click", () => stepClue(-1));
  document.getElementById("nextClue").addEventListener("click", () => stepClue(1));
  document.getElementById("hintBtn").addEventListener("click", hint);
  document.getElementById("solveBtn").addEventListener("click", solution);
  const muteBtn = document.getElementById("muteBtn");
  if(muteBtn){
    const paintMute = () => { muteBtn.textContent = muted ? "🔇" : "🔊"; muteBtn.setAttribute("aria-label", muted ? "Activer le son" : "Couper le son"); };
    paintMute();
    muteBtn.addEventListener("click", () => { muted = !muted; try{ localStorage.setItem("dd-mute", muted ? "1" : "0"); }catch(e){} paintMute(); });
  }
  let relayoutTimer = null;
  window.addEventListener("resize", () => { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(layout, 60); });
  if(window.visualViewport) window.visualViewport.addEventListener("resize", () => setTimeout(layout, 60));
  // les titres (Pirata One) changent la hauteur de l'entete une fois charges :
  // on recalcule alors la taille de la grille pour qu'elle tienne juste.
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());

  // Safari iOS : meme avec touch-action, un double-appui rapproche declenche
  // parfois le zoom. On neutralise le second appui s'il suit de trop pres le
  // precedent (fenetre du double-tap), sans gener les appuis isoles.
  let lastTouchEnd = 0;
  document.addEventListener("touchend", e => {
    const now = Date.now();
    if(now - lastTouchEnd <= 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  const dateEl = document.getElementById("date");
  if(dateEl){
    try{ dateEl.textContent = opts.dateText || new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" }); }
    catch(e){ dateEl.textContent = opts.dateText || PUZZLE.title || ""; }
  }

  buildBoard();
  buildLists();
  buildKeyboard();
  gotoClue(PUZZLE.across[0] || PUZZLE.down[0], true);
  if(opts.review) enterReview(opts.review);   // grille déjà résolue : revue en lecture seule
  requestAnimationFrame(layout);
  // le chrono démarre dès l'ouverture de la grille (et non à la première frappe),
  // sauf en revue/lecture seule (grille déjà résolue).
  if(!opts.review && !solved) startTimer();

  const api = {
    selectClue: (dir, num) => { const w = (dir==="across"?PUZZLE.across:PUZZLE.down).find(x => x.num===num); if(w) gotoClue(w, true); },
    tapCell: (r, c) => onCellTap(r, c),   // simule un appui sur une case (selection + definition)
    type: s => { for(const ch of s) place(ch); },
    tapKey: ch => place(ch),
    letterAt: (r,c) => user[K(r,c)] || "",
    currentClue: () => { const w = currentWord(); return w ? w.id : null; },
    wordHighlight: () => board.querySelectorAll(".cell.word").length,
    isSolved: () => solved,
    isReview: () => readonly,
    replay: () => replay(),
    fillSolution: () => { for(const k in PUZZLE.solution) user[k] = PUZZLE.solution[k]; render(); checkSolved(); },
    elapsedShown: () => document.getElementById("timer").textContent,
    hint: () => hint(),
    solution: () => solution(),
    hints: () => hintCount,
    solutions: () => solutionCount,
    givenCount: () => Object.keys(given).length,
    okWordCount: () => okWords.size,
    solvedWordCount: () => solvedWords.size,
    isOk: (r,c) => inOkWord(K(r,c)),
    isGiven: (r,c) => !!given[K(r,c)],
    isSolvedCell: (r,c) => inSolvedWord(K(r,c))
  };
  window.__play = api;
  return api;
}

// Grille de demonstration (aussi utilisee comme repli quand aucune grille du
// jour n'est publiee). Theme jeu de role, 15x15.
export const DEMO_PUZZLE = {"title":"Jeu de role","rows":15,"cols":15,"solution":{"9,0":"I","9,1":"N","9,2":"I","9,3":"T","9,4":"I","9,5":"A","9,6":"T","9,7":"I","9,8":"V","9,9":"E","6,6":"S","7,6":"O","8,6":"R","10,6":"I","11,6":"L","12,6":"E","13,6":"G","14,6":"E","7,2":"G","7,3":"R","7,4":"I","7,5":"M","7,7":"I","7,8":"R","7,9":"E","12,0":"B","12,1":"O","12,2":"U","12,3":"C","12,4":"L","12,5":"I","12,7":"R","14,0":"G","14,1":"U","14,2":"E","14,3":"R","14,4":"R","14,5":"I","14,7":"R","1,9":"S","2,9":"P","3,9":"E","4,9":"C","5,9":"T","6,9":"R","3,3":"V","3,4":"A","3,5":"M","3,6":"P","3,7":"I","3,8":"R","0,7":"D","1,7":"R","2,7":"U","4,7":"D","5,7":"E","0,2":"K","0,3":"O","0,4":"B","0,5":"O","0,6":"L","5,10":"R","5,11":"E","5,12":"S","5,13":"O","5,14":"R","1,10":"I","1,11":"R","1,12":"E","1,13":"N","1,14":"E","4,13":"P","6,13":"T","7,13":"I","8,13":"O","9,13":"N","0,11":"A","2,11":"M","3,11":"U","4,11":"R","8,10":"D","8,11":"E","8,12":"M","8,14":"N","7,11":"G","9,11":"A","10,11":"N","11,11":"T","6,0":"M","7,0":"O","8,0":"M","10,0":"E","11,8":"Q","11,9":"U","11,10":"E","11,12":"E","12,10":"L","13,10":"F","14,10":"E","2,4":"M","4,4":"G","5,4":"E","5,1":"E","5,2":"P","5,3":"E","11,2":"R","13,2":"N","14,9":"H","14,11":"A","14,12":"U","14,13":"M","14,14":"E","1,1":"O","2,1":"R","3,1":"Q","4,1":"U","10,14":"H","11,14":"Y","12,14":"D","13,14":"R"},"numbers":{"0,2":1,"0,7":2,"0,11":3,"1,1":4,"1,9":5,"2,4":6,"3,3":7,"4,13":8,"5,1":9,"5,9":10,"6,0":11,"6,6":12,"7,2":13,"7,11":14,"8,10":15,"9,0":16,"10,14":17,"11,2":18,"11,8":19,"11,10":20,"12,0":21,"14,0":22,"14,9":23},"bars":{},"across":[{"num":1,"clue":"Le petit reptilien fouisseur.","cells":[[0,2],[0,3],[0,4],[0,5],[0,6],[0,7]]},{"num":5,"clue":"La voix qui perd les marins.","cells":[[1,9],[1,10],[1,11],[1,12],[1,13],[1,14]]},{"num":7,"clue":"Le buveur de sang nocturne.","cells":[[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[3,9]]},{"num":9,"clue":"L'arme blanche du chevalier.","cells":[[5,1],[5,2],[5,3],[5,4]]},{"num":10,"clue":"Le butin au fond du donjon.","cells":[[5,9],[5,10],[5,11],[5,12],[5,13],[5,14]]},{"num":13,"clue":"Le livre de sorts du mage.","cells":[[7,2],[7,3],[7,4],[7,5],[7,6],[7,7],[7,8],[7,9]]},{"num":15,"clue":"La creature des enfers.","cells":[[8,10],[8,11],[8,12],[8,13],[8,14]]},{"num":16,"clue":"Ce qui fixe l'ordre du combat.","cells":[[9,0],[9,1],[9,2],[9,3],[9,4],[9,5],[9,6],[9,7],[9,8],[9,9]]},{"num":19,"clue":"L'aventure a accomplir.","cells":[[11,8],[11,9],[11,10],[11,11],[11,12]]},{"num":21,"clue":"Ce qui pare les coups.","cells":[[12,0],[12,1],[12,2],[12,3],[12,4],[12,5],[12,6],[12,7]]},{"num":22,"clue":"Le combattant de premiere ligne.","cells":[[14,0],[14,1],[14,2],[14,3],[14,4],[14,5],[14,6],[14,7]]},{"num":23,"clue":"Le casque ferme du combattant.","cells":[[14,9],[14,10],[14,11],[14,12],[14,13],[14,14]]}],"down":[{"num":2,"clue":"Le gardien de la nature.","cells":[[0,7],[1,7],[2,7],[3,7],[4,7],[5,7]]},{"num":3,"clue":"La protection de plates du chevalier.","cells":[[0,11],[1,11],[2,11],[3,11],[4,11],[5,11]]},{"num":4,"clue":"La brute verte des armees du mal.","cells":[[1,1],[2,1],[3,1],[4,1],[5,1]]},{"num":5,"clue":"Le fantome vengeur.","cells":[[1,9],[2,9],[3,9],[4,9],[5,9],[6,9],[7,9]]},{"num":6,"clue":"Celui qui manie l'arcane.","cells":[[2,4],[3,4],[4,4],[5,4]]},{"num":8,"clue":"La fiole qui soigne ou empoisonne.","cells":[[4,13],[5,13],[6,13],[7,13],[8,13],[9,13]]},{"num":11,"clue":"Le mort bande des tombeaux.","cells":[[6,0],[7,0],[8,0],[9,0],[10,0]]},{"num":12,"clue":"L'effet magique de l'incantation.","cells":[[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6]]},{"num":14,"clue":"Le colosse des hautes terres.","cells":[[7,11],[8,11],[9,11],[10,11],[11,11]]},{"num":17,"clue":"Le monstre a plusieurs tetes.","cells":[[10,14],[11,14],[12,14],[13,14],[14,14]]},{"num":18,"clue":"Le signe grave, magique.","cells":[[11,2],[12,2],[13,2],[14,2]]},{"num":20,"clue":"L'oreille pointue des forets.","cells":[[11,10],[12,10],[13,10],[14,10]]}]};

// Carillon de validation fourni par lauteur (MP3, ~39 Ko), embarque en
// data-URI pour rester autonome sur toutes les cibles (jeu, apercu, tests)
// sans fichier annexe a deployer. Lu par ding() a chaque mot valide.
export const DING_SRC = "data:audio/mpeg;base64,//vQZAAABwtnSBVjQAIAAA0goAABMQG5CBnfgAAAADSDAAAAAABpZyJtbZ2ztr8uYYgHRTedkBagwCARF+gE5nEBoDQCQDI81cM7Ok9+07K8KMD6+T0wTFiDWOjcKB4yZFOa1KNGzCkzIiS6cWTkLOAIAXYeRpC7GuO5LLsNv+/7uP5GKTDCpKIw/7/v+/8PxuN0/c+4UkYhiHJZypY3TxuNxunt8/DDDDDCkp6enp888888KSkpKSksYc/edPT09Pb7v8MMMP1hT09vPPv550lJSUlJhhhhnnnnnnnn3msMMMMMMM88888869PSUlJhhhhhSU9PT09Pnnn39YVKSkpMGHZh5g6hJlALxkSG3mGgGKNGepmGWbLISf/zhFLDOrqQoG5kQgvqNGBcgupizRbGYCWB4GD/hXJgGgJeYI0INGDyoex+Apd2Z4YKomVfRNRrK6oUYc4H4mEe2ZR5WhWoYzkE9mFTDTBhb4DiYXaEQGBIBIZgwAWaYHiCXGAlgGpgEAAYYOqAbBQANU4U5MC1AejAwANUwJYBmMBOAZx0AgMAgANwgBB9FZRv///MAXAMiYARCwAIYCGAKGAEgGQOAkvUaRW/0Vf///zACwHkwHcCvHgAkwC0AgLzrmL/GAZACRgUQEEHAAzVf/zAIQCEwIkB1///1KgEAFLzBIAgQgCIGAITADACMFADhgFIA1///6////////MAzALjAEgCUEADxgDwBMUAESOrITABAAdCS3NMpRtThTgKAL3//////hUAgCABj///8u9KbyKqKyfrWC2KTMSQ+L7FtlGpn///////U5/////v//+o2it/+BABN9mmA0AMgFrLDYCcphz6uSymGnKZV/2qTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpDYBgpWu63mUW+5DsQm8LTDUAsVLrgEgGwGP/70mQND/WZYUGHZuAAAAANIOAAARD5iQIO/rIAAAA0gAAABARgDoGApAN4GBaABYGB3ABIGCig2wGFzifgGLPgVgGCXlvoGz69yIGbmF1IGPUB9YFgqADApQQoDBCwJ4BQBHAwBYA9AwD4AnAwBEAaAkAJF8nf/////UksdIfCBAAFHAGFQMCKAWAMA1ADg34rF01pN//////1JFIyPiVBgIDAHQEcLGQxKTrP///////oqYxIaGmDnkv/9QoBYcCv1YzjS/WpbH8xgyD3cUyJQAKAfBgAAkSTAgWDE0RREOhlDA5lUgPCcNR/xGGsgxRgVAFGYFmAJAY0FIGLwABgoAgoChiDGEFKRoggg3//6//9ZQCEEGYhEANnigSZ52////+h//WPlJEjhHQGOhQF7iaKzf///+r//660AFwAK2P//9dMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//vSZAAP861hQAK/rIAAAA0gAAABD0mE/gr+sgAAADSAAAAEJk8l/9aBfLQ+RGAW/gIAwCRGBggmAYhVIGYtsZVCCBHR0+kph/ARaYJyBZGAzAFoGSREBhwDgBCILeRVj+TRO////V//qKYNQSVAKgEDZhPDai07f////p//1D8m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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX///9sN+H2yVq0O2ZVWhUkmWcFxzDAox0nMsSDS208TcAwGETzA+p1R4AwkEELAwD8BDAwCwA4ASAQgPABgxSOcQcd5EE00Fur//9//9MwAgAAF4hoGBIgTwW8F9D+sVk/b/sT0ItVXnnKVinKHONPHP/70mQ4j/YVYTwDd8zgAAANIAAAARnVlO4OX3NAAAA0gAAABAL/yippx1d0X1FOsP1hz9M35TLUgU/R1w0fIKh/GtG5A0PvyWy4zezEn3n801i9ytPJFNhn6sLb2rr//XM2Z+6D3c3jMp60+frYblOFHCB3/0f///xmjdGCasSjM9CKV/YjKGHoOAIBmDAYYdFpkY5GwfKBhZIn8B+Zzq2Bgl4H+BgGIA4BgAAAaAkACDiRaCBlRqv///t//sbhYWO0kBTfM1udTev////fW1MXY/II890y6dVxHZfdNV3oeYu48G9dtgsmu1o67ecbf+Ta7TPJ91dtqbf+VmeCq47HZIzbCJOC3sNf8de15Yk3TVxrmNeGaKOKateh5u77QXCGr5f/1ohZj7PrTCG3i+nQnHQd5t+OEOg99pbxPb/yOEd/+lVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf///++6EPQzD0840ikE290dVsLrmAgQYVDJi4XGay+cAdgGHnC6oHxGxPgGBahUAGBNgQYGATAFgGAEgBINzA9cZAkySKqS2dv/////sHuEGW0ZnvOlQ63//+f/2YjDb08m+HM4xlnn73TFC6L3UNHjLIphO7h2jVsbPz9vWp7eo9R2//vSZEGP9llku4OX3NAAAA0gAAABGx2W7A5fc0AAADSAAAAEaGSGUoi/M/oIxOKPsbkPOf7g/7El+sOXrhznx4SA3z29TmutmzTv7m2nOhI9urI3uUok/yKTZNke7eZfyjYw9Tb/tJedE//3f////cgKVvs3z7SmAaVyKF+GBoqGBQKYSDhiMbmTjQbfnYGKci6wHyKV/4GBbAaIGAjAEQGAUgFIDgBIMIisCvjoPFsuf/////8vBhYcKMpjPajTKqX/ue3eWf/qNLC0DbSm/BtNdjb9t7TS5oEAt3ZZGpdTwFIGX0Xs8pnKS7//bqqrR/fpaamYCSsbk3P9L+ijMZg6Vy/4Abl26zRbUDSuVUVDSQE3KXQA3sAvzKKrtfArK1irsgZ9GYsrjLdG60bMYCchn1/4BBQE2ZuL6MG/2U+m+2f/70xBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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Vs3IaelvX3Q1BJikG3SJFUjriJKz8hLBhmhIqqPLHQpC4QKKe9SktiptG1ypirFgV9kvkA0HLmTGWNCmApisFlDgs5cWkdpnTjW31cp3qOItZcmdiTWn9nZU5TlRaZdlrsumXZcmK3Iaf6NUtnhMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
