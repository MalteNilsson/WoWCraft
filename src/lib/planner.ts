import { Recipe, PriceMap } from "./types";
import { craftCost, expectedSkillUps, costPerSkillUp, expectedCraftsBetween, getRecipeCost, getEffectiveMinSkill, type PriceSourcing } from "./recipeCalc";
import type { MaterialInfo } from "./types";
import type { RegionSoldPerDayMap } from "./regionDataLoader";
import { ENCHANTING_ROD_SPELL_IDS, ENCHANTING_ROD_PRODUCT_ITEM_IDS } from "./rodConstants";

export { ENCHANTING_ROD_SPELL_IDS, ENCHANTING_ROD_PRODUCT_ITEM_IDS };

/** In profit modes (cost-vendor, disenchant, auction-house), reject recipes below this skill-up chance to avoid "use until exhaustion" */
const MIN_SKILL_UP_CHANCE_PROFIT_MODE = 0.1;

/** In auction-house mode, reject recipes whose output has fewer than this many auctions (unreliable price data) */
const MIN_NUM_AUCTIONS_AH_MODE = 4;

/** In auction-house mode, reject recipes with profit margin above this (likely outlier data). 5 = 500% */
const MAX_PROFIT_MARGIN_AH_MODE = 5;

/** In auction-house mode, reject recipes whose output has soldPerDay below this (illiquid, unreliable prices).
 * Region data uses fractional values (e.g. 0.007 = <1 sale/day). We only reject essentially dead items (soldPerDay ≈ 0). */
export function getMinSoldPerDayForProfession(_profession: string): number {
  return 0.001;
}

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
    23489, // Ultrasafe Transporter - Gadgetzan
    23486, // Dimensional Ripper - Everlook+
    12716, // Goblin Mortar
    22757, // Elemental Sharpening Stone
    28463, // Ironvine Belt
    36122, // Earthforged Leggings
    36128, // Light Emberforged Hammer
    36125, // Light Earthforged Blade
    36124, // Windforged Leggings
    36126, // Light Skyforged Axe
    36129, // Heavy Earthforged Breastplate
    36130, // Stormforged Hauberk
    36131, // Windforged Rapier
    36133, // Stoneforged Claymore
    26011, // Tranquil Mechanical Yeti
    26426, // Rockets
    26423,
    26416,
    26428,
    26427,
    26420,
    26425,
    26424,
    26422,
    26417,
    26421,
    26418,
    15295, // Dark Iron Shoulders
    15293, // Dark Iron Mail
    9980,  // Ornate Mithril Helm
    32765, // Transmutes TBC
    32766, 
    28567,
    28569,
    28566,
    28585,
    28584,
    28582,
    28583,
    28580,
    28581,
    29688,
    28569,
    28568,
]);


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
        cost:   number;  // Material cost only (crafts × material cost per craft)
        recipeCost?: number;  // Recipe acquisition cost (one-time, not per craft)
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
    cost: number;  // Material cost only
    recipeCost?: number;  // Recipe acquisition cost (one-time)
    endSkill: number;
    note?: string;
};

type DPState = {
    steps: DPStep[];
    totalCost: number;
    finalSkill: number;
};

// Backward DP state with shopping list
type BackwardDPState = {
    steps: DPStep[];
    totalCost: number;
    startSkill: number;
    shoppingList: Map<number, number>; // itemId -> quantity needed
};

type DPResult = {
    steps: DPStep[];
    totalCost: number;
};

/**
 * Build a map of recipe ID -> item ID for recipes that produce craftable items
 * Uses materials.json to find which recipes produce which items
 */
function buildRecipeProducesMap(materialInfo: Record<number, MaterialInfo>): Map<number, number> {
    const recipeProduces = new Map<number, number>();
    
    for (const [itemIdStr, material] of Object.entries(materialInfo)) {
        const itemId = Number(itemIdStr);
        if (material.createdBy?.spellId) {
            // Recipe with spellId produces this item
            recipeProduces.set(material.createdBy.spellId, itemId);
        }
    }
    
    return recipeProduces;
}

