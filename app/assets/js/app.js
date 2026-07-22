/* =========================================================================
   TONA — App (v2) : contrôleur principal
   ========================================================================= */
import * as db from "./db.js";
import * as fsrs from "./fsrs.js";
import * as content from "./content.js";
import * as gami from "./gamification.js";
import * as csv from "./csv.js";

const esc = content.escapeHtml;
const app = document.getElementById("app");
if (!app) throw new Error("#app introuvable");

const dlgNewDeck = document.getElementById("dlg-newdeck");
const dlgImport = document.getElementById("dlg-import");
const dlgConfirm = document.getElementById("dlg-confirm");
const toastEl = document.getElementById("toast");

/* ---------------------------------------------------------------------
   Utilitaires
   --------------------------------------------------------------------- */
let toastTimer = null;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("is-in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-in"), 2600);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return String(s || "paquet").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "paquet";
}

function truncate(s, max) {
  s = String(s ?? "");
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function etaLabel(deltaMs) {
  if (deltaMs < 60000) return "<1 min";
  if (deltaMs < 3600000) return Math.round(deltaMs / 60000) + " min";
  if (deltaMs < 86400000) return Math.round(deltaMs / 3600000) + " h";
  return Math.round(deltaMs / 86400000) + " j";
}

function renderContent(raw) {
  return `<div class="rendered">${content.renderMarkdown(raw)}</div>`;
}

function renderMathIn(el) {
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(el, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        throwOnError: false,
      });
    } catch { /* rendu LaTeX best-effort : on ignore une erreur isolée */ }
  }
}

/* ---------------------------------------------------------------------
   Statistiques de paquet / tableau de bord
   --------------------------------------------------------------------- */
async function deckStats(deckId) {
  const cards = await db.listCardsByDeck(deckId);
  const now = Date.now();
  const stats = { total: cards.length, newCount: 0, learning: 0, review: 0, due: 0 };
  for (const c of cards) {
    if (c.state === fsrs.State.New) stats.newCount++;
    else if (c.state === fsrs.State.Learning || c.state === fsrs.State.Relearning) stats.learning++;
    else stats.review++;
    if (c.due <= now) stats.due++;
  }
  return stats;
}

async function globalForecast(days = 14) {
  const cards = await db.allCards();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, () => 0);
  for (const c of cards) {
    const d = new Date(c.due);
    d.setHours(0, 0, 0, 0);
    const idx = Math.round((d - now) / 86400000);
    if (idx >= 0 && idx < days) buckets[idx]++;
    else if (idx < 0) buckets[0]++; // en retard : compté avec aujourd'hui
  }
  return buckets;
}

/* ---------------------------------------------------------------------
   Vue : Tableau de bord / Bibliothèque
   --------------------------------------------------------------------- */
