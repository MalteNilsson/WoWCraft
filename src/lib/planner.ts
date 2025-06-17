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
    24266, // Gurubashi Mojo Madness - Requires Blood of Heroes
]);

// Items that should be crafted for their entire level span (from minSkill to gray)
// const fullSpanCraftItems = new Set([
//   // Tailoring
//   2963,  // Bolt of Linen Cloth
//   2964,  // Bolt of Woolen Cloth
//   3865,  // Bolt of Silk Cloth
//   3866,  // Bolt of Mageweave
//   18401, // Bolt of Runecloth
// ]);

// Items that should be crafted to cover material needs
const materialCraftItems = new Set([
  // Tailoring
  2963,  // Bolt of Linen Cloth
  2964,  // Bolt of Woolen Cloth
  3865,  // Bolt of Silk Cloth
  3866,  // Bolt of Mageweave
  18401, // Bolt of Runecloth
]);


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

// Types for our DP solution
type DPStep = {
    recipe?: Recipe;
    upgradeName?: string;
    crafts?: number;
    cost: number;
    endSkill: number;
    note?: string;
};

type DPState = {
    steps: DPStep[];
    totalCost: number;
    finalSkill: number;
};

type DPResult = {
    steps: DPStep[];
    totalCost: number;
};

export function makeDynamicPlan(
    skill: number,
    target: number,
    recipes: Recipe[],
    prices: PriceMap,
    materialInfo: Record<number, MaterialInfo>,
    profession: string,
    includeRecipeCost: boolean = false,
    skipLimitedStock: boolean = true,
    useMarketValue: boolean = false
): { steps: PlanStep[]; totalCost: number; finalSkill: number } {
    // Handle special cases first (rods, upgrades)
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

    // Initialize DP table
    const dp: Record<number, DPState> = {};
    const recipesUsed = new Set<number>();

    // Base case
    dp[startSkill] = {
        steps: [],
        totalCost: 0,
        finalSkill: startSkill
    };

    // Fill DP table
    for (let currentSkill = startSkill; currentSkill < target; currentSkill++) {
        const currentState = dp[currentSkill];
        if (!currentState) continue;

        // Handle rods if needed
        if (rodRecipes.length && currentSkill === rodRecipes[0].minSkill) {
            const rod = rodRecipes.shift()!;
            const cost = craftCost(rod, prices, materialInfo, includeRecipeCost);
            
            const newState: DPState = {
                steps: [...currentState.steps, {
                    recipe: rod,
                    crafts: 1,
                    cost,
                    endSkill: currentSkill + 1,
                    note: "Required enchanting rod"
                }],
                totalCost: currentState.totalCost + cost,
                finalSkill: currentSkill + 1
            };

            if (!dp[currentSkill + 1] || newState.totalCost < dp[currentSkill + 1].totalCost) {
                dp[currentSkill + 1] = newState;
            }
            continue;
        }

        // Handle upgrades if needed
        if (upgrades.length && currentSkill === upgrades[0].level) {
            const { level, name } = upgrades.shift()!;
            const newState: DPState = {
                steps: [...currentState.steps, {
                    upgradeName: name,
                    cost: 0,
                    endSkill: currentSkill,
                    note: `Upgrade to ${name}`
                }],
                totalCost: currentState.totalCost,
                finalSkill: currentSkill
            };

            if (!dp[currentSkill] || newState.totalCost < dp[currentSkill].totalCost) {
                dp[currentSkill] = newState;
            }
            continue;
        }

        // Try each recipe
        for (const recipe of recipes) {
            if (recipe.minSkill > currentSkill || 
                expectedSkillUps(recipe, currentSkill) <= 0 || 
                blacklistedSpellIds.has(recipe.id)) {
                continue;
            }

            // Skip limited stock and BoP recipes if enabled
            if (skipLimitedStock && recipe.source?.type === 'item' && recipe.source.recipeItemId) {
                const recipeInfo = materialInfo[recipe.source.recipeItemId];
                if (recipeInfo?.bop || recipeInfo?.limitedStock) {
                    continue;
                }
            }

            const chance = expectedSkillUps(recipe, currentSkill);
            const crafts = Math.ceil(1 / chance);
            const materialCost = craftCost(recipe, prices, materialInfo, false, false, useMarketValue) * crafts;
            const recipeCost = includeRecipeCost && !recipesUsed.has(recipe.id) ? 
                craftCost(recipe, prices, materialInfo, true, true, useMarketValue) : 0;

            // Check if this recipe was used in the previous step
            const wasUsedLastStep = currentState.steps.length > 0 && 
                'recipe' in currentState.steps[currentState.steps.length - 1] && 
                currentState.steps[currentState.steps.length - 1].recipe?.id === recipe.id;

            // Calculate virtual discount based on level-up chance
            // At 100% chance: 20% discount (0.8 multiplier)
            // At 0% chance: 0% discount (1.0 multiplier)
            const virtualDiscount = wasUsedLastStep ? (1 - (chance * 0.2)) : 1.0;

            // Add a penalty for switching to new recipes with low success rates
            // This prevents alternating between recipes
            // Maximum penalty of 25%
            const switchPenalty = !wasUsedLastStep ? (1 + (1 - chance) * 0.25) : 1.0;

            const totalCost = (materialCost + recipeCost) * virtualDiscount * switchPenalty;

            const newState: DPState = {
                steps: [...currentState.steps, {
                    recipe,
                    crafts,
                    cost: materialCost + recipeCost, // Store actual cost, not virtual cost
                    endSkill: currentSkill + 1
                }],
                totalCost: currentState.totalCost + totalCost,
                finalSkill: currentSkill + 1
            };

            if (!dp[currentSkill + 1] || newState.totalCost < dp[currentSkill + 1].totalCost) {
                dp[currentSkill + 1] = newState;
                recipesUsed.add(recipe.id);
            }
        }
    }

    // Find the best state
    let bestState = dp[target];
    if (!bestState) {
        // If we didn't reach the target, find the highest skill level we did reach
        const maxSkill = Math.max(...Object.keys(dp).map(Number));
        bestState = dp[maxSkill];
    }

    if (!bestState) {
        return { steps: [], totalCost: 0, finalSkill: skill };
    }

    // After finding the optimal path, calculate required material crafting
    const finalState = bestState;

    // Calculate total materials needed
    const materialTotals: Record<number, number> = {};
    for (const step of finalState.steps) {
        if ('recipe' in step && step.recipe && typeof step.crafts === 'number') {
            for (const [itemId, quantity] of Object.entries(step.recipe.materials)) {
                materialTotals[Number(itemId)] = (materialTotals[Number(itemId)] || 0) + quantity * step.crafts;
            }
        }
    }

    // Find material crafting recipes and their requirements
    const materialCraftRecipes = recipes.filter(r => materialCraftItems.has(r.id));
    const materialCraftSteps: PlanStep[] = [];

    for (const recipe of materialCraftRecipes) {
        const outputItemId = recipe.materials[0]; // Assuming first material is the output
        if (!outputItemId || !materialTotals[outputItemId]) continue;

        const totalNeeded = materialTotals[outputItemId];
        const chance = expectedSkillUps(recipe, recipe.minSkill);
        const crafts = Math.ceil(totalNeeded / chance);
        
        const materialCost = craftCost(recipe, prices, materialInfo, false, false, useMarketValue) * crafts;
        const recipeCost = includeRecipeCost && !recipesUsed.has(recipe.id) ? 
            craftCost(recipe, prices, materialInfo, true, true, useMarketValue) : 0;

        materialCraftSteps.push({
            recipe,
            crafts,
            cost: materialCost + recipeCost,
            endSkill: recipe.minSkill,
            note: `Crafting materials for other recipes`
        });
    }

    // Sort material crafting steps by minimum skill level
    materialCraftSteps.sort((a, b) => {
        if (!('recipe' in a) || !('recipe' in b)) return 0;
        return a.recipe.minSkill - b.recipe.minSkill;
    });

    // Convert finalState.steps to PlanStep[]
    const planSteps: PlanStep[] = finalState.steps.map(step => {
        if ('recipe' in step && step.recipe && typeof step.crafts === 'number') {
            const planStep: PlanStep = {
                recipe: step.recipe,
                crafts: step.crafts,
                cost: step.cost,
                endSkill: step.endSkill,
                note: step.note
            };
            return planStep;
        } else if ('upgradeName' in step && step.upgradeName) {
            const planStep: PlanStep = {
                upgradeName: step.upgradeName,
                endSkill: step.endSkill,
                note: step.note
            };
            return planStep;
        }
        throw new Error('Invalid step type');
    });

    // Insert material crafting steps at the beginning of the plan
    const finalSteps = [...materialCraftSteps, ...planSteps];
    
    // Merge steps that use the same recipe
    const mergedSteps: PlanStep[] = [];
    let currentStep: PlanStep | null = null;

    for (const step of finalSteps) {
        if ('recipe' in step) {
            if (currentStep && 'recipe' in currentStep && currentStep.recipe.id === step.recipe.id) {
                // Merge with current step
                currentStep.crafts += step.crafts;
                currentStep.cost += step.cost;
                currentStep.endSkill = step.endSkill;
            } else {
                // Start new step
                if (currentStep) {
                    mergedSteps.push(currentStep);
                }
                currentStep = { ...step };
            }
        } else {
            // Handle upgrade steps
            if (currentStep) {
                mergedSteps.push(currentStep);
                currentStep = null;
            }
            mergedSteps.push(step);
        }
    }

    // Add the last step if it exists
    if (currentStep) {
        mergedSteps.push(currentStep);
    }

    const totalCost = mergedSteps.reduce((sum, step) => {
        if ('cost' in step) {
            return sum + step.cost;
        }
        return sum;
    }, 0);

    return {
        steps: mergedSteps,
        totalCost,
        finalSkill: finalState.finalSkill
    };
}

export type MaterialRequirement = {
    itemId: number;
    quantity: number;
    name?: string;  // Optional name for display purposes
};

export function calculateTotalMaterials(
    steps: PlanStep[],
    materialInfo: Record<number, MaterialInfo>
): MaterialRequirement[] {
    const materialTotals: Record<number, number> = {};

    // Calculate total materials needed
    for (const step of steps) {
        if ('recipe' in step) {
            for (const [itemId, quantity] of Object.entries(step.recipe.materials)) {
                const numItemId = Number(itemId);
                materialTotals[numItemId] = (materialTotals[numItemId] || 0) + quantity * step.crafts;
            }
        }
    }

    // Convert to array and add names
    return Object.entries(materialTotals).map(([itemId, quantity]) => ({
        itemId: Number(itemId),
        quantity,
        name: materialInfo[Number(itemId)]?.name
    })).sort((a, b) => a.itemId - b.itemId);
}