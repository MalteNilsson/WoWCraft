import { Recipe, PriceMap } from "./types";

/** Total copper cost to craft the recipe once */
export function craftCost(r: Recipe, prices: PriceMap): number {
    let sum = 0;
  
    for (const [id, qty] of Object.entries(r.materials)) {
      const price = prices[id]?.minBuyout ?? prices[id]?.marketValue ?? 0;
      if (price === 0) return Infinity;   // ← skip unpriced recipe
      sum += price * qty;
    }
  
    return sum;
  }

/**
 * Expected skill-ups from one craft at the current skill, using
 * Blizzard’s linear formula:
 *
 *   chance = (G − X) / (G − Y)
 *
 * where
 *   G = gray threshold
 *   Y = yellow threshold
 *   X = current skill
 *
 * Returns a value between 0 and 1.
 */

export function expectedSkillUps(r: Recipe, skill: number): number {
  const { yellow: Y, gray: G } = r.difficulty;

  // If thresholds are missing or malformed, fall back
  if (!Y || !G || G <= Y) {
    return skill < (Y ?? 0) ? 1 : 0;
  }

  if (skill <= Y) return 1;       // Full chance up to yellow
  if (skill >= G) return 0;       // No chance once gray

  // Linear interpolation between Y and G
  return (G - skill) / (G - Y);
}

/** Average copper per skill-up at the current skill */
export function costPerSkillUp(
  r: Recipe,
  currentSkill: number,
  prices: PriceMap
): number {
  const chance = expectedSkillUps(r, currentSkill);
  return chance > 0 ? craftCost(r, prices) / chance : Infinity;
}