async function viewLibrary() {
  const decks = await db.listDecks();
  const meta = await db.getMeta();
  const prog = gami.xpProgressWithinLevel(meta.xp);
  const allDue = (await db.allCards()).filter((c) => c.due <= Date.now()).length;
  const forecast = await globalForecast(10);
  const maxBucket = Math.max(1, ...forecast);

  const dash = `
    <div class="dash reveal is-in">
      <div class="dash__stat">
        <span class="dash__num">${allDue}</span>
        <span class="dash__lab">Cartes dues maintenant</span>
      </div>
      <div class="dash__stat levelbar">
        <div class="levelbar__top"><span>Niveau <b>${prog.level}</b></span><span>${prog.current} / ${prog.span} XP</span></div>
        <div class="levelbar__track"><span style="width:${prog.pct}%"></span></div>
      </div>
      <div class="dash__stat">
        <span class="streakbadge"><span class="streakbadge__flame">🔥</span><b>${meta.currentStreak}</b> j</span>
        <span class="dash__lab">Série en cours ${meta.streakFreezes ? `<span class="freeze">· ${meta.streakFreezes} gel${meta.streakFreezes > 1 ? "s" : ""}</span>` : ""}</span>
      </div>
      <div class="dash__stat">
        <div class="forecast" aria-hidden="true">
          ${forecast.map((n, i) => `<div class="forecast__bar" data-today="${i === 0}" style="height:${Math.max(4, (n / maxBucket) * 56)}px">${n ? `<span>${n}</span>` : ""}</div>`).join("")}
        </div>
        <span class="dash__lab">Prévision sur 10 jours</span>
      </div>
    </div>`;

  if (!decks.length) {
    return `
    <div class="app">
      <div class="app__head"><h1 class="app__title">Vos paquets (v2)</h1></div>
      ${dash}
      <div class="empty reveal is-in">
        <p class="kicker">Bibliothèque vide</p>
        <p>Créez un paquet, importez un fichier CSV/JSON, ou récupérez le paquet d'exemple « Guerre cognitive » pour commencer.</p>
        <div class="app__actions">
          <button class="btn btn--primary" data-action="new-deck">Créer un paquet</button>
          <button class="btn" data-action="open-catalog">Bibliothèque intégrée</button>
          <button class="btn" data-action="open-import">Importer un fichier</button>
        </div>
      </div>
    </div>`;
  }

  const cardsHtml = (await Promise.all(decks.map(async (d) => {
    const st = await deckStats(d.id);
    return `
    <div class="deckcard reveal is-in">
      <h3 class="deckcard__title">${esc(d.title)}</h3>
      ${d.description ? `<p class="deckcard__desc">${esc(d.description)}</p>` : ""}
      <div class="deckcard__meta">
        <span><b>${st.total}</b> carte${st.total > 1 ? "s" : ""}</span>
        <span class="learn">${st.newCount + st.learning} en cours</span>
        <span class="review">${st.review} en révision</span>
        <span>${st.due} due${st.due > 1 ? "s" : ""}</span>
      </div>
      <div class="deckcard__row">
        <button class="btn btn--primary btn--sm" data-action="study" data-id="${d.id}" ${st.total ? "" : "disabled"}>Étudier</button>
        <button class="btn btn--sm" data-action="edit" data-id="${d.id}">Éditer</button>
        <button class="btn btn--sm btn--ghost" data-action="export-json" data-id="${d.id}">Exporter JSON</button>
        <button class="btn btn--sm btn--ghost" data-action="export-csv" data-id="${d.id}">Exporter CSV</button>
        <button class="btn btn--sm btn--danger" data-action="delete-deck" data-id="${d.id}">Supprimer</button>
      </div>
    </div>`;
  }))).join("");

  return `
  <div class="app">
    <div class="app__head">
      <h1 class="app__title">Vos paquets (v2)</h1>
      <div class="app__actions">
        <button class="btn btn--primary" data-action="study-all" ${allDue ? "" : "disabled"}>Réviser tout ce qui est dû (${allDue})</button>
        <button class="btn" data-action="open-catalog">Bibliothèque intégrée</button>
        <button class="btn" data-action="open-import">Importer</button>
        <button class="btn" data-action="new-deck">Créer un paquet</button>
      </div>
    </div>
    ${dash}
    <div class="decks">${cardsHtml}</div>
  </div>`;
}

/* ---------------------------------------------------------------------
   Vue : Éditeur de paquet
   --------------------------------------------------------------------- */
