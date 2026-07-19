// Donjons & Definitions : moteur de resolution partage.
// monterJeu(PUZZLE, opts) construit la grille interactive dans la page hote
// (elements attendus par id : board, gridarea, cluebar, cluebarTxt, prevClue,
// nextClue, checkBtn, revealBtn, clearBtn, kbd, acrossList, downList, timer,
// banner, date). opts.onSolved(secondes) est appele a la resolution ;
// opts.dateText remplace la date affichee. Renvoie une petite API de controle
// (aussi exposee en window.__play pour les tests).

export function monterJeu(PUZZLE, opts = {}){
  const K = (r,c) => r + "," + c;
  const filled = k => Object.prototype.hasOwnProperty.call(PUZZLE.solution, k);
  const norm = ch => (ch||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hasDigits = Object.values(PUZZLE.solution).some(ch => /[0-9]/.test(ch));

  const cellWord = {};
  for(const w of PUZZLE.across){ w.dir = "across"; w.id = "A" + w.num; for(const [r,c] of w.cells){ (cellWord[K(r,c)] = cellWord[K(r,c)] || {}).across = w; } }
  for(const w of PUZZLE.down){ w.dir = "down"; w.id = "D" + w.num; for(const [r,c] of w.cells){ (cellWord[K(r,c)] = cellWord[K(r,c)] || {}).down = w; } }
  const orderedClues = PUZZLE.across.concat(PUZZLE.down);

  const user = {};
  let sel = null, solved = false, started = 0, tick = null, cell = 30;

  const board = document.getElementById("board");
  const gridarea = document.querySelector(".gridarea");
  const svgNS = "http://www.w3.org/2000/svg";
  const cellEls = {};
  let latticeSvg = null;

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
    const cap = mobile ? 40 : 46;
    const availW = (gridarea.clientWidth || 700) - 2;
    let c = Math.min(cap, Math.floor(availW / PUZZLE.cols));
    if(mobile){
      const availH = gridarea.clientHeight - 2;
      if(availH > 0) c = Math.min(c, Math.floor(availH / PUZZLE.rows));
    }
    cell = Math.max(16, c);
    const W = cell * PUZZLE.cols, H = cell * PUZZLE.rows;
    board.style.width = W + "px";
    board.style.height = H + "px";
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

  function drawLattice(W, H){
    // marge d'1 px : sans elle, le trait exterieur (centre sur le bord) voit sa
    // moitie externe rognee par la limite du SVG et parait deux fois plus fin
    const M = 1;
    latticeSvg.setAttribute("width", W + 2*M); latticeSvg.setAttribute("height", H + 2*M);
    latticeSvg.setAttribute("viewBox", `${-M} ${-M} ${W + 2*M} ${H + 2*M}`);
    latticeSvg.style.left = -M + "px"; latticeSvg.style.top = -M + "px";
    const has = (r,c) => filled(K(r,c));
    let d = "";
    for(let r=0;r<PUZZLE.rows;r++) for(let c=0;c<PUZZLE.cols;c++){
      if(!has(r,c)) continue;
      const x=c*cell, y=r*cell;
      d += `M ${x} ${y} H ${x+cell} `;
      if(!has(r+1,c)) d += `M ${x} ${y+cell} H ${x+cell} `;
      d += `M ${x} ${y} V ${y+cell} `;
      if(!has(r,c+1)) d += `M ${x+cell} ${y} V ${y+cell} `;
    }
    let s = `<path d="${d.trim()}" fill="none" stroke="#211E17" stroke-width="1.5" stroke-linecap="square"/>`;
    const D = Math.max(4, cell*0.17);
    const dia = (cx,cy) => `<path d="M ${cx} ${cy-D} L ${cx+D} ${cy} L ${cx} ${cy+D} L ${cx-D} ${cy} Z" fill="#211E17"/>`;
    for(const kk in (PUZZLE.bars||{})){
      const [r,c] = kk.split(",").map(Number);
      if(!has(r,c)) continue;
      if(PUZZLE.bars[kk].left) s += dia(c*cell, r*cell + cell/2);
      if(PUZZLE.bars[kk].top) s += dia(c*cell + cell/2, r*cell);
    }
    latticeSvg.innerHTML = s;
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
    if(solved || !sel) return;
    user[K(sel.r, sel.c)] = ch.toUpperCase();
    cellEls[K(sel.r, sel.c)].classList.remove("bad");
    startTimer();
    advance(1);
    render();
    checkSolved();
  }
  function erase(){
    if(solved || !sel) return;
    const k = K(sel.r, sel.c);
    if(user[k]){ delete user[k]; cellEls[k].classList.remove("bad"); }
    else { advance(-1); const k2 = K(sel.r, sel.c); delete user[k2]; if(cellEls[k2]) cellEls[k2].classList.remove("bad"); }
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
      el.classList.toggle("word", inWord.has(k));
      el.classList.toggle("here", !!sel && k === K(sel.r, sel.c));
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
        `<span class="dir">${cw.num} ${label}</span>${escapeHtml(cw.clue || "Definition a venir")}`;
    }
  }

  function buildLists(){
    const fillList = (ol, arr) => {
      ol.innerHTML = "";
      for(const w of arr){
        const li = document.createElement("li");
        li.id = "li-" + w.id;
        li.innerHTML = `<span class="ln">${w.num}</span><span>${escapeHtml(w.clue || "Definition a venir")}</span>`;
        li.addEventListener("click", () => gotoClue(w, true));
        ol.appendChild(li);
      }
    };
    fillList(document.getElementById("acrossList"), PUZZLE.across);
    fillList(document.getElementById("downList"), PUZZLE.down);
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
  function win(){
    if(solved) return;
    solved = true; stopTimer();
    board.classList.add("done");
    for(const k in cellEls) cellEls[k].classList.remove("here", "word", "bad");
    const b = document.getElementById("banner");
    b.innerHTML = `<b>Bravo !</b> Grille resolue en ${fmt(elapsed())}.`;
    b.classList.add("show");
    if(opts.onSolved){ try{ opts.onSolved(elapsed()); }catch(e){ /* la page hote gere */ } }
  }
  function verify(){
    for(const k in PUZZLE.solution){
      if(user[k]) cellEls[k].classList.toggle("bad", norm(user[k]) !== norm(PUZZLE.solution[k]));
    }
  }
  function reveal(){
    if(!confirm("Reveler toute la solution ?")) return;
    for(const k in PUZZLE.solution){ user[k] = PUZZLE.solution[k]; cellEls[k].classList.remove("bad"); }
    render(); checkSolved();
  }
  function clearAll(){
    for(const k in PUZZLE.solution){ delete user[k]; cellEls[k].classList.remove("bad"); }
    render();
  }

  function escapeHtml(s){ return (s||"").replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m])); }
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
  document.getElementById("checkBtn").addEventListener("click", verify);
  document.getElementById("revealBtn").addEventListener("click", reveal);
  document.getElementById("clearBtn").addEventListener("click", clearAll);
  let relayoutTimer = null;
  window.addEventListener("resize", () => { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(layout, 60); });
  if(window.visualViewport) window.visualViewport.addEventListener("resize", () => setTimeout(layout, 60));

  const dateEl = document.getElementById("date");
  if(dateEl){
    try{ dateEl.textContent = opts.dateText || new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" }); }
    catch(e){ dateEl.textContent = opts.dateText || PUZZLE.title || ""; }
  }

  buildBoard();
  buildLists();
  buildKeyboard();
  gotoClue(PUZZLE.across[0] || PUZZLE.down[0], true);
  requestAnimationFrame(layout);

  const api = {
    selectClue: (dir, num) => { const w = (dir==="across"?PUZZLE.across:PUZZLE.down).find(x => x.num===num); if(w) gotoClue(w, true); },
    type: s => { for(const ch of s) place(ch); },
    tapKey: ch => place(ch),
    letterAt: (r,c) => user[K(r,c)] || "",
    currentClue: () => { const w = currentWord(); return w ? w.id : null; },
    wordHighlight: () => board.querySelectorAll(".cell.word").length,
    isSolved: () => solved,
    fillSolution: () => { for(const k in PUZZLE.solution) user[k] = PUZZLE.solution[k]; render(); checkSolved(); },
    elapsedShown: () => document.getElementById("timer").textContent
  };
  window.__play = api;
  return api;
}

