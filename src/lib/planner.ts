import { Recipe, PriceMap } from "./types";
import { craftCost, expectedSkillUps, costPerSkillUp } from "./recipeCalc";
import type { MaterialInfo } from "./types";

export const ENCHANTING_ROD_SPELL_IDS = new Set<number>([
    7421,   // Runed Copper Rod
    7795,   // Runed Silver Rod
    13628,  // Runed Golden Rod
    13702,  // Runed Truesilver Rod
    20051,  // Runed Arcanite Rod
]);

export const blacklistedSpellIds = new Set<number>([
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
    18560, // Mooncloth
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
    profession: string,
    includeRecipeCost: boolean = false,
    skipLimitedStock: boolean = true
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
    let currentRecipe: Recipe | null = null;
    
    while (skill < target && guard++ < 5000) {
        if (rodRecipes.length && skill === rodRecipes[0].minSkill) {
            const rod = rodRecipes.shift()!;
            // For rods, we just craft once since they are required
            const cost = craftCost(rod, prices, materialInfo, includeRecipeCost);
            
            steps.push({
                recipe: rod,
                crafts: 1,
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
        
        // ② Find usable recipes, skipping blacklisted ones and handling limited stock/BoP
        const usable = recipes.filter(
            r => {
                // Basic recipe requirements
                if (r.minSkill > skill || expectedSkillUps(r, skill) <= 0 || blacklistedSpellIds.has(r.id)) {
                    return false;
                }
                
                // Skip limited stock and BoP recipes if enabled
                if (skipLimitedStock && r.source?.type === 'item' && r.source.recipeItemId) {
                    const recipeInfo = materialInfo[r.source.recipeItemId];
                    if (recipeInfo?.bop || recipeInfo?.limitedStock) {
                        return false;
                    }
                }
                
                return true;
            }
        );
        
        if (!usable.length) break;
        
        // ③ Pick cheapest cost-per-skill-up, considering recipe cost based on toggle
        usable.sort((a, b) => {
            const chanceA = expectedSkillUps(a, skill);
            const chanceB = expectedSkillUps(b, skill);
            const craftsA = Math.ceil(1 / chanceA);
            const craftsB = Math.ceil(1 / chanceB);
            
            // Calculate base material costs
            const baseCostA = craftCost(a, prices, materialInfo) * craftsA;
            const baseCostB = craftCost(b, prices, materialInfo) * craftsB;
            
            // Add recipe costs only when switching recipes and if enabled
            const recipeCostA = includeRecipeCost && a !== currentRecipe ? craftCost(a, prices, materialInfo, true, true) : 0;
            const recipeCostB = includeRecipeCost && b !== currentRecipe ? craftCost(b, prices, materialInfo, true, true) : 0;
            
            const totalCostA = baseCostA + recipeCostA;
            const totalCostB = baseCostB + recipeCostB;

            // Add a "tedium factor" that penalizes recipes requiring many crafts
            // Only apply tedium when not in orange range (not 100% chance)
            const isOrangeA = skill < a.difficulty.yellow!;
            const isOrangeB = skill < b.difficulty.yellow!;
            
            // The penalty increases quadratically with the number of crafts
            const tediumFactorA = isOrangeA ? 0 : craftsA * craftsA * 100; // 100 copper per craft squared
            const tediumFactorB = isOrangeB ? 0 : craftsB * craftsB * 100;
            
            return (totalCostA + tediumFactorA) - (totalCostB + tediumFactorB);
        });
        
        const best = usable[0];
        const chance = expectedSkillUps(best, skill);
        const crafts = Math.ceil(1 / chance);
        
        // Calculate costs
        const baseCost = craftCost(best, prices, materialInfo) * crafts;
        const recipeCost = includeRecipeCost && best !== currentRecipe ? craftCost(best, prices, materialInfo, true, true) : 0;
        const totalCost = baseCost + recipeCost;
        
        // ④ Merge or push
        const last = steps[steps.length - 1];
        if (
            last !== undefined &&
            "recipe" in last &&
            last.recipe.id === best.id &&
            !justUpgraded
        ) {
            last.crafts += crafts;
            last.cost += baseCost; // Only add base cost for additional crafts
            last.endSkill += 1;
        } else {
            steps.push({
                recipe: best,
                crafts,
                cost: totalCost,
                endSkill: skill + 1,
            });
        }
        
        // ⑤ Advance state
        total += totalCost;
        skill += 1;
        justUpgraded = false;
        currentRecipe = best; // Track current recipe for cost calculations
    }
    
    return { steps, totalCost: total, finalSkill: skill };
}