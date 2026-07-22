/* =========================================================================
   TONA — Moteur FSRS-4.5 (Free Spaced Repetition Scheduler)
   ========================================================================= 

   Implémentation fidèle des formules publiées par l'équipe open-spaced-repetition
   (voir https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm).

   Choix assumé : FSRS-4.5 (17 paramètres, poids par défaut publiés) plutôt que
   FSRS-6 (21 paramètres). FSRS-6 nécessite un historique de révisions optimisé
   par apprentissage automatique pour dépasser réellement FSRS-4.5 ; sans cet
   entraînement, FSRS-4.5 avec ses poids par défaut donne des résultats quasi
   identiques (~98% du gain de FSRS-6 selon les benchmarks publics) pour une
   implémentation bien plus simple et vérifiable. Les poids ne sont PAS
   optimisés sur l'historique personnel de l'utilisateur ici — ce sont les
   valeurs par défaut publiées, entraînées sur un grand jeu de données public.

   États de carte (automate à 4 états, conforme au cahier des charges) :
     0 = New        (jamais étudiée)
     1 = Learning    (apprentissage initial, paliers courts en minutes)
     2 = Review      (FSRS pilote entièrement la planification, en jours)
     3 = Relearning  (a été oubliée en Review, retour à des paliers courts)

   Les paliers d'apprentissage courts (Learning/Relearning) sont une couche de
   présentation classique (façon Anki) : FSRS-4.5 modélise nativement des
   intervalles à l'échelle du jour, pas de la minute. Le calcul de Stabilité
   et Difficulté (S, D) via les formules FSRS s'applique cependant dès la
   première évaluation, y compris pendant les paliers courts — seule la durée
   avant la prochaine présentation (due) suit les paliers fixes tant que la
   carte n'a pas "gradué" vers l'état Review.
   ========================================================================= */

export const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });
export const State = Object.freeze({ New: 0, Learning: 1, Review: 2, Relearning: 3 });

// Poids par défaut FSRS-4.5 (17 paramètres), publiés par open-spaced-repetition.
export const DEFAULT_WEIGHTS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // choisi pour que R(t=S, S) = 0.9 exactement

// Paliers d'apprentissage / réapprentissage par défaut, en minutes (façon Anki).
export const DEFAULT_LEARNING_STEPS_MIN = [1, 10];
export const DEFAULT_RELEARNING_STEPS_MIN = [10];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clampD = (d) => clamp(d, 1, 10);
const clampS = (s) => Math.max(0.01, s);

/** Récupérabilité R(t,S) : probabilité de rappel après t jours écoulés depuis la dernière révision. */
export function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (FACTOR * t) / stability, DECAY);
}

