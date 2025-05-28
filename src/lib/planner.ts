import { Recipe, PriceMap } from "./types";
import { craftCost, expectedSkillUps, costPerSkillUp } from "./recipeCalc";
import type { MaterialInfo } from "./types";



const ENCHANTING_ROD_SPELL_IDS = new Set<number>([
    7421,   // Runed Copper Rod
    7795,   // Runed Silver Rod
    13628,  // Runed Golden Rod
    13702,  // Runed Truesilver Rod
    20051,  // Runed Arcanite Rod
]);

const blacklistedSpellIds = new Set<number>([
    15596, // Smoking Heart of the Mountain
    11480, // Transmutes
    11479,
    17187,
    17563,
    17564,
    17562,
    17561,
    17565,
    17566,
    17559,
    17560,
    25146,

]);

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
    prices: PriceMap,
    materialInfo: Record<number, MaterialInfo>,
    profession: string
    ) {
    const allUpgrades = [
        { level: 350, name: "Artisan" },
    ];
    
    const startSkill = skill;
    const upgrades = allUpgrades.filter(
        u => u.level > startSkill && u.level <= target
    );
    
    const rodRecipes = profession === "Enchanting"
        ? recipes
            .filter(
            r =>
                ENCHANTING_ROD_SPELL_IDS.has(r.id) &&
                r.minSkill >= startSkill &&
                r.minSkill <= target
            )
            .sort((a, b) => a.minSkill - b.minSkill)
        : [];
    
    const steps: PlanStep[] = [];
    let total = 0;
    let guard = 0;
    let justUpgraded = false;
    
    while (skill < target && guard++ < 5000) {
        if (rodRecipes.length && skill === rodRecipes[0].minSkill) {
        const rod = rodRecipes.shift()!;
        const chance = expectedSkillUps(rod, skill);
        const crafts = Math.ceil(1 / chance);
        const cost = crafts * craftCost(rod, prices, materialInfo);
    
        steps.push({
            recipe: rod,
            crafts,
            cost,
            endSkill: skill + 1,
            note: "Required enchanting rod",
        });
    
        total += cost;
        skill += 1;
        justUpgraded = true;
        continue;
        }
    
        // ① Insert upgrade step if due
        if (upgrades.length && skill === upgrades[0].level) {
        const { level, name } = upgrades.shift()!;
        steps.push({
            upgradeName: name,
            endSkill: skill,
            note: `Upgrade to ${name}`,
        });
        justUpgraded = true;
        continue;
        }
    
        // ② Find usable recipes, skipping blacklisted ones
        const usable = recipes.filter(
        r =>
            r.minSkill <= skill &&
            expectedSkillUps(r, skill) > 0 &&
            !blacklistedSpellIds.has(r.id) // ← blacklist applied here
        );
    
        if (!usable.length) break;
    
        // ③ Pick cheapest cost-per-skill-up
        usable.sort((a, b) => {
        const ca = costPerSkillUp(a, skill, prices, materialInfo);
        const cb = costPerSkillUp(b, skill, prices, materialInfo);
        return ca - cb;
        });
    
        const best = usable[0];
        const chance = expectedSkillUps(best, skill);
        const crafts = Math.ceil(1 / chance);
        const cost = crafts * craftCost(best, prices, materialInfo);
    
        // ④ Merge or push
        const last = steps[steps.length - 1];
        if (
        last !== undefined &&
        "recipe" in last &&
        last.recipe.id === best.id &&
        !justUpgraded
        ) {
        last.crafts! += crafts;
        last.cost! += cost;
        last.endSkill += 1;
        } else {
        steps.push({
            recipe: best,
            crafts,
            cost,
            endSkill: skill + 1,
        });
        }
    
        // ⑤ Advance state
        total += cost;
        skill += 1;
        justUpgraded = false;
    }
    
    return { steps, totalCost: total, finalSkill: skill };
    }