async function viewEditor(deckId) {
  const deck = await db.getDeck(deckId);
  if (!deck || deck.deletedAt) return `<div class="empty"><p>Ce paquet n'existe plus.</p><a class="btn" href="#/">Retour à la bibliothèque</a></div>`;
  const cards = await db.listCardsByDeck(deckId);
  const basicCards = cards.filter((c) => c.clozeNumber === null);
  const clozeCards = cards.filter((c) => c.clozeNumber !== null);

  // Regrouper les cartes cloze par note (une note = un bloc de texte = potentiellement plusieurs cartes)
  const notes = new Map();
  for (const c of clozeCards) {
    if (!notes.has(c.noteId)) notes.set(c.noteId, { noteId: c.noteId, noteText: c.noteText || "", cards: [] });
    notes.get(c.noteId).cards.push(c);
  }

  const basicRows = basicCards.map((c, i) => `
    <div class="cardrow">
      <span class="cardrow__n">${String(i + 1).padStart(2, "0")}</span>
      <div class="field"><label>Question (recto)</label><textarea data-field="front" data-cardid="${c.id}" rows="2">${esc(c.front)}</textarea></div>
      <div class="field"><label>Réponse (verso)</label><textarea data-field="back" data-cardid="${c.id}" rows="2">${esc(c.back)}</textarea></div>
      <div class="cardrow__del"><button class="iconbtn" title="Supprimer" data-action="delete-card" data-cardid="${c.id}">×</button></div>
    </div>`).join("");

  const noteRows = [...notes.values()].map((n) => {
    const nums = n.cards.map((c) => c.clozeNumber).sort((a, b) => a - b);
    return `
    <div class="noterow">
      <div class="noterow__head">
        <span class="noterow__gen">${n.cards.length} carte${n.cards.length > 1 ? "s" : ""} (c${nums.join(", c")})</span>
        <button class="iconbtn" title="Supprimer la note" data-action="delete-note" data-noteid="${n.noteId}">×</button>
      </div>
      <div class="field">
        <label>Texte à trous — syntaxe {{c1::réponse::indice}}</label>
        <textarea data-field="notetext" data-noteid="${n.noteId}" rows="3">${esc(n.noteText)}</textarea>
      </div>
    </div>`;
  }).join("");

  return `
  <div class="app">
    <div class="app__head">
      <p class="breadcrumb"><a href="#/" data-action="back-to-library">Vos paquets</a><span>/</span>Éditer</p>
      <div class="app__actions">
        <button class="btn" data-action="open-import" data-target="${deck.id}">Importer des cartes ici</button>
        <button class="btn btn--primary" data-action="study" data-id="${deck.id}" ${cards.length ? "" : "disabled"}>Étudier ce paquet</button>
      </div>
    </div>

    <div class="editor__section">
      <div class="field--row">
        <div class="field"><label>Titre du paquet</label><input type="text" data-field="deck-title" value="${esc(deck.title)}"></div>
        <div class="field"><label>Description</label><input type="text" data-field="deck-desc" value="${esc(deck.description)}"></div>
      </div>
      <p class="hint">${cards.length} carte${cards.length > 1 ? "s" : ""} · enregistrement automatique dans ce navigateur (IndexedDB).</p>
    </div>

    <div class="editor__section">
      <p class="editor__sectiontitle">Cartes simples</p>
      ${basicRows || `<p class="hint">Aucune carte simple pour l'instant.</p>`}
      <div><button class="btn btn--primary btn--sm" data-action="add-card">Ajouter une carte simple</button></div>
    </div>

    <div class="editor__section">
      <p class="editor__sectiontitle">Notes à trous (cloze)</p>
      <p class="hint">Écrivez une phrase avec <code>{{c1::réponse}}</code>, <code>{{c2::autre réponse}}</code>… chaque numéro devient une carte indépendante, avec sa propre progression.</p>
      ${noteRows || `<p class="hint">Aucune note à trous pour l'instant.</p>`}
      <div><button class="btn btn--sm" data-action="add-note">Ajouter une note à trous</button></div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------
   Session d'étude
   --------------------------------------------------------------------- */
let session = null; // { deckId|null, queue:[card,...], index, flipped, revealedAt, meta }

async function buildQueue(deckId) {
  const meta = await db.getMeta();
  const now = Date.now();
  const cards = deckId ? await db.dueCards(deckId, now) : (await db.allCards()).filter((c) => c.due <= now);
  const learning = cards.filter((c) => c.state === fsrs.State.Learning || c.state === fsrs.State.Relearning);
  const review = cards.filter((c) => c.state === fsrs.State.Review).sort((a, b) => a.due - b.due);
  const fresh = cards.filter((c) => c.state === fsrs.State.New).slice(0, meta.dailyNewLimit);
  return [...learning, ...review, ...fresh];
}

async function startSession(deckId) {
  const queue = await buildQueue(deckId);
  session = { deckId, queue, index: 0, flipped: false, startXp: (await db.getMeta()).xp, reviewed: 0, know: 0, again: 0, revealedAt: Date.now() };
}

function renderStageActions(card) {
  if (!session.flipped) {
    return `<button class="btn btn--primary" data-action="flip">Retourner la carte (Espace)</button>`;
  }
  const now = Date.now();
  const previews = fsrs.previewIntervals(card, now, {}); // poids/rétention par défaut (méta appliquée à la sauvegarde)
  const buttons = [
    { key: "Again", label: "Again", cls: "btn--danger", kbd: "1" },
    { key: "Hard", label: "Hard", cls: "", kbd: "2" },
    { key: "Good", label: "Good", cls: "btn--primary", kbd: "3" },
    { key: "Easy", label: "Easy", cls: "", kbd: "4" },
  ];
  return buttons.map((b) => {
    const eta = etaLabel(previews[b.key].due - now);
    return `<button class="btn ${b.cls} gradebtn" data-action="grade" data-grade="${fsrs.Rating[b.key]}">
      <span>${b.label} <span class="hint">(${b.kbd})</span></span>
      <span class="gradebtn__eta">${eta}</span>
    </button>`;
  }).join("");
}

async function viewStudy() {
  if (!session) return `<div class="empty"><p>Aucune session en cours.</p><a class="btn" href="#/">Retour</a></div>`;

  if (session.index >= session.queue.length) {
    const meta = await db.getMeta();
    const beforeLevel = gami.levelForXp(session.startXp).level ?? gami.levelForXp(session.startXp);
    const lvlBefore = gami.levelForXp(session.startXp);
    const lvlAfter = gami.levelForXp(meta.xp);
    return `
    <div class="app">
      <div class="recap reveal is-in">
        <p class="kicker">Session terminée</p>
        <p class="recap__num">${session.reviewed}</p>
        <p class="muted">carte${session.reviewed > 1 ? "s" : ""} revue${session.reviewed > 1 ? "s" : ""}</p>
        <div class="recap__row">
          <span>XP gagnée : <b>${meta.xp - session.startXp}</b></span>
          <span>Série : <b>${meta.currentStreak} j</b> 🔥</span>
          <span>À revoir encore : <b>${session.again}</b></span>
        </div>
        ${lvlAfter > lvlBefore ? `<div class="recap__levelup">Niveau supérieur ! Vous êtes maintenant niveau ${lvlAfter}.</div>` : ""}
        <div class="app__actions">
          <a class="btn btn--primary" href="#/">Retour à la bibliothèque</a>
        </div>
      </div>
    </div>`;
  }

  const card = session.queue[session.index];
  const deck = await db.getDeck(card.deckId);
  const pos = session.index + 1;
  const total = session.queue.length;

  return `
  <div class="app">
    <p class="breadcrumb"><a href="#/">Bibliothèque</a><span>/</span>Étude${session.deckId ? "" : " · tous les paquets dus"}</p>
    <div class="studybar">
      <div class="studybar__stats">
        <span>Carte <b>${pos}</b> / ${total}</span>
        ${!session.deckId ? `<span class="hint">${esc(deck?.title || "")}</span>` : ""}
      </div>
      <a class="btn btn--sm btn--ghost" href="#/">Quitter</a>
    </div>
    <div class="progressbar" style="height:5px;border-radius:3px;background:var(--line);overflow:hidden;">
      <span style="display:block;height:100%;width:${Math.round((session.index / total) * 100)}%;background:var(--amber);"></span>
    </div>
    <div class="stage">
      <div class="flashcard ${session.flipped ? "is-flipped" : ""}" data-action="flip" role="button" tabindex="0" id="the-flashcard">
        <div class="flashcard__inner">
          <div class="flashcard__face flashcard__face--front">
            <span class="flashcard__tag">Question</span>
            <div class="flashcard__text">${renderContent(card.front)}</div>
            <span class="flashcard__hint">Espace pour retourner</span>
          </div>
          <div class="flashcard__face flashcard__face--back">
            <span class="flashcard__tag">Réponse</span>
            <div class="flashcard__text">${renderContent(card.back)}</div>
          </div>
        </div>
      </div>
      <div class="stage__actions" id="stage-actions">${renderStageActions(card)}</div>
    </div>
  </div>`;
}

function flipInPlace() {
  if (!session) return;
  session.flipped = true;
  const el = document.getElementById("the-flashcard");
  if (el) el.classList.add("is-flipped");
  const actions = document.getElementById("stage-actions");
  if (actions) actions.innerHTML = renderStageActions(session.queue[session.index]);
  renderMathIn(app);
}

async function gradeCurrentCard(grade) {
  if (!session || session.index >= session.queue.length) return;
  const card = session.queue[session.index];
  const now = Date.now();
  const durationMs = now - (session.revealedAt || now);
  const stateBefore = card.state;

  const meta = await db.getMeta();
  const result = fsrs.scheduleReview(card, grade, now, { desiredRetention: meta.desiredRetention });
  await db.updateCard(card.id, result);
  await db.addRevlog({ cardId: card.id, rating: grade, stateBefore, durationMs });

  const streakInfo = gami.registerStudyDay(meta, now);
  const newXp = meta.xp + gami.xpForRating(grade);
  await db.setMeta({
    xp: newXp,
    currentStreak: streakInfo.currentStreak,
    longestStreak: streakInfo.longestStreak,
    streakFreezes: streakInfo.streakFreezes,
    lastStudyDate: streakInfo.lastStudyDate,
  });

  session.reviewed++;
  if (grade === fsrs.Rating.Again) session.again++; else session.know++;
  session.index++;
  session.flipped = false;
  session.revealedAt = Date.now();
  render();
}

/* ---------------------------------------------------------------------
   Actions sur les paquets / cartes / notes
   --------------------------------------------------------------------- */
async function importCsvRows(deckId, rows) {
  let count = 0;
  for (const [rawFront, rawBack] of rows) {
    if (!rawFront && !rawBack) continue;
    if (content.hasCloze(rawFront)) {
      const noteId = db.uuid();
      for (const cc of content.buildClozeCards(rawFront)) {
        await db.createCard({ deckId, front: cc.front, back: cc.back, noteId, clozeNumber: cc.clozeNumber, noteText: rawFront });
        count++;
      }
    } else {
      await db.createCard({ deckId, front: rawFront, back: rawBack });
      count++;
    }
  }
  return count;
}

/* ----- Bibliothèque intégrée : détection auto des .csv de jeux/ (API GitHub), repli sur jeux/index.json ---- */
const GITHUB_REPO = "ouaisfieu/tona";
const CATALOG_DIR_CANDIDATES = ["jeux", "cartes/jeux"];

function titleFromFilename(name) {
  const base = name.replace(/\.csv$/i, "").replace(/[-_]+/g, " ").trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadMetadataOverrides(dir) {
  try {
    const res = await fetch(dir + "/index.json", { cache: "no-store" });
    if (!res.ok) return {};
    const idx = await res.json();
    const map = {};
    (idx.decks || []).forEach((e) => { if (e.file) map[e.file] = e; });
    return map;
  } catch { return {}; }
}

async function loadCatalogFromGithub(dir) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${dir}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error("gh-api");
  const listing = await res.json();
  if (!Array.isArray(listing)) throw new Error("gh-api-format");
  const files = listing.filter((it) => it.type === "file" && /\.csv$/i.test(it.name));
  if (!files.length) throw new Error("gh-api-empty");
  const overrides = await loadMetadataOverrides(dir);
  const items = [];
  for (const f of files) {
    try {
      const r = await fetch(f.download_url, { cache: "no-store" });
      if (r.ok) items.push({ file: f.name, text: await r.text(), ...(overrides[f.name] || {}) });
    } catch { /* fichier illisible : on l'ignore */ }
  }
  return items;
}

async function loadCatalogFromManifest(dir) {
  const res = await fetch(dir + "/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error("catalog");
  const idx = await res.json();
  const items = [];
  for (const entry of idx.decks || []) {
    try {
      const r = await fetch(dir + "/" + entry.file, { cache: "no-store" });
      if (r.ok) items.push({ file: entry.file, text: await r.text(), ...entry });
    } catch { /* fichier manquant : on l'ignore */ }
  }
  return items;
}

async function loadCatalog() {
  for (const dir of CATALOG_DIR_CANDIDATES) {
    try { const v = await loadCatalogFromGithub(dir); if (v.length) return v; } catch { /* on tente le repli */ }
    try { const v = await loadCatalogFromManifest(dir); if (v.length) return v; } catch { /* dossier suivant */ }
  }
  return [];
}

let catalogCache = [];

async function openCatalog() {
  const dlgCatalog = document.getElementById("dlg-catalog");
  const body = dlgCatalog.querySelector("[data-catalog-body]");
  body.innerHTML = `<p class="hint">Chargement du catalogue…</p>`;
  dlgCatalog.showModal();
  try {
    const items = await loadCatalog();
    catalogCache = items;
    if (!items.length) {
      body.innerHTML = `<p class="hint">Aucun fichier .csv trouvé dans <code>jeux/</code> ou <code>cartes/jeux/</code> à la racine du site.</p>`;
      return;
    }
    const decks = await db.listDecks();
    body.innerHTML = `<div class="catalog">${items.map((it, i) => {
      const id = it.id || slug(it.file.replace(/\.csv$/i, ""));
      const already = decks.some((d) => d.sourceId === id);
      const title = it.title || titleFromFilename(it.file);
      return `
      <div class="catalogitem">
        <div><div class="catalogitem__t">${esc(title)}</div><div class="catalogitem__d">${esc(it.description || "")}</div></div>
        <button class="btn btn--sm ${already ? "btn--ghost" : "btn--primary"}" data-action="import-catalog-deck" data-catalog-idx="${i}">${already ? "Importer une copie" : "Ajouter"}</button>
      </div>`;
    }).join("")}</div>`;
  } catch {
    body.innerHTML = `<p class="hint">Impossible de charger le catalogue pour l'instant. Vérifiez votre connexion et réessayez.</p>`;
  }
}

async function importCatalogDeck(idx) {
  const item = catalogCache[Number(idx)];
  if (!item) return;
  const id = item.id || slug(item.file.replace(/\.csv$/i, ""));
  const title = item.title || titleFromFilename(item.file);
  const rows = csv.parseCSV(item.text);
  const deck = await db.createDeck({ title, description: item.description || "", sourceId: id });
  const n = await importCsvRows(deck.id, rows);
  document.getElementById("dlg-catalog").close();
  location.hash = "#/";
  render();
  toast(`Ajouté : « ${truncate(title, 40)} » (${n} cartes)`);
}

/* ---------------------------------------------------------------------
   Routeur
   --------------------------------------------------------------------- */
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, id] = h.split("/");
  return { name: name || "", id };
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const r = currentRoute();
  let html;
  if (r.name === "editer" && r.id) html = await viewEditor(r.id);
  else if (r.name === "etudier") html = await viewStudy();
  else html = await viewLibrary();
  if (token !== renderToken) return; // une navigation plus récente a eu lieu entre-temps
  app.innerHTML = html;
  renderMathIn(app);
}

