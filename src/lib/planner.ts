import { Recipe, PriceMap } from "./types";
import { craftCost, expectedSkillUps } from "./recipeCalc";

/**
 * Greedy-but-accurate: at each exact skill point we choose the recipe
 * with the lowest average gold per skill-up, then craft it enough
 * times to guarantee +1 skill on average (ceil(1 / chance)).
 */
export type PlanStep = {
    recipe: Recipe;
    crafts: number;
    cost:   number;
    /** new */
    endSkill: number;
    /** optional explanatory badge */
    note?:  string;
  };
  
  export function makeDynamicPlan(
    skill: number,
    target: number,
    recipes: Recipe[],
    prices: PriceMap
  ) {
    const steps: PlanStep[] = [];
    let total  = 0;
    let guard  = 0;
  
    while (skill < target && guard++ < 2000) {
      /* usable recipes right now */
      const usable = recipes.filter(
        r => r.minSkill <= skill && expectedSkillUps(r, skill) > 0
      );
      if (!usable.length) break;
  
      /* sort by CPSU (cost-per-skill-up) ascending */
      usable.sort((a, b) => {
        const cpsuA = craftCost(a, prices) / expectedSkillUps(a, skill);
        const cpsuB = craftCost(b, prices) / expectedSkillUps(b, skill);
        return cpsuA - cpsuB;
      });
  
      let best     = usable[0];
      let chance   = expectedSkillUps(best, skill);
      let bestCpsu = craftCost(best, prices) / chance;
      let note: string | undefined;
  
      /* switch if chance < 10 % AND a “faster” option costs ≤ 2× */
      if (chance < 0.10) {
        const alt = usable.find(r => {
          const ch   = expectedSkillUps(r, skill);
          const cpsu = craftCost(r, prices) / ch;
          return ch >= 0.10 && cpsu <= bestCpsu * 2;
        });
        if (alt) {
          note     = `Skipped ${best.name} – too slow (${(chance*100).toFixed(1)} %)`;
          best     = alt;
          chance   = expectedSkillUps(best, skill);
          bestCpsu = craftCost(best, prices) / chance;
        }
      }
  
      const crafts = Math.ceil(1 / chance);
      const cost   = crafts * craftCost(best, prices);
    
      /* merge or push step while carrying endSkill */
      const last = steps[steps.length - 1];
      if (last && last.recipe.id === best.id) {
        last.crafts   += crafts;
        last.cost     += cost;
        last.endSkill += 1;              // ← every loop = +1 skill
        if (note) last.note = note;
      } else {
        steps.push({
          recipe:    best,
          crafts,
          cost,
          endSkill:  skill + 1,          // ← result after this step
          note
        });
      }
    
      total += cost;
      skill += 1;                       // we simulated +1 skill-up
    }
  
    return { steps, totalCost: total, finalSkill: skill };
  }