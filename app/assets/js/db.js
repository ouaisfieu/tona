/* =========================================================================
   TONA — Couche de persistance locale (IndexedDB)
   ========================================================================= 
   Schéma inspiré du cahier des charges (entités decks / cards / revlogs),
   mais adapté à une réalité mono-appareil, sans serveur : pas de table
   "outbox" active (il n'y a rien à synchroniser), mais chaque enregistrement
   porte tout de même created_at / updated_at / deleted_at (suppression douce)
   pour qu'une synchronisation future reste possible à ajouter sans tout
   redessiner.
   ========================================================================= */

const DB_NAME = "tona-app";
const DB_VERSION = 1;

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Repli simple (navigateurs anciens / environnements de test)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
export { uuid };

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("decks")) {
        db.createObjectStore("decks", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cards")) {
        const cards = db.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("deckId", "deckId", { unique: false });
        cards.createIndex("due", "due", { unique: false });
        cards.createIndex("noteId", "noteId", { unique: false });
      }
      if (!db.objectStoreNames.contains("revlogs")) {
        const revlogs = db.createObjectStore("revlogs", { keyPath: "id" });
        revlogs.createIndex("cardId", "cardId", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode = "readonly") {
  return db.transaction(stores, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, value) {
  const db = await openDB();
  const t = tx(db, [storeName], "readwrite");
  const store = t.objectStore(storeName);
  await reqToPromise(store.put(value));
  return value;
}

async function get(storeName, key) {
  const db = await openDB();
  const t = tx(db, [storeName]);
  return reqToPromise(t.objectStore(storeName).get(key));
}

async function getAll(storeName) {
  const db = await openDB();
  const t = tx(db, [storeName]);
  return reqToPromise(t.objectStore(storeName).getAll());
}

async function getAllByIndex(storeName, indexName, value) {
  const db = await openDB();
  const t = tx(db, [storeName]);
  return reqToPromise(t.objectStore(storeName).index(indexName).getAll(value));
}

async function del(storeName, key) {
  const db = await openDB();
  const t = tx(db, [storeName], "readwrite");
  await reqToPromise(t.objectStore(storeName).delete(key));
}

/* ----- Decks -------------------------------------------------------------- */

export async function listDecks() {
  const all = await getAll("decks");
  return all.filter((d) => !d.deletedAt);
}

export async function getDeck(id) {
  return get("decks", id);
}

export async function createDeck({ title, description, sourceId = null }) {
  const now = Date.now();
  const deck = { id: uuid(), sourceId, title: title?.trim() || "Paquet sans titre", description: description?.trim() || "", createdAt: now, updatedAt: now, deletedAt: null };
  await put("decks", deck);
  return deck;
}

export async function updateDeck(id, patch) {
  const deck = await get("decks", id);
  if (!deck) return null;
  Object.assign(deck, patch, { updatedAt: Date.now() });
  await put("decks", deck);
  return deck;
}

/** Suppression douce (soft delete) — conforme au cahier des charges, garde la porte ouverte à une synchro future. */
export async function softDeleteDeck(id) {
  const deck = await get("decks", id);
  if (!deck) return;
  deck.deletedAt = Date.now();
  deck.updatedAt = deck.deletedAt;
  await put("decks", deck);
  const cards = await getAllByIndex("cards", "deckId", id);
  for (const c of cards) {
    c.deletedAt = deck.deletedAt;
    c.updatedAt = deck.deletedAt;
    await put("cards", c);
  }
}

/* ----- Cards --------------------------------------------------------------- */

export async function listCardsByDeck(deckId, { includeDeleted = false } = {}) {
  const all = await getAllByIndex("cards", "deckId", deckId);
  return includeDeleted ? all : all.filter((c) => !c.deletedAt);
}

export async function getCard(id) {
  return get("cards", id);
}

/** Carte "vide" FSRS + métadonnées, prête à l'emploi. `noteId` regroupe les cartes issues d'un même cloze. */
export async function createCard({ deckId, front, back, noteId = null, clozeNumber = null, noteText = null }) {
  const now = Date.now();
  const card = {
    id: uuid(),
    deckId,
    noteId: noteId || uuid(),
    clozeNumber,
    noteText,
    front: front || "",
    back: back || "",
    state: 0, stability: 0, difficulty: 0, due: now, reps: 0, lapses: 0, learningStep: 0, lastReview: null,
    createdAt: now, updatedAt: now, deletedAt: null,
  };
  await put("cards", card);
  return card;
}

export async function updateCard(id, patch) {
  const card = await get("cards", id);
  if (!card) return null;
  Object.assign(card, patch, { updatedAt: Date.now() });
  await put("cards", card);
  return card;
}

export async function softDeleteCard(id) {
  const card = await get("cards", id);
  if (!card) return;
  card.deletedAt = Date.now();
  card.updatedAt = card.deletedAt;
  await put("cards", card);
}

export async function dueCards(deckId, now = Date.now()) {
  const cards = await listCardsByDeck(deckId);
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

/** Toutes les cartes actives (tous paquets confondus), pour le tableau de bord et la session "réviser tout". */
export async function allCards() {
  const all = await getAll("cards");
  return all.filter((c) => !c.deletedAt);
}

/* ----- Revlogs (journal immuable, append-only) ------------------------------ */

export async function addRevlog({ cardId, rating, stateBefore, durationMs }) {
  const entry = { id: uuid(), cardId, rating, state: stateBefore, reviewTime: Date.now(), durationMs: durationMs || 0 };
  await put("revlogs", entry);
  return entry;
}

export async function revlogsForCard(cardId) {
  return getAllByIndex("revlogs", "cardId", cardId);
}

export async function allRevlogs() {
  return getAll("revlogs");
}

/* ----- Meta (profil utilisateur : XP, niveau, séries, réglages) ------------- */

const META_DEFAULTS = {
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  streakFreezes: 0,
  lastStudyDate: null,
  desiredRetention: 0.9,
  dailyNewLimit: 20,
};

export async function getMeta() {
  const rows = await getAll("meta");
  const out = { ...META_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setMeta(patch) {
  const db = await openDB();
  const t = tx(db, ["meta"], "readwrite");
  const store = t.objectStore("meta");
  await Promise.all(Object.entries(patch).map(([key, value]) => reqToPromise(store.put({ key, value }))));
  return getMeta();
}

/* ----- Purge complète (utilisée par les tests / réinitialisation) ---------- */

export async function wipeAll() {
  const db = await openDB();
  const t = tx(db, ["decks", "cards", "revlogs", "meta"], "readwrite");
  await Promise.all([
    reqToPromise(t.objectStore("decks").clear()),
    reqToPromise(t.objectStore("cards").clear()),
    reqToPromise(t.objectStore("revlogs").clear()),
    reqToPromise(t.objectStore("meta").clear()),
  ]);
}