window.addEventListener("hashchange", render);

/* ---------------------------------------------------------------------
   Délégation d'événements
   --------------------------------------------------------------------- */
let pendingConfirm = null;
function askConfirm(message, onYes) {
  dlgConfirm.querySelector("[data-confirm-msg]").textContent = message;
  pendingConfirm = onYes;
  dlgConfirm.showModal();
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  switch (action) {
    case "new-deck":
      dlgNewDeck.querySelector("form").reset();
      dlgNewDeck.showModal();
      break;
    case "open-import":
      dlgImport.dataset.target = btn.dataset.target || "";
      dlgImport.querySelector("form").reset();
      dlgImport.showModal();
      break;
    case "open-catalog":
      await openCatalog();
      break;
    case "import-catalog-deck":
      await importCatalogDeck(btn.dataset.catalogIdx);
      break;
    case "back-to-library":
      location.hash = "#/";
      break;
    case "edit":
      location.hash = "#/editer/" + id;
      break;
    case "study":
      await startSession(id);
      location.hash = "#/etudier";
      render();
      break;
    case "study-all":
      await startSession(null);
      location.hash = "#/etudier";
      render();
      break;
    case "delete-deck":
      askConfirm("Supprimer définitivement ce paquet et toutes ses cartes ?", async () => {
        await db.softDeleteDeck(id);
        toast("Paquet supprimé.");
        render();
      });
      break;
    case "export-json": {
      const deck = await db.getDeck(id);
      const cards = await db.listCardsByDeck(id);
      download(slug(deck.title) + ".json", JSON.stringify({ title: deck.title, description: deck.description, cards: cards.map(({ front, back, noteText, clozeNumber }) => ({ front, back, noteText, clozeNumber })) }, null, 2), "application/json");
      break;
    }
    case "export-csv": {
      const deck = await db.getDeck(id);
      const cards = await db.listCardsByDeck(id);
      download(slug(deck.title) + ".csv", csv.toCSV(cards.map((c) => [c.noteText || c.front, c.back])), "text/csv");
      break;
    }
    case "add-card": {
      const deckId = currentRoute().id;
      await db.createCard({ deckId, front: "", back: "" });
      render();
      break;
    }
    case "delete-card":
      askConfirm("Supprimer cette carte ?", async () => { await db.softDeleteCard(btn.dataset.cardid); render(); });
      break;
    case "add-note": {
      const deckId = currentRoute().id;
      const noteId = db.uuid();
      await db.createCard({ deckId, front: "", back: "", noteId, clozeNumber: 1 });
      render();
      break;
    }
    case "delete-note":
      askConfirm("Supprimer cette note et toutes les cartes qu'elle a générées ?", async () => {
        const deckId = currentRoute().id;
        const cards = await db.listCardsByDeck(deckId);
        for (const c of cards.filter((c) => c.noteId === btn.dataset.noteid)) await db.softDeleteCard(c.id);
        render();
      });
      break;
    case "flip":
      flipInPlace();
      break;
    case "grade":
      await gradeCurrentCard(Number(btn.dataset.grade));
      break;
  }
});

