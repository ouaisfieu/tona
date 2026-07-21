/* =========================================================================
   TONA — Cartes : application de révision (vanilla JS, sans dépendance)
   Stockage : localStorage. CRUD complet sur les paquets et les cartes.
   ========================================================================= */
(function () {
  "use strict";

  const KEY_DECKS = "tona.cartes.decks.v1";
  const KEY_PROGRESS = "tona.cartes.progress.v1";
  const CATALOG_URL = "cartes/jeux/index.json";
  const CATALOG_BASE = "cartes/jeux/";

  const app = document.getElementById("app");
  if (!app) return;

  const dlgNewDeck = document.getElementById("dlg-newdeck");
  const dlgImport = document.getElementById("dlg-import");
  const dlgCatalog = document.getElementById("dlg-catalog");
  const dlgConfirm = document.getElementById("dlg-confirm");
  const toastEl = document.getElementById("toast");

  /* ---------------------------------------------------------------------
     Utilitaires
     --------------------------------------------------------------------- */
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const uid = (p) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-in"), 2600);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug(s) {
    return String(s || "paquet")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "paquet";
  }

  /* ---- CSV : parsing / génération (RFC4180 simplifié) ---- */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else field += c;
      }
    }
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows.filter((r) => r.some((f) => f.trim() !== ""));
  }

  function csvField(s) {
    s = String(s ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function cardsToCSV(cards) {
    return cards.map((c) => csvField(c.q) + "," + csvField(c.a)).join("\r\n");
  }

  /* ---------------------------------------------------------------------
     Stockage
     --------------------------------------------------------------------- */
  function loadDecks() {
    try {
      const raw = localStorage.getItem(KEY_DECKS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveDecks(decks) {
    try { localStorage.setItem(KEY_DECKS, JSON.stringify(decks)); }
    catch { toast("Stockage local indisponible — vos changements ne seront pas conservés."); }
  }
  function loadProgress() {
    try {
      const raw = localStorage.getItem(KEY_PROGRESS);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(KEY_PROGRESS, JSON.stringify(p)); } catch {}
  }

  let decks = loadDecks();
  let progress = loadProgress();

  function getDeck(id) { return decks.find((d) => d.id === id); }
  function deckProgress(id) { return progress[id] || (progress[id] = {}); }
  function cardStatus(deckId, cardId) { return (progress[deckId] || {})[cardId] || "new"; }

  function deckStats(deck) {
    const p = progress[deck.id] || {};
    let know = 0, review = 0;
    deck.cards.forEach((c) => {
      const s = p[c.id];
      if (s === "know") know++;
      else if (s === "review") review++;
    });
    return { total: deck.cards.length, know, review, seen: know + review };
  }

  /* ---------------------------------------------------------------------
     Actions sur les paquets (CRUD)
     --------------------------------------------------------------------- */
  function createDeck({ title, description }) {
    const deck = {
      id: uid("d"),
      sourceId: null,
      title: title.trim() || "Paquet sans titre",
      description: (description || "").trim(),
      cards: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    decks.push(deck);
    saveDecks(decks);
    return deck;
  }

  function duplicateDeck(id) {
    const src = getDeck(id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid("d");
    copy.title = src.title + " (copie)";
    copy.createdAt = copy.updatedAt = Date.now();
    copy.cards = copy.cards.map((c) => ({ ...c, id: uid("c") }));
    decks.push(copy);
    saveDecks(decks);
    toast("Paquet dupliqué.");
    render();
  }

  function deleteDeck(id) {
    decks = decks.filter((d) => d.id !== id);
    delete progress[id];
    saveDecks(decks);
    saveProgress(progress);
    toast("Paquet supprimé.");
    location.hash = "#/";
  }

  function resetDeckProgress(id) {
    progress[id] = {};
    saveProgress(progress);
    toast("Progression réinitialisée.");
    render();
  }

  function addCard(deckId, q, a) {
    const deck = getDeck(deckId);
    if (!deck) return;
    deck.cards.push({ id: uid("c"), q: q || "", a: a || "" });
    deck.updatedAt = Date.now();
    saveDecks(decks);
  }

  function deleteCard(deckId, cardId) {
    const deck = getDeck(deckId);
    if (!deck) return;
    deck.cards = deck.cards.filter((c) => c.id !== cardId);
    deck.updatedAt = Date.now();
    saveDecks(decks);
    if (progress[deckId]) delete progress[deckId][cardId];
    saveProgress(progress);
  }

  function moveCard(deckId, cardId, dir) {
    const deck = getDeck(deckId);
    if (!deck) return;
    const i = deck.cards.findIndex((c) => c.id === cardId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= deck.cards.length) return;
    [deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]];
    deck.updatedAt = Date.now();
    saveDecks(decks);
    render();
  }

  function importCardsInto(deckId, cards) {
    const deck = getDeck(deckId);
    if (!deck) return 0;
    cards.forEach((c) => deck.cards.push({ id: uid("c"), q: c.q, a: c.a }));
    deck.updatedAt = Date.now();
    saveDecks(decks);
    return cards.length;
  }

  /* ---------------------------------------------------------------------
     Confirmation générique
     --------------------------------------------------------------------- */
  let pendingConfirm = null;
  function askConfirm(message, onYes) {
    const body = dlgConfirm.querySelector("[data-confirm-msg]");
    if (body) body.textContent = message;
    pendingConfirm = onYes;
    dlgConfirm.showModal();
  }

  /* ---------------------------------------------------------------------
     Rendu : Bibliothèque
     --------------------------------------------------------------------- */
  function viewLibrary() {
    if (!decks.length) {
      return `
      <div class="app">
        <div class="app__head">
          <h1 class="app__title">Vos paquets de cartes</h1>
        </div>
        <div class="empty reveal is-in">
          <p class="kicker">Bibliothèque vide</p>
          <p>Créez un paquet, importez un fichier (CSV ou JSON), ou piochez dans la bibliothèque intégrée du site pour commencer à réviser.</p>
          <div class="app__actions">
            <button class="btn btn--primary" data-action="new-deck">Créer un paquet</button>
            <button class="btn" data-action="open-catalog">Bibliothèque intégrée</button>
            <button class="btn" data-action="open-import">Importer un fichier</button>
          </div>
        </div>
      </div>`;
    }

    const cards = decks
      .map((d) => {
        const st = deckStats(d);
        const pct = st.total ? Math.round((st.know / st.total) * 100) : 0;
        return `
        <div class="deckcard reveal is-in">
          <div class="deckcard__top">
            <h3 class="deckcard__title">${esc(d.title)}</h3>
          </div>
          ${d.description ? `<p class="deckcard__desc">${esc(d.description)}</p>` : ""}
          <div class="deckcard__meta">
            <span><b>${st.total}</b> carte${st.total > 1 ? "s" : ""}</span>
            <span>${st.know} sue${st.know > 1 ? "s" : ""}</span>
            <span>${st.review} à revoir</span>
          </div>
          <div class="progressbar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <div class="deckcard__row">
            <button class="btn btn--primary btn--sm" data-action="study" data-id="${d.id}" ${st.total ? "" : "disabled"}>Étudier</button>
            <button class="btn btn--sm" data-action="edit" data-id="${d.id}">Éditer</button>
            <button class="btn btn--sm btn--ghost" data-action="export-json" data-id="${d.id}">Exporter JSON</button>
            <button class="btn btn--sm btn--ghost" data-action="export-csv" data-id="${d.id}">Exporter CSV</button>
            <button class="btn btn--sm btn--ghost" data-action="duplicate" data-id="${d.id}">Dupliquer</button>
            ${st.seen ? `<button class="btn btn--sm btn--ghost" data-action="reset-progress" data-id="${d.id}">Réinitialiser</button>` : ""}
            <button class="btn btn--sm btn--danger" data-action="delete" data-id="${d.id}">Supprimer</button>
          </div>
        </div>`;
      })
      .join("");

    return `
    <div class="app">
      <div class="app__head">
        <h1 class="app__title">Vos paquets de cartes</h1>
        <div class="app__actions">
          <button class="btn" data-action="open-catalog">Bibliothèque intégrée</button>
          <button class="btn" data-action="open-import">Importer un fichier</button>
          <button class="btn btn--primary" data-action="new-deck">Créer un paquet</button>
        </div>
      </div>
      <div class="decks">${cards}</div>
    </div>`;
  }

  /* ---------------------------------------------------------------------
     Rendu : Éditeur de paquet
     --------------------------------------------------------------------- */
  function viewEditor(deckId) {
    const deck = getDeck(deckId);
    if (!deck) return notFound();
    const rows = deck.cards
      .map(
        (c, i) => `
      <div class="cardrow">
        <span class="cardrow__n">${String(i + 1).padStart(2, "0")}</span>
        <div class="field">
          <label>Question</label>
          <textarea data-field="q" data-cardid="${c.id}" rows="2">${esc(c.q)}</textarea>
        </div>
        <div class="field">
          <label>Réponse</label>
          <textarea data-field="a" data-cardid="${c.id}" rows="2">${esc(c.a)}</textarea>
        </div>
        <div class="cardrow__del">
          <button class="iconbtn" title="Monter" data-action="move-up" data-cardid="${c.id}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="iconbtn" title="Descendre" data-action="move-down" data-cardid="${c.id}" ${i === deck.cards.length - 1 ? "disabled" : ""}>↓</button>
          <button class="iconbtn" title="Supprimer la carte" data-action="delete-card" data-cardid="${c.id}">×</button>
        </div>
      </div>`
      )
      .join("");

    return `
    <div class="app">
      <div class="app__head">
        <div>
          <p class="breadcrumb"><a href="#/" data-action="back-to-library">Vos paquets</a><span>/</span>Éditer</p>
        </div>
        <div class="app__actions">
          <button class="btn" data-action="open-import" data-target="${deck.id}">Importer des cartes ici</button>
          <button class="btn btn--primary" data-action="study" data-id="${deck.id}" ${deck.cards.length ? "" : "disabled"}>Étudier ce paquet</button>
        </div>
      </div>

      <div class="editor__meta">
        <div class="field--row">
          <div class="field">
            <label for="deck-title">Titre du paquet</label>
            <input id="deck-title" type="text" data-field="title" value="${esc(deck.title)}">
          </div>
          <div class="field">
            <label for="deck-desc">Description</label>
            <input id="deck-desc" type="text" data-field="description" value="${esc(deck.description)}">
          </div>
        </div>
        <p class="hint">${deck.cards.length} carte${deck.cards.length > 1 ? "s" : ""} · les modifications sont enregistrées automatiquement dans ce navigateur.</p>
      </div>

      <div class="editor__cards">${rows || `<p class="hint">Aucune carte pour l'instant. Ajoutez-en une ci-dessous.</p>`}</div>

      <div class="app__actions">
        <button class="btn btn--primary" data-action="add-card" data-id="${deck.id}">Ajouter une carte</button>
      </div>
    </div>`;
  }

  function notFound() {
    return `<div class="empty"><p>Ce paquet n'existe plus.</p><a class="btn" href="#/">Retour à la bibliothèque</a></div>`;
  }

  /* ---------------------------------------------------------------------
     Rendu : Étude
     --------------------------------------------------------------------- */
  let session = null; // { deckId, order:[ids], index, flipped, filter }

  function startSession(deckId, filter) {
    const deck = getDeck(deckId);
    if (!deck) return;
    let pool = deck.cards;
    if (filter === "review") {
      pool = deck.cards.filter((c) => cardStatus(deckId, c.id) === "review");
    }
    const order = pool.map((c) => c.id);
    session = { deckId, order, index: 0, flipped: false, filter: filter || "all", done: order.length === 0 };
  }

  function shuffleSession() {
    if (!session) return;
    for (let i = session.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [session.order[i], session.order[j]] = [session.order[j], session.order[i]];
    }
    session.index = 0;
    session.flipped = false;
    render();
  }

  function viewStudy(deckId) {
    const deck = getDeck(deckId);
    if (!deck) return notFound();
    if (!session || session.deckId !== deckId) startSession(deckId, "all");

    const st = deckStats(deck);

    if (session.done || session.index >= session.order.length) {
      return `
      <div class="app">
        <p class="breadcrumb"><a href="#/editer/${deck.id}">${esc(deck.title)}</a><span>/</span>Étude terminée</p>
        <div class="recap reveal is-in">
          <p class="kicker">Session terminée</p>
          <p class="recap__num">${session.order.length}</p>
          <p class="muted">carte${session.order.length > 1 ? "s" : ""} parcourue${session.order.length > 1 ? "s" : ""}</p>
          <div class="recap__row">
            <span>Sues : <b class="know">${st.know}</b></span>
            <span>À revoir : <b class="review">${st.review}</b></span>
            <span>Non vues : <b>${st.total - st.seen}</b></span>
          </div>
          <div class="app__actions">
            ${st.review ? `<button class="btn btn--primary" data-action="restart" data-filter="review" data-id="${deck.id}">Revoir les cartes difficiles (${st.review})</button>` : ""}
            <button class="btn" data-action="restart" data-filter="all" data-id="${deck.id}">Recommencer tout le paquet</button>
            <a class="btn btn--ghost" href="#/">Retour à la bibliothèque</a>
          </div>
        </div>
      </div>`;
    }

    const cardId = session.order[session.index];
    const card = deck.cards.find((c) => c.id === cardId);
    const pos = session.index + 1;
    const total = session.order.length;

    return `
    <div class="app">
      <p class="breadcrumb"><a href="#/editer/${deck.id}">${esc(deck.title)}</a><span>/</span>Étude${session.filter === "review" ? " · cartes à revoir" : ""}</p>

      <div class="studybar">
        <div class="studybar__stats">
          <span>Carte <b>${pos}</b> / ${total}</span>
          <span class="know">Sues : <b>${st.know}</b></span>
          <span class="review">À revoir : <b>${st.review}</b></span>
        </div>
        <div class="app__actions">
          <button class="btn btn--sm" data-action="shuffle">Mélanger</button>
          <a class="btn btn--sm btn--ghost" href="#/">Quitter</a>
        </div>
      </div>

      <div class="progressbar"><span style="width:${Math.round((session.index / total) * 100)}%"></span></div>

      <div class="stage">
        <div class="flashcard ${session.flipped ? "is-flipped" : ""}" data-action="flip" role="button" tabindex="0" aria-label="Retourner la carte">
          <div class="flashcard__inner">
            <div class="flashcard__face flashcard__face--front">
              <span class="flashcard__tag">Question</span>
              <div class="flashcard__text">${esc(card.q)}</div>
              <span class="flashcard__hint">Cliquez, ou appuyez sur Espace, pour retourner la carte</span>
            </div>
            <div class="flashcard__face flashcard__face--back">
              <span class="flashcard__tag">Réponse</span>
              <div class="flashcard__text">${esc(card.a)}</div>
              <span class="flashcard__hint">Cette carte, vous la saviez ?</span>
            </div>
          </div>
        </div>

        <div class="stage__actions">
          ${
            session.flipped
              ? `<button class="btn" data-action="mark-review" style="border-color:var(--coral); color:var(--coral);">À revoir</button>
                 <button class="btn btn--primary" data-action="mark-know">Je savais</button>`
              : `<button class="btn" data-action="prev" ${session.index === 0 ? "disabled" : ""}>◂ Précédente</button>
                 <button class="btn btn--primary" data-action="flip">Retourner la carte</button>
                 <button class="btn" data-action="next">Suivante ▸</button>`
          }
        </div>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------------
     Import (fichier / catalogue)
     --------------------------------------------------------------------- */
  function parseImportedText(name, text) {
    // Essaie JSON d'abord (notre propre format ou un tableau {q,a})
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        return { title: name, cards: data.map((c) => ({ q: c.q ?? c.question ?? "", a: c.a ?? c.answer ?? c.reponse ?? "" })) };
      }
      if (data && Array.isArray(data.cards)) {
        return {
          title: data.title || name,
          description: data.description || "",
          cards: data.cards.map((c) => ({ q: c.q ?? c.question ?? "", a: c.a ?? c.answer ?? "" })),
        };
      }
    } catch { /* pas du JSON, on tente le CSV */ }

    const rows = parseCSV(text);
    const cards = rows.map((r) => ({ q: r[0] || "", a: r[1] || "" })).filter((c) => c.q || c.a);
    return { title: name, cards };
  }

  let catalogCache = [];

  async function loadCatalog() {
    const res = await fetch(CATALOG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("catalog");
    const idx = await res.json();
    const items = [];
    for (const entry of idx.decks || []) {
      try {
        const r = await fetch(CATALOG_BASE + entry.file, { cache: "no-store" });
        if (r.ok) items.push(await r.json());
      } catch { /* ignore un fichier manquant */ }
    }
    return items;
  }

  function importDeckFromCatalog(deckData) {
    const deck = {
      id: uid("d"),
      sourceId: deckData.id || slug(deckData.title),
      title: deckData.title || "Paquet importé",
      description: deckData.description || "",
      cards: (deckData.cards || []).map((c) => ({ id: uid("c"), q: c.q || "", a: c.a || "" })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    decks.push(deck);
    saveDecks(decks);
    return deck;
  }

  /* ---------------------------------------------------------------------
     Routeur
     --------------------------------------------------------------------- */
  function currentRoute() {
    const h = location.hash.replace(/^#\/?/, "");
    const [name, id] = h.split("/");
    return { name: name || "", id };
  }

  function render() {
    const r = currentRoute();
    if (r.name === "editer" && r.id) app.innerHTML = viewEditor(r.id);
    else if (r.name === "etudier" && r.id) app.innerHTML = viewStudy(r.id);
    else app.innerHTML = viewLibrary();
  }

  window.addEventListener("hashchange", render);

  /* ---------------------------------------------------------------------
     Délégation d'événements
     --------------------------------------------------------------------- */
  document.addEventListener("click", (e) => {
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
        dlgImport.querySelector("[data-import-title]").textContent = btn.dataset.target
          ? "Importer des cartes dans ce paquet"
          : "Importer un nouveau paquet";
        dlgImport.querySelector("form").reset();
        dlgImport.showModal();
        break;
      case "open-catalog":
        openCatalog();
        break;
      case "study":
        startSession(id, "all");
        location.hash = "#/etudier/" + id;
        render();
        break;
      case "edit":
        location.hash = "#/editer/" + id;
        break;
      case "back-to-library":
        location.hash = "#/";
        break;
      case "duplicate":
        duplicateDeck(id);
        break;
      case "delete":
        askConfirm("Supprimer définitivement ce paquet et sa progression ?", () => deleteDeck(id));
        break;
      case "reset-progress":
        askConfirm("Réinitialiser la progression de ce paquet (les cartes redeviennent « non vues ») ?", () => resetDeckProgress(id));
        break;
      case "export-json": {
        const d = getDeck(id);
        download(slug(d.title) + ".json", JSON.stringify({ title: d.title, description: d.description, cards: d.cards.map(({ q, a }) => ({ q, a })) }, null, 2), "application/json");
        break;
      }
      case "export-csv": {
        const d = getDeck(id);
        download(slug(d.title) + ".csv", cardsToCSV(d.cards), "text/csv");
        break;
      }
      case "add-card": {
        addCard(id, "", "");
        render();
        const rows = app.querySelectorAll("textarea[data-field='q']");
        const last = rows[rows.length - 1];
        if (last) last.focus();
        break;
      }
      case "delete-card": {
        const deckId = currentRoute().id;
        askConfirm("Supprimer cette carte ?", () => { deleteCard(deckId, btn.dataset.cardid); render(); });
        break;
      }
      case "move-up":
        moveCard(currentRoute().id, btn.dataset.cardid, -1);
        break;
      case "move-down":
        moveCard(currentRoute().id, btn.dataset.cardid, 1);
        break;
      case "flip":
        if (session) { session.flipped = !session.flipped; render(); }
        break;
      case "next":
        if (session) { session.index = Math.min(session.index + 1, session.order.length); session.flipped = false; render(); }
        break;
      case "prev":
        if (session) { session.index = Math.max(session.index - 1, 0); session.flipped = false; render(); }
        break;
      case "shuffle":
        shuffleSession();
        break;
      case "mark-know":
      case "mark-review": {
        if (!session) break;
        const cardId = session.order[session.index];
        const p = deckProgress(session.deckId);
        p[cardId] = action === "mark-know" ? "know" : "review";
        saveProgress(progress);
        session.index += 1;
        session.flipped = false;
        render();
        break;
      }
      case "restart": {
        const filter = btn.dataset.filter || "all";
        startSession(btn.dataset.id, filter);
        render();
        break;
      }
      case "import-catalog-deck": {
        const deckData = catalogCache[Number(btn.dataset.catalogIdx)];
        if (!deckData) break;
        const deck = importDeckFromCatalog(deckData);
        toast(`Paquet « ${deck.title} » ajouté (${deck.cards.length} cartes).`);
        dlgCatalog.close();
        location.hash = "#/";
        render();
        break;
      }
    }
  });

  // Édition inline (titre/description de paquet, question/réponse des cartes)
  let saveTimer = null;
  app.addEventListener("input", (e) => {
    const field = e.target.dataset ? e.target.dataset.field : null;
    if (!field) return;
    const deckId = currentRoute().id;
    const deck = getDeck(deckId);
    if (!deck) return;

    if (field === "title" || field === "description") {
      deck[field] = e.target.value;
    } else if (field === "q" || field === "a") {
      const c = deck.cards.find((c) => c.id === e.target.dataset.cardid);
      if (c) c[field] = e.target.value;
    }
    deck.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDecks(decks), 300);
  });

  // Clavier en mode étude
  document.addEventListener("keydown", (e) => {
    if (currentRoute().name !== "etudier" || !session || session.done) return;
    if (document.activeElement && ["TEXTAREA", "INPUT"].includes(document.activeElement.tagName)) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (session.index < session.order.length) {
        session.flipped = !session.flipped;
        render();
      }
    } else if (e.key === "ArrowRight" && !session.flipped) {
      session.index = Math.min(session.index + 1, session.order.length);
      render();
    } else if (e.key === "ArrowLeft" && !session.flipped) {
      session.index = Math.max(session.index - 1, 0);
      render();
    } else if (session.flipped && (e.key === "1" || e.key.toLowerCase() === "r")) {
      app.querySelector("[data-action='mark-review']")?.click();
    } else if (session.flipped && (e.key === "2" || e.key.toLowerCase() === "k")) {
      app.querySelector("[data-action='mark-know']")?.click();
    }
  });

  /* ---------------------------------------------------------------------
     Boîtes de dialogue
     --------------------------------------------------------------------- */
  document.querySelectorAll("dialog [data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close())
  );
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  });

  dlgNewDeck.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const deck = createDeck({ title: fd.get("title"), description: fd.get("description") });
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

    if (file && file.size) {
      text = await file.text();
      name = file.name.replace(/\.(csv|json|txt)$/i, "");
    } else if (pasted && pasted.trim()) {
      text = pasted;
    } else {
      toast("Choisissez un fichier ou collez du contenu à importer.");
      return;
    }

    const parsed = parseImportedText(name, text);
    if (!parsed.cards.length) {
      toast("Aucune carte détectée dans ce contenu.");
      return;
    }

    const target = dlgImport.dataset.target;
    if (target) {
      const n = importCardsInto(target, parsed.cards);
      toast(`${n} carte${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""} au paquet.`);
      dlgImport.close();
      render();
    } else {
      const deck = createDeck({ title: parsed.title, description: parsed.description || "" });
      importCardsInto(deck.id, parsed.cards);
      toast(`Paquet « ${deck.title} » créé avec ${parsed.cards.length} cartes.`);
      dlgImport.close();
      location.hash = "#/editer/" + deck.id;
      render();
    }
  });

  async function openCatalog() {
    const body = dlgCatalog.querySelector("[data-catalog-body]");
    body.innerHTML = `<p class="hint">Chargement du catalogue…</p>`;
    dlgCatalog.showModal();
    try {
      const items = await loadCatalog();
      catalogCache = items;
      if (!items.length) {
        body.innerHTML = `<p class="hint">Aucun paquet disponible dans la bibliothèque du site pour le moment.</p>`;
        return;
      }
      body.innerHTML = `<div class="catalog">${items
        .map((it, i) => {
          const already = decks.some((d) => d.sourceId === (it.id || slug(it.title)));
          return `
          <div class="catalogitem">
            <div>
              <div class="catalogitem__t">${esc(it.title)}</div>
              <div class="catalogitem__d">${esc(it.description || "")} · ${(it.cards || []).length} cartes</div>
            </div>
            <button class="btn btn--sm ${already ? "btn--ghost" : "btn--primary"}" data-action="import-catalog-deck" data-catalog-idx="${i}">
              ${already ? "Importer une copie" : "Ajouter"}
            </button>
          </div>`;
        })
        .join("")}</div>`;
    } catch {
      body.innerHTML = `<p class="hint">Impossible de charger le catalogue pour l'instant. Vérifiez votre connexion et réessayez.</p>`;
    }
  }

  /* ---------------------------------------------------------------------
     Démarrage
     --------------------------------------------------------------------- */
  render();
})();
