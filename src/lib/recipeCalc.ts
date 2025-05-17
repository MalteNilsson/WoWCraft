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
    // Use yellow threshold; default to 0 if missing
    const Y = r.difficulty.yellow ?? 0;
    // Use gray threshold; default to Infinity if missing
    const G = r.difficulty.gray   ?? Infinity;
  
    // Full 100% chance up through yellow
    if (skill <= Y) return 1;
    // No chance at or past gray
    if (skill >= G) return 0;
  
    // Pure linear dropoff between yellow and gray
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