export function makeDynamicPlan(
    skill: number,
    target: number,
    recipes: Recipe[],
    prices: PriceMap,
    materialInfo: Record<number, MaterialInfo>,
    profession: string,
    includeRecipeCost: boolean = false,
    skipLimitedStock: boolean = true,
    useMarketValue: boolean = false,
    recalculateForEachLevel: boolean = false,
    optimizeSubCrafting: boolean = true,
    currentProfessionRecipeIds?: Set<number>,
    priceSourcing: PriceSourcing = 'cost',
    regionSoldPerDay?: RegionSoldPerDayMap
): { steps: PlanStep[]; totalCost: number; finalSkill: number } {
    // Build recipe produces map (static data)
    const recipeProduces = buildRecipeProducesMap(materialInfo);
    
    const startSkill = skill;
    
    const rodRecipes = profession === "Enchanting"
        ? recipes
            .filter(
            r =>
                ENCHANTING_ROD_SPELL_IDS.has(r.id) &&
                getEffectiveMinSkill(r) >= startSkill &&
                getEffectiveMinSkill(r) <= target
            )
            .sort((a, b) => getEffectiveMinSkill(a) - getEffectiveMinSkill(b))
        : [];

    // Initialize backward DP table
    const dp: Record<number, BackwardDPState> = {};

    // Base case at target skill
    dp[target] = {
        steps: [],
        totalCost: 0,
        startSkill: target,
        shoppingList: new Map()
    };

    // Backward DP: work from target down to startSkill
    if (recalculateForEachLevel) {
        // Original behavior: recalculate for each skill level
    for (let currentSkill = target; currentSkill > startSkill; currentSkill--) {
        const currentState = dp[currentSkill];
        if (!currentState) continue;

        // Handle rods if needed (going backward, so check if rod is needed at currentSkill)
        if (rodRecipes.length) {
            const rod = rodRecipes.find(r => getEffectiveMinSkill(r) === currentSkill);
            if (rod) {
                const rodMaterialCost = craftCost(rod, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
                const rodRecipeCost = includeRecipeCost ? 
                    craftCost(rod, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession) : 0;
                // Calculate skill-up from crafting the rod at currentSkill - 1
                const skillBeforeRod = currentSkill - 1;
                const skillUpsFromRod = Math.floor(expectedSkillUps(rod, skillBeforeRod));
                const endSkillAfterRod = skillBeforeRod + skillUpsFromRod;
                const newState: BackwardDPState = {
                    steps: [{
                    recipe: rod,
                    crafts: 1,
                        cost: rodMaterialCost,  // Material cost only
                        recipeCost: rodRecipeCost > 0 ? rodRecipeCost : undefined,  // Recipe cost separately
                        endSkill: endSkillAfterRod,
                    note: "Required enchanting rod"
                    }, ...currentState.steps],
                    totalCost: currentState.totalCost + rodMaterialCost + rodRecipeCost,
                    startSkill: currentSkill - 1,
                    shoppingList: new Map(currentState.shoppingList)
                };
                
                // Add rod materials to shopping list (exclude rod products - made in previous rod step)
                for (const [matId, qty] of Object.entries(rod.materials)) {
                    const itemId = Number(matId);
                    if (ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(itemId)) continue;
                    const current = newState.shoppingList.get(itemId) || 0;
                    newState.shoppingList.set(itemId, current + qty);
                }
                
                // Consume produced material if rod produces something
                const producesId = recipeProduces.get(rod.id);
                if (producesId) {
                    const current = newState.shoppingList.get(producesId) || 0;
                    newState.shoppingList.set(producesId, Math.max(0, current - 1));
                }
                
                dp[currentSkill - 1] = newState;
                continue;
            }
        }

        // Find all valid recipes for this skill level
        const validRecipes = recipes.filter(r => {
            const chance = expectedSkillUps(r, currentSkill - 1);
            if (getEffectiveMinSkill(r) > currentSkill - 1 || 
                chance <= 0 || 
                blacklistedSpellIds.has(r.id)) {
                return false;
            }

            // In profit modes: hard cut-off below 10% to prevent "use until exhaustion"
            if (priceSourcing !== 'cost' && chance < MIN_SKILL_UP_CHANCE_PROFIT_MODE) {
                return false;
            }

            // In auction-house mode: exclude recipes whose output has < 4 auctions (unreliable price data)
            if (priceSourcing === 'auction-house' && r.produces?.id) {
                const numAuctions = prices[r.produces.id]?.numAuctions ?? 0;
                if (numAuctions < MIN_NUM_AUCTIONS_AH_MODE) return false;

                // Exclude recipes whose output has very low soldPerDay (illiquid, unreliable region data)
                // Only reject when we have data; items not in region map are allowed (no liquidity data)
                if (regionSoldPerDay) {
                    const soldPerDay = regionSoldPerDay.get(r.produces.id);
                    if (soldPerDay !== undefined && soldPerDay < getMinSoldPerDayForProfession(profession)) return false;
                }

                // Exclude recipes with > 500% profit margin (likely outlier data)
                const materialCost = craftCost(r, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, 'cost', profession);
                const priceData = prices[r.produces.id];
                const ahPricePerItem = useMarketValue
                    ? (priceData?.marketValue ?? priceData?.minBuyout ?? 0)
                    : (priceData?.minBuyout ?? priceData?.marketValue ?? 0);
                const ahRevenue = ahPricePerItem * (r.produces.quantity ?? 1);
                if (materialCost > 0 && (ahRevenue - materialCost) / materialCost > MAX_PROFIT_MARGIN_AH_MODE) return false;
                if (materialCost <= 0 && ahRevenue > 0) return false; // infinite profit = outlier
            }

            // Skip recipes with no recipe cost (unavailable BoP seasonal recipes)
            if (r.source) {
                const recipeCostData = getRecipeCost(r, prices, materialInfo, useMarketValue);
                // If both vendorPrice and ahPrice are null, recipe is unavailable
                if (recipeCostData.vendorPrice === null && recipeCostData.ahPrice === null) {
                    return false;
                }
            }

            // Skip limited stock BoP recipes if enabled (can't be acquired reliably)
            // Limited stock recipes that aren't BoP are allowed (can use AH price)
            if (skipLimitedStock && r.source?.type === 'item' && r.source.recipeItemId) {
                const recipeInfo = materialInfo[r.source.recipeItemId];
                if (recipeInfo?.limitedStock && recipeInfo?.bop) {
                    return false;
                }
            }
            
            return true;
        });

        if (validRecipes.length === 0) continue;

        // Calculate cost per skill-up for all valid recipes
        // PHASE 1: Calculate material costs only for initial selection
        const recipeCosts = validRecipes.map(recipe => {
            const chance = expectedSkillUps(recipe, currentSkill - 1);
            if (chance <= 0) {
                return {
                    recipe,
                    materialCostPerSkillUp: Infinity,
                    recipeCostValue: 0,
                    baseCost: 0
                };
            }
            
            // Material cost only (for selection)
            const materialCostPerCraft = craftCost(recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
            const materialCostPerSkillUp = materialCostPerCraft / chance;
            
            // Recipe cost (for later comparison)
            let recipeCostValue = 0;
            if (includeRecipeCost && recipe.source) {
                const recipeCostData = getRecipeCost(recipe, prices, materialInfo, useMarketValue);
                if (recipeCostData.isLimitedStock && recipeCostData.ahPrice !== null) {
                    recipeCostValue = recipeCostData.ahPrice;
                } else if (recipeCostData.vendorPrice !== null || recipeCostData.ahPrice !== null) {
                    recipeCostValue = recipeCostData.ahPrice ?? recipeCostData.vendorPrice ?? 0;
                }
            }
            
            return {
                recipe,
                materialCostPerSkillUp,
                recipeCostValue,
                baseCost: materialCostPerCraft
            };
        }).filter(r => isFinite(r.materialCostPerSkillUp));

        if (recipeCosts.length === 0) continue;

        // Find cheapest recipe based on material costs only
        recipeCosts.sort((a, b) => a.materialCostPerSkillUp - b.materialCostPerSkillUp);
        const cheapestRecipe = recipeCosts[0];
        const cheapestMaterialCost = cheapestRecipe.materialCostPerSkillUp;

        // Find chain recipes (produce items on shopping list) within 20% threshold
        const chainRecipes = recipeCosts.filter(r => {
            const producesId = recipeProduces.get(r.recipe.id);
            if (!producesId) return false;
            
            const needed = currentState.shoppingList.get(producesId) || 0;
            if (needed <= 0) return false;
            
            // Within 20% threshold (based on material costs)
            return r.materialCostPerSkillUp <= cheapestMaterialCost * 1.2;
        });

        // PHASE 1: Select recipe based on material costs only
        let selectedRecipeData = chainRecipes.length > 0 
            ? chainRecipes[0]  // Cheapest chain recipe
            : cheapestRecipe;   // Cheapest overall

        // PHASE 2: Check if we should switch to an alternative based on total cost
        // This happens when the current recipe is ending or better alternatives exist
        const selectedRecipe = selectedRecipeData.recipe;
        const selectedGray = selectedRecipe.difficulty.gray ?? Infinity;
        
        // Check if recipe is becoming suboptimal
        const isNearGray = currentSkill - 1 >= selectedGray - 1; // At or near gray
        const hasBetterMaterialCost = recipeCosts.length > 1 && recipeCosts[0].recipe.id !== selectedRecipe.id;
        
        // Check if we're currently using a recipe (look at previous step)
        const currentRecipeInUse = currentState.steps.length > 0 && 
            'recipe' in currentState.steps[0] && 
            currentState.steps[0].recipe?.id === selectedRecipe.id;
        
        // Estimate how many skill-ups this recipe will be used for
        // If already in use, estimate remaining usage; otherwise estimate full usage
        let estimatedSkillUpsUsed = 1; // Default to 1 for single-level
        if (currentRecipeInUse) {
            // Recipe already in use - estimate remaining skill-ups until gray
            estimatedSkillUpsUsed = Math.max(1, selectedGray - (currentSkill - 1));
        } else {
            // New recipe - estimate usage from current skill to gray
            estimatedSkillUpsUsed = Math.max(1, selectedGray - (currentSkill - 1));
        }
        
        // If recipe is ending or alternatives exist, compare total costs
        if ((isNearGray || hasBetterMaterialCost || !currentRecipeInUse) && recipeCosts.length > 1) {
            // Calculate total cost for selected recipe (materials + amortized recipe cost)
            const selectedMaterialCostPerSkillUp = selectedRecipeData.materialCostPerSkillUp;
            const selectedRecipeCostAmortized = selectedRecipeData.recipeCostValue / estimatedSkillUpsUsed;
            const selectedTotalCostPerSkillUp = selectedMaterialCostPerSkillUp + selectedRecipeCostAmortized;
            
            // Compare with top alternatives: top 3 by material cost + free recipes (can be cheaper overall)
            const topByMaterial = recipeCosts.slice(0, Math.min(3, recipeCosts.length));
            const freeRecipes = recipeCosts.filter(r => r.recipeCostValue === 0 && !topByMaterial.some(t => t.recipe.id === r.recipe.id));
            const alternativesToConsider = [...topByMaterial, ...freeRecipes]
                .filter(r => r.recipe.id !== selectedRecipe.id)
                .map(alt => {
                    const altGray = alt.recipe.difficulty.gray ?? Infinity;
                    const altEstimatedSkillUps = Math.max(1, altGray - (currentSkill - 1));
                    const altMaterialCostPerSkillUp = alt.materialCostPerSkillUp;
                    const altRecipeCostAmortized = alt.recipeCostValue / altEstimatedSkillUps;
                    const altTotalCostPerSkillUp = altMaterialCostPerSkillUp + altRecipeCostAmortized;
                    
                    return {
                        ...alt,
                        totalCostPerSkillUp: altTotalCostPerSkillUp,
                        savings: selectedTotalCostPerSkillUp - altTotalCostPerSkillUp
                    };
                });
            
            // Find cheapest alternative including recipe costs
            alternativesToConsider.sort((a, b) => a.totalCostPerSkillUp - b.totalCostPerSkillUp);
            const cheapestAlternative = alternativesToConsider[0];
            
            // Switch if alternative is cheaper overall
            if (cheapestAlternative && cheapestAlternative.totalCostPerSkillUp < selectedTotalCostPerSkillUp) {
                selectedRecipeData = cheapestAlternative;
            }
        }
        const chance = expectedSkillUps(selectedRecipe, currentSkill - 1);
            const crafts = Math.ceil(1 / chance);
        const materialCostPerCraft = craftCost(selectedRecipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
        const materialCost = materialCostPerCraft * crafts;
        const recipeCost = includeRecipeCost ? 
            craftCost(selectedRecipe, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession) : 0;
        // Store material cost in step.cost, recipe cost separately
        const totalStepCost = materialCost;

        // Create new state
        const newShoppingList = new Map(currentState.shoppingList);
        
        // Add selected recipe's materials to shopping list
        for (const [matId, qty] of Object.entries(selectedRecipe.materials)) {
            const itemId = Number(matId);
            const needed = qty * crafts;
            const current = newShoppingList.get(itemId) || 0;
            newShoppingList.set(itemId, current + needed);
        }
        
        // Consume produced material from shopping list
        const producesId = recipeProduces.get(selectedRecipe.id);
        if (producesId) {
            const produced = crafts * 1; // Always 1 per craft
            const current = newShoppingList.get(producesId) || 0;
            newShoppingList.set(producesId, Math.max(0, current - produced));
        }

        const newState: BackwardDPState = {
            steps: [{
                recipe: selectedRecipe,
                crafts,
                cost: materialCost,  // Material cost only
                recipeCost: recipeCost > 0 ? recipeCost : undefined,  // Recipe cost separately
                endSkill: currentSkill,
            }, ...currentState.steps],
            totalCost: currentState.totalCost + materialCost + recipeCost,  // Include recipe cost in total
            startSkill: currentSkill - 1,
            shoppingList: newShoppingList
        };

        // Update DP table (keep best state at each skill level)
        if (!dp[currentSkill - 1] || newState.totalCost < dp[currentSkill - 1].totalCost) {
            dp[currentSkill - 1] = newState;
        }
    }
    } else {
        // New behavior: work in 5-skill batches
        // Process batches backwards, handling rods when we encounter them (same as per-level logic)
        // Track which skill levels we've processed to avoid reprocessing
        const processedSkills = new Set<number>();
        
        // Keep processing until we've covered all skill levels
        const maxIterations = 1000; // Safety limit
        let iteration = 0;
        
        while (iteration < maxIterations) {
            iteration++;
            
            // Find the highest skill level we have a state for that hasn't been processed
            const allStates = Object.keys(dp).map(Number).filter(s => s >= startSkill && s <= target);
            const availableSkills = allStates
                .filter(s => !processedSkills.has(s))
                .sort((a, b) => b - a); // Sort descending
            
            if (availableSkills.length === 0) {
                break;
            }
            
            const batchEnd = availableSkills[0]; // Process highest unprocessed skill
            
            // Calculate batchStart to ensure we cover exactly 5 levels (or remaining levels)
            // For a batch ending at batchEnd, we want to start 5 levels earlier
            // Example: batchEnd=125 means batchStart=120 (covering 120-124 to reach 125)
            // But if startSkill is higher, use that instead
            const idealBatchStart = batchEnd - 4;
            const batchStart = Math.max(startSkill, idealBatchStart);
            const currentState = dp[batchEnd];
            
            if (!currentState) {
                processedSkills.add(batchEnd); // Mark as processed even if skipped
                continue;
            }

            // Find all valid recipes for this batch
            // Exclude rods - they are handled separately (ALWAYS exclude, regardless of profession check)
            const validRecipes = recipes.filter(r => {
                // ALWAYS exclude rods - they are handled separately
                if (ENCHANTING_ROD_SPELL_IDS.has(r.id)) {
                    return false;
                }

                const chance = expectedSkillUps(r, batchEnd - 1);
                if (getEffectiveMinSkill(r) > batchStart || 
                    chance <= 0 || 
                    blacklistedSpellIds.has(r.id)) {
                    return false;
                }

                // In profit modes: hard cut-off below 10% to prevent "use until exhaustion"
                if (priceSourcing !== 'cost' && chance < MIN_SKILL_UP_CHANCE_PROFIT_MODE) {
                    return false;
                }

                // In auction-house mode: exclude recipes whose output has < 4 auctions (unreliable price data)
                if (priceSourcing === 'auction-house' && r.produces?.id) {
                    const numAuctions = prices[r.produces.id]?.numAuctions ?? 0;
                    if (numAuctions < MIN_NUM_AUCTIONS_AH_MODE) return false;

                    // Exclude recipes whose output has very low soldPerDay (illiquid, unreliable region data)
                    // Only reject when we have data; items not in region map are allowed (no liquidity data)
                    if (regionSoldPerDay) {
                        const soldPerDay = regionSoldPerDay.get(r.produces.id);
                        if (soldPerDay !== undefined && soldPerDay < getMinSoldPerDayForProfession(profession)) return false;
                    }

                    // Exclude recipes with > 500% profit margin (likely outlier data)
                    const materialCost = craftCost(r, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, 'cost', profession);
                    const priceData = prices[r.produces.id];
                    const ahPricePerItem = useMarketValue
                        ? (priceData?.marketValue ?? priceData?.minBuyout ?? 0)
                        : (priceData?.minBuyout ?? priceData?.marketValue ?? 0);
                    const ahRevenue = ahPricePerItem * (r.produces.quantity ?? 1);
                    if (materialCost > 0 && (ahRevenue - materialCost) / materialCost > MAX_PROFIT_MARGIN_AH_MODE) return false;
                    if (materialCost <= 0 && ahRevenue > 0) return false; // infinite profit = outlier
                }

                // Skip recipes with no recipe cost (unavailable BoP seasonal recipes)
                if (r.source) {
                    const recipeCostData = getRecipeCost(r, prices, materialInfo, useMarketValue);
                    // If both vendorPrice and ahPrice are null, recipe is unavailable
                    if (recipeCostData.vendorPrice === null && recipeCostData.ahPrice === null) {
                        return false;
                    }
                }

                // Skip limited stock BoP recipes if enabled (can't be acquired reliably)
                // Limited stock recipes that aren't BoP are allowed (can use AH price)
                if (skipLimitedStock && r.source?.type === 'item' && r.source.recipeItemId) {
                    const recipeInfo = materialInfo[r.source.recipeItemId];
                    if (recipeInfo?.limitedStock && recipeInfo?.bop) {
                        return false;
                    }
                }
                
                return true;
            });

            if (validRecipes.length === 0) {
                processedSkills.add(batchEnd); // Mark as processed even if no recipes
                continue;
            }

            // Calculate cost per skill-up for all valid recipes
            // PHASE 1: Calculate material costs only for initial selection
            const totalSkillUps = batchEnd - batchStart;
            const recipeCosts = validRecipes.map(recipe => {
                // Calculate total crafts needed for the batch using expectedCraftsBetween
                const crafts = expectedCraftsBetween(batchStart, batchEnd, recipe.difficulty);
                
                if (!isFinite(crafts) || crafts <= 0) {
                    return {
                        recipe,
                        materialCostPerSkillUp: Infinity,
                        recipeCostValue: 0,
                        baseCost: 0,
                        crafts: 0
                    };
                }
                
                // Material cost only (for selection)
                const materialCostPerCraft = craftCost(recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
                const totalMaterialCost = materialCostPerCraft * crafts;
                const materialCostPerSkillUp = totalMaterialCost / totalSkillUps;
                
                // Recipe cost (for later comparison)
                let recipeCostValue = 0;
                if (includeRecipeCost && recipe.source) {
                    const recipeCostData = getRecipeCost(recipe, prices, materialInfo, useMarketValue);
                    if (recipeCostData.isLimitedStock && recipeCostData.ahPrice !== null) {
                        recipeCostValue = recipeCostData.ahPrice;
                    } else if (recipeCostData.vendorPrice !== null || recipeCostData.ahPrice !== null) {
                        recipeCostValue = recipeCostData.ahPrice ?? recipeCostData.vendorPrice ?? 0;
                    }
                }
                
                return {
                    recipe,
                    materialCostPerSkillUp: isFinite(materialCostPerSkillUp) ? materialCostPerSkillUp : Infinity,
                    recipeCostValue,
                    baseCost: materialCostPerCraft,
                    crafts
                };
            }).filter(r => isFinite(r.materialCostPerSkillUp));

            if (recipeCosts.length === 0) continue;

            // Find cheapest recipe based on material costs only
            recipeCosts.sort((a, b) => a.materialCostPerSkillUp - b.materialCostPerSkillUp);
            const cheapestRecipe = recipeCosts[0];
            const cheapestMaterialCost = cheapestRecipe.materialCostPerSkillUp;

            // Find chain recipes (produce items on shopping list) within 20% threshold
            const chainRecipes = recipeCosts.filter(r => {
                const producesId = recipeProduces.get(r.recipe.id);
                if (!producesId) return false;
                
                const needed = currentState.shoppingList.get(producesId) || 0;
                if (needed <= 0) return false;
                
                // Within 20% threshold (based on material costs)
                return r.materialCostPerSkillUp <= cheapestMaterialCost * 1.2;
            });

            // PHASE 1: Select recipe based on material costs only
            let selectedRecipeData = chainRecipes.length > 0 
                ? chainRecipes[0]
                : cheapestRecipe;

            // PHASE 2: Check if we should switch to an alternative based on total cost
            let selectedRecipe = selectedRecipeData.recipe;
            const selectedGray = selectedRecipe.difficulty.gray ?? Infinity;
            
            // Check if recipe is becoming suboptimal
            const isNearGray = batchEnd >= selectedGray - 1; // Batch reaches near gray
            const hasBetterMaterialCost = recipeCosts.length > 1 && recipeCosts[0].recipe.id !== selectedRecipe.id;
            
            // Check if we're currently using a recipe (look at previous step)
            const currentRecipeInUse = currentState.steps.length > 0 && 
                'recipe' in currentState.steps[0] && 
                currentState.steps[0].recipe?.id === selectedRecipe.id;
            
            // Estimate how many skill-ups this recipe will be used for
            let estimatedSkillUpsUsed = totalSkillUps; // Default to batch size
            if (currentRecipeInUse) {
                // Recipe already in use - estimate remaining skill-ups until gray
                estimatedSkillUpsUsed = Math.max(totalSkillUps, selectedGray - batchStart);
            } else {
                // New recipe - estimate usage from batch start to gray
                estimatedSkillUpsUsed = Math.max(totalSkillUps, selectedGray - batchStart);
            }
            
            // If recipe is ending or alternatives exist, compare total costs
            if ((isNearGray || hasBetterMaterialCost || !currentRecipeInUse) && recipeCosts.length > 1) {
                // Calculate total cost for selected recipe (materials + amortized recipe cost)
                const selectedMaterialCostPerSkillUp = selectedRecipeData.materialCostPerSkillUp;
                const selectedRecipeCostAmortized = selectedRecipeData.recipeCostValue / estimatedSkillUpsUsed;
                const selectedTotalCostPerSkillUp = selectedMaterialCostPerSkillUp + selectedRecipeCostAmortized;
                
                // Compare with top alternatives: top 3 by material cost + free recipes (can be cheaper overall)
                const topByMaterial = recipeCosts.slice(0, Math.min(3, recipeCosts.length));
                const freeRecipes = recipeCosts.filter(r => r.recipeCostValue === 0 && !topByMaterial.some(t => t.recipe.id === r.recipe.id));
                const alternativesToConsider = [...topByMaterial, ...freeRecipes]
                    .filter(r => r.recipe.id !== selectedRecipe.id)
                    .map(alt => {
                        const altGray = alt.recipe.difficulty.gray ?? Infinity;
                        const altEstimatedSkillUps = Math.max(totalSkillUps, altGray - batchStart);
                        const altMaterialCostPerSkillUp = alt.materialCostPerSkillUp;
                        const altRecipeCostAmortized = alt.recipeCostValue / altEstimatedSkillUps;
                        const altTotalCostPerSkillUp = altMaterialCostPerSkillUp + altRecipeCostAmortized;
                        
                        return {
                            ...alt,
                            totalCostPerSkillUp: altTotalCostPerSkillUp,
                            savings: selectedTotalCostPerSkillUp - altTotalCostPerSkillUp
                        };
                    });
                
                // Find cheapest alternative including recipe costs
                alternativesToConsider.sort((a, b) => a.totalCostPerSkillUp - b.totalCostPerSkillUp);
                const cheapestAlternative = alternativesToConsider[0];
                
                // Switch if alternative is cheaper overall
                if (cheapestAlternative && cheapestAlternative.totalCostPerSkillUp < selectedTotalCostPerSkillUp) {
                    selectedRecipeData = cheapestAlternative;
                    selectedRecipe = selectedRecipeData.recipe;
                }
            }

            // Check if a rod falls within this batch (AFTER selecting the optimal recipe)
            let rod: Recipe | undefined;
            if (rodRecipes.length && profession === "Enchanting") {
                // Check if rod falls within batch range (inclusive on both ends)
                rod = rodRecipes.find(r => getEffectiveMinSkill(r) >= batchStart && getEffectiveMinSkill(r) <= batchEnd);
                
                // Special case: if batchStart is 1 (first batch), ensure we catch Runed Copper Rod at level 1
                // This handles edge cases where batchEnd might be less than expected
                if (!rod && batchStart === 1) {
                    rod = rodRecipes.find(r => getEffectiveMinSkill(r) === 1);
                }
            }
            
            // Calculate crafts needed for the batch, split by rod if present
            // If rod exists, we need:
            // 1. Crafts from batchStart to rod effective minSkill (exclusive)
            // 2. Rod step at rod effective minSkill
            // 3. Crafts from endSkillAfterRod to batchEnd (if endSkillAfterRod < batchEnd)
            
            let craftsBeforeRod = 0;
            let craftsAfterRod = 0;
            const rodMinSkill = rod ? getEffectiveMinSkill(rod) : 0;
            
            if (rod) {
                // Calculate crafts before rod using sum-of-reciprocals
                const skillUpsBeforeRod = rodMinSkill - batchStart;
                if (skillUpsBeforeRod > 0) {
                    let sumOfReciprocals = 0;
                    for (let lvl = batchStart; lvl < rodMinSkill; lvl++) {
                        const chance = expectedSkillUps(selectedRecipe, lvl);
                        if (chance > 0) {
                            sumOfReciprocals += 1 / chance;
                        } else {
                            craftsBeforeRod = Infinity;
                            break;
                        }
                    }
                    if (craftsBeforeRod !== Infinity) {
                        craftsBeforeRod = Math.ceil(sumOfReciprocals);
                    }
                }
                
                // Calculate skill-ups from rod and end skill after rod
                const skillUpsFromRod = Math.floor(expectedSkillUps(rod, rodMinSkill));
                const endSkillAfterRod = rodMinSkill + skillUpsFromRod;
                
                // Calculate crafts after rod using sum-of-reciprocals (if needed)
                if (endSkillAfterRod < batchEnd) {
                    let sumOfReciprocals = 0;
                    for (let lvl = endSkillAfterRod; lvl < batchEnd; lvl++) {
                        const chance = expectedSkillUps(selectedRecipe, lvl);
                        if (chance > 0) {
                            sumOfReciprocals += 1 / chance;
                        } else {
                            craftsAfterRod = Infinity;
                            break;
                        }
                    }
                    if (craftsAfterRod !== Infinity) {
                        craftsAfterRod = Math.ceil(sumOfReciprocals);
                    }
                }
            } else {
                // No rod, calculate crafts for entire batch using sum-of-reciprocals
                const totalSkillUps = batchEnd - batchStart;
                if (totalSkillUps > 0) {
                    let sumOfReciprocals = 0;
                    for (let lvl = batchStart; lvl < batchEnd; lvl++) {
                        const chance = expectedSkillUps(selectedRecipe, lvl);
                        if (chance > 0) {
                            sumOfReciprocals += 1 / chance;
                        } else {
                            craftsBeforeRod = Infinity;
                            break;
                        }
                    }
                    if (craftsBeforeRod !== Infinity) {
                        craftsBeforeRod = Math.ceil(sumOfReciprocals);
                    }
                }
            }

            const materialCostPerCraft = craftCost(selectedRecipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
            const recipeCost = includeRecipeCost ? 
                craftCost(selectedRecipe, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession) : 0;

            // Create new state
            const newShoppingList = new Map(currentState.shoppingList);
            const steps: DPStep[] = [];
            
            // If rod exists in this batch, add rod step and regular recipe steps
            if (rod) {
                const rodMaterialCost = craftCost(rod, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
                const rodRecipeCost = includeRecipeCost ? 
                    craftCost(rod, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession) : 0;
                
                // Calculate skill-ups from rod
                const skillUpsFromRod = Math.floor(expectedSkillUps(rod, rodMinSkill));
                const endSkillAfterRod = rodMinSkill + skillUpsFromRod;
                
                // Add recipe step for levels before rod (if any)
                if (craftsBeforeRod > 0) {
                    const beforeRodCost = materialCostPerCraft * craftsBeforeRod;
                    steps.push({
                        recipe: selectedRecipe,
                        crafts: craftsBeforeRod,
                        cost: beforeRodCost,
                        recipeCost: recipeCost > 0 ? recipeCost : undefined,
                        endSkill: rodMinSkill,
                    });
                    
                    // Add materials for before-rod crafts
                    for (const [matId, qty] of Object.entries(selectedRecipe.materials)) {
                        const itemId = Number(matId);
                        const needed = qty * craftsBeforeRod;
                        const current = newShoppingList.get(itemId) || 0;
                        newShoppingList.set(itemId, current + needed);
                    }
                    
                    // Consume produced material
                    const producesId = recipeProduces.get(selectedRecipe.id);
                    if (producesId) {
                        const produced = craftsBeforeRod * 1;
                        const current = newShoppingList.get(producesId) || 0;
                        newShoppingList.set(producesId, Math.max(0, current - produced));
                    }
                }
                
                // Add rod step
                steps.push({
                    recipe: rod,
                        crafts: 1,
                        cost: rodMaterialCost,
                        recipeCost: rodRecipeCost > 0 ? rodRecipeCost : undefined,
                    endSkill: endSkillAfterRod,
                        note: "Required enchanting rod"
                });
                
                // Add rod materials to shopping list (exclude rod products - made in previous rod step)
                for (const [matId, qty] of Object.entries(rod.materials)) {
                    const itemId = Number(matId);
                    if (ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(itemId)) continue;
                    const current = newShoppingList.get(itemId) || 0;
                    newShoppingList.set(itemId, current + qty);
                }
                
                // Consume produced material if rod produces something
                const producesId = recipeProduces.get(rod.id);
                if (producesId) {
                    const current = newShoppingList.get(producesId) || 0;
                    newShoppingList.set(producesId, Math.max(0, current - 1));
                }
                
                // Add recipe step for levels after rod (if any)
                if (craftsAfterRod > 0) {
                    const afterRodCost = materialCostPerCraft * craftsAfterRod;
                    steps.push({
                        recipe: selectedRecipe,
                        crafts: craftsAfterRod,
                        cost: afterRodCost,
                        recipeCost: undefined, // Recipe cost already included in first step
                        endSkill: batchEnd,
                    });
                    
                    // Add materials for after-rod crafts
                    for (const [matId, qty] of Object.entries(selectedRecipe.materials)) {
                        const itemId = Number(matId);
                        const needed = qty * craftsAfterRod;
                        const current = newShoppingList.get(itemId) || 0;
                        newShoppingList.set(itemId, current + needed);
                    }
                    
                    // Consume produced material
                    const producesId = recipeProduces.get(selectedRecipe.id);
                    if (producesId) {
                        const produced = craftsAfterRod * 1;
                        const current = newShoppingList.get(producesId) || 0;
                        newShoppingList.set(producesId, Math.max(0, current - produced));
                    }
                }
            } else {
                // No rod, add single recipe step for entire batch
                const totalCrafts = craftsBeforeRod;
                const materialCost = materialCostPerCraft * totalCrafts;
                
                if (totalCrafts > 0) {
                    steps.push({
                        recipe: selectedRecipe,
                        crafts: totalCrafts,
                        cost: materialCost,
                        recipeCost: recipeCost > 0 ? recipeCost : undefined,
                        endSkill: batchEnd,
                    });
                    
                    // Add selected recipe's materials to shopping list
                    for (const [matId, qty] of Object.entries(selectedRecipe.materials)) {
                        const itemId = Number(matId);
                        const needed = qty * totalCrafts;
                        const current = newShoppingList.get(itemId) || 0;
                        newShoppingList.set(itemId, current + needed);
                    }
                    
                    // Consume produced material from shopping list
                    const producesId = recipeProduces.get(selectedRecipe.id);
                    if (producesId) {
                        const produced = totalCrafts * 1;
                        const current = newShoppingList.get(producesId) || 0;
                        newShoppingList.set(producesId, Math.max(0, current - produced));
                    }
                }
            }

            const totalStepCost = steps.reduce((sum, step) => sum + step.cost + (step.recipeCost || 0), 0);
            const newState: BackwardDPState = {
                steps: [...steps, ...currentState.steps],
                totalCost: currentState.totalCost + totalStepCost,
                startSkill: batchStart - 1,
                shoppingList: newShoppingList
            };

            // Update DP table
            const existingState = dp[batchStart - 1];
            if (!existingState || newState.totalCost < existingState.totalCost) {
                dp[batchStart - 1] = newState;
            }
            
            // Mark batchEnd as processed after successfully processing the batch
            processedSkills.add(batchEnd);
        }
        
        if (iteration >= maxIterations) {
            console.warn(`Reached max iterations (${maxIterations}), may not have processed all batches`);
        }
    }


    // Find the best state at startSkill
    let bestState = dp[startSkill];
    if (!bestState) {
        // Special case: if startSkill = 1, also check skill 0 (since batch 1-5 stores state at skill 0)
        if (startSkill === 1 && dp[0]) {
            bestState = dp[0];
        } else {
            // If we didn't reach the target skill, find the closest state
            const availableSkills = Object.keys(dp).map(Number).filter(s => s >= startSkill);
            if (availableSkills.length > 0) {
                const closestSkill = Math.min(...availableSkills);
                bestState = dp[closestSkill];
            }
        }
    }

    if (!bestState) {
        return { steps: [], totalCost: 0, finalSkill: skill };
    }

    // Convert to PlanStep format
    const planSteps: PlanStep[] = bestState.steps.map(step => {
        if ('recipe' in step && step.recipe && typeof step.crafts === 'number') {
            return {
                recipe: step.recipe,
                crafts: step.crafts,
                cost: step.cost,  // Material cost only
                recipeCost: step.recipeCost,  // Recipe cost separately
                endSkill: step.endSkill,
                note: step.note
            };
        }
        throw new Error('Invalid step type');
    });

    // Merge consecutive steps with same recipe and recalculate crafts to avoid rounding errors
    const mergedSteps: PlanStep[] = [];
    let currentStep: PlanStep | null = null;
    let currentStartSkill: number = startSkill; // Track start skill for current merged step

    for (const step of planSteps) {
        if ('recipe' in step) {
            if (currentStep && 'recipe' in currentStep && currentStep.recipe.id === step.recipe.id) {
                // Merge with current step - recalculate crafts for the combined range
                // This avoids accumulating rounding errors from individual batch calculations
                const combinedEndSkill = step.endSkill;
                const totalSkillUps = combinedEndSkill - currentStartSkill;
                
                // Recalculate crafts for the entire combined range using sum-of-reciprocals
                let sumOfReciprocals = 0;
                for (let lvl = currentStartSkill; lvl < combinedEndSkill; lvl++) {
                    const chance = expectedSkillUps(currentStep.recipe, lvl);
                    if (chance > 0) {
                        sumOfReciprocals += 1 / chance;
                    } else {
                        // If we hit a level with 0% chance, can't merge - push current and start new
                        mergedSteps.push(currentStep);
                        currentStep = { ...step };
                        // Infer start skill from previous step's endSkill
                        currentStartSkill = mergedSteps.length > 0 && 'endSkill' in mergedSteps[mergedSteps.length - 1]
                            ? mergedSteps[mergedSteps.length - 1].endSkill
                            : startSkill;
                        continue;
                    }
                }
                
                // Recalculate crafts and cost for combined range
                const recalculatedCrafts = Math.ceil(sumOfReciprocals);
                const materialCostPerCraft = craftCost(currentStep.recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession);
                const recalculatedCost = recalculatedCrafts !== Infinity ? materialCostPerCraft * recalculatedCrafts : Infinity;
                
                // Update current step with recalculated values
                currentStep.crafts = recalculatedCrafts;
                currentStep.cost = recalculatedCost;
                currentStep.endSkill = combinedEndSkill;
                // Recipe cost: only add if this step has recipe cost and current doesn't
                if (step.recipeCost && !currentStep.recipeCost) {
                    currentStep.recipeCost = step.recipeCost;
                }
            } else {
                // Start new step
                if (currentStep) {
                    mergedSteps.push(currentStep);
                }
                currentStep = { ...step };
                // Infer start skill from previous step's endSkill (or use startSkill if first step)
                if (mergedSteps.length > 0) {
                    const lastStep = mergedSteps[mergedSteps.length - 1];
                    currentStartSkill = 'endSkill' in lastStep ? lastStep.endSkill : startSkill;
                } else {
                    currentStartSkill = startSkill;
                }
            }
        } else {
            // Non-recipe step (e.g. upgrade) - push as-is
            if (currentStep) {
                mergedSteps.push(currentStep);
                currentStep = null;
            }
            mergedSteps.push(step);
            currentStartSkill = step.endSkill;
        }
    }

    // Add the last step if it exists
    if (currentStep) {
        mergedSteps.push(currentStep);
    }

    const totalCost = mergedSteps.reduce((sum, step) => {
        if ('cost' in step) {
            const materialCost = step.cost;
            const recipeCost = 'recipeCost' in step ? (step.recipeCost || 0) : 0;
            return sum + materialCost + recipeCost;
        }
        return sum;
    }, 0);

    return {
        steps: mergedSteps,
        totalCost,
        finalSkill: bestState.startSkill === startSkill ? target : bestState.startSkill
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