document.addEventListener("input", async (e) => {
  const field = e.target.dataset ? e.target.dataset.field : null;
  if (!field) return;
  const deckId = currentRoute().id;

  if (field === "deck-title") { clearTimeout(e.target._t); e.target._t = setTimeout(() => db.updateDeck(deckId, { title: e.target.value }), 300); }
  else if (field === "deck-desc") { clearTimeout(e.target._t); e.target._t = setTimeout(() => db.updateDeck(deckId, { description: e.target.value }), 300); }
  else if (field === "front" || field === "back") {
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => db.updateCard(e.target.dataset.cardid, { [field]: e.target.value }), 300);
  } else if (field === "notetext") {
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => syncClozeNote(deckId, e.target.dataset.noteid, e.target.value), 400);
  }
});

/** Régénère les cartes d'une note à trous quand son texte change, en préservant la progression FSRS des cartes qui existent déjà. */
async function syncClozeNote(deckId, noteId, newText) {
  const existing = (await db.listCardsByDeck(deckId)).filter((c) => c.noteId === noteId);
  const specs = content.buildClozeCards(newText);
  const specNums = new Set(specs.map((s) => s.clozeNumber));

  for (const c of existing) {
    if (!specNums.has(c.clozeNumber)) await db.softDeleteCard(c.id);
  }
  for (const spec of specs) {
    const match = existing.find((c) => c.clozeNumber === spec.clozeNumber);
    if (match) await db.updateCard(match.id, { front: spec.front, back: spec.back, noteText: newText });
    else await db.createCard({ deckId, front: spec.front, back: spec.back, noteId, clozeNumber: spec.clozeNumber, noteText: newText });
  }
  // Ne pas tout re-render ici (on perdrait le focus du textarea en cours de frappe) —
  // la liste des cartes générées se met à jour au prochain rendu naturel (changement de vue).
}

