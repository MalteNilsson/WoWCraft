import { Recipe, PriceMap } from "./types";
import { craftCost, expectedSkillUps } from "./recipeCalc";

/**
 * Greedy-but-accurate: at each exact skill point we choose the recipe
 * with the lowest average gold per skill-up, then craft it enough
 * times to guarantee +1 skill on average (ceil(1 / chance)).
 */
export type PlanStep =
    | {
        recipe: Recipe;
        crafts: number;
        cost:   number;
        endSkill: number;
        note?:  string;
    }
    | {
        upgradeName: string;
        endSkill:   number;

        note?:      string;
    };
  
export function makeDynamicPlan(
    skill: number,
    target: number,
    recipes: Recipe[],
    prices: PriceMap
    ) {
        // list all three thresholds...
        const allUpgrades = [
          //{ level: 50,  name: "Journeyman" },
          //{ level: 125, name: "Expert"     },
          { level: 350, name: "Artisan"    },
        ];
      
        // drop any we’ve already passed (e.g. when slider starts >50)
        const startSkill = skill;
        const upgrades   = allUpgrades.filter(
          u => u.level > startSkill && u.level <= target
        );
      
        const steps: PlanStep[] = [];
        let total  = 0;
        let guard  = 0;
        let justUpgraded = false;
    
    while (skill < target && guard++ < 5000) {
        // ① Insert an upgrade step if due
        if (upgrades.length && skill === upgrades[0].level) {
        const { level, name } = upgrades.shift()!;
        steps.push({
            upgradeName: name,
            endSkill:    skill,
            note:        `Upgrade to ${name}`,
        });
        justUpgraded = true;
        continue;
        }
    
        // ② Find usable recipes
        const usable = recipes.filter(r => 
        r.minSkill <= skill &&
        expectedSkillUps(r, skill) > 0
        );
        if (!usable.length) break;
    
        // ③ Pick the cheapest CPSU
        usable.sort((a, b) => {
        const ca = craftCost(a, prices) / expectedSkillUps(a, skill);
        const cb = craftCost(b, prices) / expectedSkillUps(b, skill);
        return ca - cb;
        });
        const best   = usable[0];
        const chance = expectedSkillUps(best, skill);
        const crafts = Math.ceil(1 / chance);
        const cost   = crafts * craftCost(best, prices);
    
        // ④ Merge or push
        const last = steps[steps.length - 1];
        if (
        // we have a prior step
        last !== undefined &&
        // that step is a craft (not an upgrade)
        "recipe" in last &&
        // *and* it's the same recipe
        last.recipe.id === best.id &&
        // *and* it wasn't just after an upgrade
        !justUpgraded
        ) {
        last.crafts!   += crafts;
        last.cost!     += cost;
        last.endSkill  += 1;   // advance by # of skill-ups
        } else {
        steps.push({
            recipe:    best,
            crafts,
            cost,
            endSkill:  skill + 1,
        });
        }
    
        // ⑤ Advance state and clear the upgrade guard
        total += cost;
        skill += 1;
        justUpgraded = false;
    }
    
    return { steps, totalCost: total, finalSkill: skill };
}   