/** Intervalle (en jours) pour atteindre exactement la rétention désirée `r` (0 < r < 1) depuis la stabilité S. */
export function nextIntervalDays(stability, desiredRetention) {
  const r = clamp(desiredRetention, 0.7, 0.99);
  const days = (stability / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
  return Math.max(1, days);
}

function S0(w, grade) {
  return w[grade - 1]; // S0(1)=w0 (Again) … S0(4)=w3 (Easy)
}

function D0(w, grade) {
  const d = w[4] - (grade - 3) * w[5];
  return clampD(d);
}

/** Difficulté après révision, avec réversion vers la moyenne (anti "Ease Hell"). */
function nextDifficulty(w, D, grade) {
  const target = D0(w, Rating.Good); // D0(3)
  const raw = D - w[6] * (grade - 3);
  const reverted = w[7] * target + (1 - w[7]) * raw;
  return clampD(reverted);
}

/** Stabilité après un rappel réussi (Hard, Good ou Easy). */
function nextStabilityOnRecall(w, D, S, R, grade) {
  const hardPenalty = grade === Rating.Hard ? w[15] : 1;
  const easyBonus = grade === Rating.Easy ? w[16] : 1;
  const gain =
    Math.exp(w[8]) *
    (11 - D) *
    Math.pow(S, -w[9]) *
    (Math.exp(w[10] * (1 - R)) - 1) *
    hardPenalty *
    easyBonus;
  return clampS(S * (gain + 1));
}

/** Stabilité après un oubli (grade Again en état Review) — "post-lapse stability". */
function nextStabilityOnLapse(w, D, S, R) {
  const s = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
  return clampS(Math.min(s, S)); // l'oubli ne peut jamais accroître la stabilité au-delà de l'ancienne valeur
}

/** Léger flou (fuzz) sur un intervalle en jours, pour éviter que des cartes créées ensemble reviennent groupées. */
function fuzz(days) {
  if (days < 2.5) return days; // pas de flou sur les tout petits intervalles
  const span = days * 0.05;
  return days + (Math.random() * 2 - 1) * span;
}

/**
 * Calcule le nouvel état d'une carte après une évaluation.
 * @param {object} card { state, stability, difficulty, due, reps, lapses, lastReview }
 * @param {number} grade Rating.Again|Hard|Good|Easy
 * @param {number} now timestamp ms
 * @param {object} opts { weights, desiredRetention, learningSteps, relearningSteps }
 * @returns {object} nouvelle carte + { elapsedDays, retrievability, intervalDays }
 */
export function scheduleReview(card, grade, now, opts = {}) {
  const w = opts.weights || DEFAULT_WEIGHTS;
  const desiredRetention = opts.desiredRetention ?? 0.9;
  const learningSteps = (opts.learningSteps || DEFAULT_LEARNING_STEPS_MIN).map((m) => m * 60000);
  const relearningSteps = (opts.relearningSteps || DEFAULT_RELEARNING_STEPS_MIN).map((m) => m * 60000);

  const isNew = card.state === State.New;
  const elapsedDays = isNew || !card.lastReview ? 0 : (now - card.lastReview) / 86400000;
  const R = isNew ? null : retrievability(elapsedDays, card.stability);

  let D, S;
  if (isNew) {
    D = D0(w, grade);
    S = S0(w, grade);
  } else if (grade === Rating.Again) {
    D = nextDifficulty(w, card.difficulty, grade);
    S = card.state === State.Review ? nextStabilityOnLapse(w, D, card.stability, R) : card.stability;
  } else {
    D = nextDifficulty(w, card.difficulty, grade);
    S = nextStabilityOnRecall(w, D, card.stability, R, grade);
  }

  const reps = (card.reps || 0) + 1;
  const lapses = (card.lapses || 0) + (grade === Rating.Again && card.state === State.Review ? 1 : 0);

  // --- Transition d'état + planification ---
  let state, due, intervalDays = null;
  const step = card.learningStep || 0;

  if (grade === Rating.Easy && (isNew || card.state === State.Learning || card.state === State.Relearning)) {
    // Easy gradue immédiatement vers Review, quel que soit le palier en cours.
    state = State.Review;
    intervalDays = fuzz(nextIntervalDays(S, desiredRetention));
    due = now + intervalDays * 86400000;
  } else if (isNew || card.state === State.Learning || card.state === State.Relearning) {
    const steps = card.state === State.Relearning ? relearningSteps : learningSteps;
    if (grade === Rating.Again) {
      state = isNew ? State.Learning : card.state === State.Review ? State.Relearning : card.state;
      due = now + steps[0];
    } else {
      // Hard : répète le palier courant. Good : avance au palier suivant, ou gradue si c'était le dernier.
      const nextStep = grade === Rating.Hard ? step : step + 1;
      if (nextStep >= steps.length) {
        state = State.Review;
        intervalDays = fuzz(nextIntervalDays(S, desiredRetention));
        due = now + intervalDays * 86400000;
      } else {
        state = isNew ? State.Learning : card.state;
        due = now + steps[nextStep];
      }
    }
  } else {
    // Card en Review, grade != Easy
    if (grade === Rating.Again) {
      state = State.Relearning;
      due = now + relearningSteps[0];
    } else {
      state = State.Review;
      intervalDays = fuzz(nextIntervalDays(S, desiredRetention));
      due = now + intervalDays * 86400000;
    }
  }

  const newLearningStep =
    state === State.Learning || state === State.Relearning
      ? grade === Rating.Again
        ? 0
        : grade === Rating.Hard
        ? step
        : step + 1
      : 0;

  return {
    state,
    stability: S,
    difficulty: D,
    due,
    reps,
    lapses,
    learningStep: newLearningStep,
    lastReview: now,
    // Valeurs informatives (pour affichage "intervalle prévu", tableaux de bord, etc.)
    _elapsedDays: elapsedDays,
    _retrievability: R,
    _intervalDays: intervalDays,
  };
}

/** Carte vierge, prête pour la première révision. */
export function emptyCard() {
  return {
    state: State.New,
    stability: 0,
    difficulty: 0,
    due: Date.now(),
    reps: 0,
    lapses: 0,
    learningStep: 0,
    lastReview: null,
  };
}

/**
 * Simule les 4 issues possibles (Again/Hard/Good/Easy) pour affichage préalable
 * (ex: "Again → 10 min · Hard → 1 j · Good → 3 j · Easy → 6 j").
 */
export function previewIntervals(card, now, opts = {}) {
  const out = {};
  for (const [name, grade] of Object.entries(Rating)) {
    out[name] = scheduleReview(card, grade, now, opts);
  }
  return out;
}