document.addEventListener("keydown", (e) => {
  if (currentRoute().name !== "etudier" || !session || session.index >= session.queue.length) return;
  if (["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName)) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!session.flipped) flipInPlace(); }
  else if (session.flipped && ["1", "2", "3", "4"].includes(e.key)) gradeCurrentCard(Number(e.key));
});

/* ---------------------------------------------------------------------
   Boîtes de dialogue
   --------------------------------------------------------------------- */
document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

dlgNewDeck.querySelector("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const deck = await db.createDeck({ title: fd.get("title"), description: fd.get("description") });
  dlgNewDeck.close();
  location.hash = "#/editer/" + deck.id;
  render();
});

dlgConfirm.querySelector("[data-confirm-yes]").addEventListener("click", () => {
  if (pendingConfirm) pendingConfirm();
  pendingConfirm = null;
  dlgConfirm.close();
});

dlgImport.querySelector("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const file = fd.get("file");
  const pasted = fd.get("pasted");
  let name = "Paquet importé", text = "";
  if (file && file.size) { text = await file.text(); name = file.name.replace(/\.(csv|json|txt)$/i, ""); }
  else if (pasted && pasted.trim()) text = pasted;
  else { toast("Choisissez un fichier ou collez du contenu."); return; }

  const target = dlgImport.dataset.target;
  let rows;
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.cards;
    rows = (list || []).map((c) => [c.noteText || c.front || c.q || "", c.back || c.a || ""]);
    if (!target && data.title) name = data.title;
  } catch {
    rows = csv.parseCSV(text);
  }
  if (!rows.length) { toast("Aucune carte détectée dans ce contenu."); return; }

  if (target) {
    const n = await importCsvRows(target, rows);
    dlgImport.close();
    render();
    toast(`${n} carte${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.`);
  } else {
    const deck = await db.createDeck({ title: name, description: "" });
    const n = await importCsvRows(deck.id, rows);
    dlgImport.close();
    location.hash = "#/editer/" + deck.id;
    render();
    toast(`Paquet « ${truncate(deck.title, 40)} » créé (${n} cartes).`);
  }
});

/* ---------------------------------------------------------------------
   Service worker (best-effort, dégradation silencieuse si indisponible)
   --------------------------------------------------------------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* hors-ligne indisponible, l'app reste utilisable en ligne */ });
}

render();
