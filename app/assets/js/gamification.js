/* =========================================================================
   TONA — Gamification (fonctions pures, testables sans DOM)
   ========================================================================= 
   Choix assumé : uniquement des leviers "White Hat" (progression, maîtrise,
   séries bienveillantes avec gel). Volontairement absents : butin aléatoire
   (loot-box), urgence artificielle, ou toute mécanique conçue pour exploiter
   la libération de dopamine de façon compulsive.
   ========================================================================= */

// Barème d'XP par note (Again reste positif : on veut récompenser l'effort de révision, pas le punir).
export const XP_TABLE = { 1: 1, 2: 3, 3: 5, 4: 8 }; // Rating.Again/Hard/Good/Easy

export function xpForRating(rating) {
  return XP_TABLE[rating] ?? 0;
}

// Courbe de niveau triangulaire : xpForLevel(n) = XP_UNIT * n*(n+1)/2 — chaque niveau demande un peu plus que le précédent.
const XP_UNIT = 40;

export function xpRequiredForLevel(level) {
  const n = Math.max(0, level - 1);
  return Math.round((XP_UNIT * n * (n + 1)) / 2);
}

export function levelForXp(xp) {
  let level = 1;
  while (xpRequiredForLevel(level + 1) <= xp) level++;
  return level;
}

export function xpProgressWithinLevel(xp) {
  const level = levelForXp(xp);
  const floor = xpRequiredForLevel(level);
  const ceiling = xpRequiredForLevel(level + 1);
  const span = Math.max(1, ceiling - floor);
  return { level, floor, ceiling, current: xp - floor, span, pct: Math.min(100, Math.round(((xp - floor) / span) * 100)) };
}

const DAY_MS = 86400000;
const dateKey = (d) => new Date(d).toISOString().slice(0, 10); // "YYYY-MM-DD" en UTC (simple et déterministe)
const daysBetween = (aKey, bKey) => Math.round((new Date(bKey + "T00:00:00Z") - new Date(aKey + "T00:00:00Z")) / DAY_MS);

/**
 * Met à jour la série de jours d'étude consécutifs.
 * @param {object} state { currentStreak, longestStreak, streakFreezes, lastStudyDate ("YYYY-MM-DD"|null) }
 * @param {number|Date} now
 * @returns {object} nouvel état + { streakBroken, freezeConsumed, alreadyCountedToday }
 */
export function registerStudyDay(state, now) {
  const today = dateKey(now);
  const s = { currentStreak: 0, longestStreak: 0, streakFreezes: 0, lastStudyDate: null, ...state };

  if (s.lastStudyDate === today) {
    return { ...s, streakBroken: false, freezeConsumed: false, alreadyCountedToday: true };
  }

  let streakBroken = false;
  let freezeConsumed = false;

  if (!s.lastStudyDate) {
    s.currentStreak = 1;
  } else {
    const gap = daysBetween(s.lastStudyDate, today);
    if (gap === 1) {
      s.currentStreak += 1;
    } else if (gap === 2 && s.streakFreezes > 0) {
      // Un seul jour manqué : le gel de série (s'il y en a un disponible) protège automatiquement la série.
      s.streakFreezes -= 1;
      s.currentStreak += 1;
      freezeConsumed = true;
    } else {
      streakBroken = s.currentStreak > 0;
      s.currentStreak = 1;
    }
  }

  s.longestStreak = Math.max(s.longestStreak, s.currentStreak);
  s.lastStudyDate = today;
  return { ...s, streakBroken, freezeConsumed, alreadyCountedToday: false };
}

export const STREAK_FREEZE_COST_XP = 200;

/** Achète un gel de série avec de l'XP accumulée. Retourne { ok, xp, streakFreezes }. */
export function buyStreakFreeze(xp, streakFreezes, cost = STREAK_FREEZE_COST_XP) {
  if (xp < cost) return { ok: false, xp, streakFreezes };
  return { ok: true, xp: xp - cost, streakFreezes: streakFreezes + 1 };
}