// Grille de demonstration (aussi utilisee comme repli quand aucune grille du
// jour n'est publiee). Theme jeu de role, 15x15.
export const DEMO_PUZZLE = {"title":"Jeu de role","rows":15,"cols":15,"solution":{"9,0":"I","9,1":"N","9,2":"I","9,3":"T","9,4":"I","9,5":"A","9,6":"T","9,7":"I","9,8":"V","9,9":"E","6,6":"S","7,6":"O","8,6":"R","10,6":"I","11,6":"L","12,6":"E","13,6":"G","14,6":"E","7,2":"G","7,3":"R","7,4":"I","7,5":"M","7,7":"I","7,8":"R","7,9":"E","12,0":"B","12,1":"O","12,2":"U","12,3":"C","12,4":"L","12,5":"I","12,7":"R","14,0":"G","14,1":"U","14,2":"E","14,3":"R","14,4":"R","14,5":"I","14,7":"R","1,9":"S","2,9":"P","3,9":"E","4,9":"C","5,9":"T","6,9":"R","3,3":"V","3,4":"A","3,5":"M","3,6":"P","3,7":"I","3,8":"R","0,7":"D","1,7":"R","2,7":"U","4,7":"D","5,7":"E","0,2":"K","0,3":"O","0,4":"B","0,5":"O","0,6":"L","5,10":"R","5,11":"E","5,12":"S","5,13":"O","5,14":"R","1,10":"I","1,11":"R","1,12":"E","1,13":"N","1,14":"E","4,13":"P","6,13":"T","7,13":"I","8,13":"O","9,13":"N","0,11":"A","2,11":"M","3,11":"U","4,11":"R","8,10":"D","8,11":"E","8,12":"M","8,14":"N","7,11":"G","9,11":"A","10,11":"N","11,11":"T","6,0":"M","7,0":"O","8,0":"M","10,0":"E","11,8":"Q","11,9":"U","11,10":"E","11,12":"E","12,10":"L","13,10":"F","14,10":"E","2,4":"M","4,4":"G","5,4":"E","5,1":"E","5,2":"P","5,3":"E","11,2":"R","13,2":"N","14,9":"H","14,11":"A","14,12":"U","14,13":"M","14,14":"E","1,1":"O","2,1":"R","3,1":"Q","4,1":"U","10,14":"H","11,14":"Y","12,14":"D","13,14":"R"},"numbers":{"0,2":1,"0,7":2,"0,11":3,"1,1":4,"1,9":5,"2,4":6,"3,3":7,"4,13":8,"5,1":9,"5,9":10,"6,0":11,"6,6":12,"7,2":13,"7,11":14,"8,10":15,"9,0":16,"10,14":17,"11,2":18,"11,8":19,"11,10":20,"12,0":21,"14,0":22,"14,9":23},"bars":{},"across":[{"num":1,"clue":"Le petit reptilien fouisseur.","cells":[[0,2],[0,3],[0,4],[0,5],[0,6],[0,7]]},{"num":5,"clue":"La voix qui perd les marins.","cells":[[1,9],[1,10],[1,11],[1,12],[1,13],[1,14]]},{"num":7,"clue":"Le buveur de sang nocturne.","cells":[[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],[3,9]]},{"num":9,"clue":"L'arme blanche du chevalier.","cells":[[5,1],[5,2],[5,3],[5,4]]},{"num":10,"clue":"Le butin au fond du donjon.","cells":[[5,9],[5,10],[5,11],[5,12],[5,13],[5,14]]},{"num":13,"clue":"Le livre de sorts du mage.","cells":[[7,2],[7,3],[7,4],[7,5],[7,6],[7,7],[7,8],[7,9]]},{"num":15,"clue":"La creature des enfers.","cells":[[8,10],[8,11],[8,12],[8,13],[8,14]]},{"num":16,"clue":"Ce qui fixe l'ordre du combat.","cells":[[9,0],[9,1],[9,2],[9,3],[9,4],[9,5],[9,6],[9,7],[9,8],[9,9]]},{"num":19,"clue":"L'aventure a accomplir.","cells":[[11,8],[11,9],[11,10],[11,11],[11,12]]},{"num":21,"clue":"Ce qui pare les coups.","cells":[[12,0],[12,1],[12,2],[12,3],[12,4],[12,5],[12,6],[12,7]]},{"num":22,"clue":"Le combattant de premiere ligne.","cells":[[14,0],[14,1],[14,2],[14,3],[14,4],[14,5],[14,6],[14,7]]},{"num":23,"clue":"Le casque ferme du combattant.","cells":[[14,9],[14,10],[14,11],[14,12],[14,13],[14,14]]}],"down":[{"num":2,"clue":"Le gardien de la nature.","cells":[[0,7],[1,7],[2,7],[3,7],[4,7],[5,7]]},{"num":3,"clue":"La protection de plates du chevalier.","cells":[[0,11],[1,11],[2,11],[3,11],[4,11],[5,11]]},{"num":4,"clue":"La brute verte des armees du mal.","cells":[[1,1],[2,1],[3,1],[4,1],[5,1]]},{"num":5,"clue":"Le fantome vengeur.","cells":[[1,9],[2,9],[3,9],[4,9],[5,9],[6,9],[7,9]]},{"num":6,"clue":"Celui qui manie l'arcane.","cells":[[2,4],[3,4],[4,4],[5,4]]},{"num":8,"clue":"La fiole qui soigne ou empoisonne.","cells":[[4,13],[5,13],[6,13],[7,13],[8,13],[9,13]]},{"num":11,"clue":"Le mort bande des tombeaux.","cells":[[6,0],[7,0],[8,0],[9,0],[10,0]]},{"num":12,"clue":"L'effet magique de l'incantation.","cells":[[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6]]},{"num":14,"clue":"Le colosse des hautes terres.","cells":[[7,11],[8,11],[9,11],[10,11],[11,11]]},{"num":17,"clue":"Le monstre a plusieurs tetes.","cells":[[10,14],[11,14],[12,14],[13,14],[14,14]]},{"num":18,"clue":"Le signe grave, magique.","cells":[[11,2],[12,2],[13,2],[14,2]]},{"num":20,"clue":"L'oreille pointue des forets.","cells":[[11,10],[12,10],[13,10],[14,10]]}]};
