import { Recipe, PriceMap, MaterialInfo, MaterialTreeNode } from "./types";
import { ENCHANTING_ROD_SPELL_IDS, ENCHANTING_ROD_PRODUCT_ITEM_IDS } from "./rodConstants";


function getAverageOutput(minCount?: number, maxCount?: number): number {
  const min = (minCount ?? 0) + 1;
  const max = (maxCount ?? 0) + 1;
  return (min + max) / 2 || 1;
}

/** Calculate the cost of acquiring a recipe */
export function getRecipeCost(
  recipe: Recipe,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  useMarketValue: boolean = false
): {
  vendorPrice: number | null;
  ahPrice: number | null;
  isLimitedStock: boolean;
  type: 'free' | 'trainer' | 'item';
} {
  // Handle free recipes (including those with no source)
  if (!recipe.source || recipe.source.type === 'free') {
    return {
      vendorPrice: 0,  // Free recipes should cost 0, not null
      ahPrice: null,
      isLimitedStock: false,
      type: 'free'
    };
  }
  
  // Handle trainer recipes
  if (recipe.source.type === 'trainer') {
    return {
      vendorPrice: Math.max(0, recipe.source.cost ?? 0),
      ahPrice: null,
      isLimitedStock: false,
      type: 'trainer'
    };
  } 
  
  // Handle item-based recipes
  if (recipe.source.type === 'item' && recipe.source.recipeItemId) {
    const recipeItemId = recipe.source.recipeItemId;
    const override = RECIPE_COST_MATERIAL_OVERRIDES[recipeItemId];
    if (override) {
      // Cost is paid in materials (e.g. Thorium Brotherhood turn-in)
      const materialCost = getItemCost(
        override.materialId,
        prices,
        materialInfo,
        new Map(),
        false,
        useMarketValue,
        true
      );
      const totalCost = override.quantity * materialCost;
      return {
        vendorPrice: totalCost < Infinity ? totalCost : null,
        ahPrice: null,
        isLimitedStock: false,
        type: 'item'
      };
    }

    const recipeInfo = materialInfo[recipeItemId];
    const priceData = prices[recipeItemId];
    
    // Vendor price takes precedence: BoP items sold by vendors (e.g. faction vendors) have a buyPrice
    const vendorPrice = recipeInfo?.buyPrice != null && recipeInfo.buyPrice > 0
      ? recipeInfo.buyPrice
      : null;
    
    // Get AH price from either minBuyout or marketValue based on toggle
    const minBuyout = priceData?.minBuyout ?? 0;
    const marketValue = priceData?.marketValue ?? 0;
    const ahPrice = useMarketValue ?
      (marketValue > 0 ? marketValue : (minBuyout > 0 ? minBuyout : null)) :
      (minBuyout > 0 ? minBuyout : (marketValue > 0 ? marketValue : null));
    
    // If we have vendor or AH price, use it (vendor takes precedence for BoP items sold by vendors)
    if (vendorPrice != null || ahPrice != null) {
      return {
        vendorPrice,
        ahPrice,
        isLimitedStock: recipeInfo?.limitedStock ?? false,
        type: 'item'
      };
    }
    
    // No vendor/AH price: BoP drops or missing recipeInfo → treat as free
    if (recipeInfo?.bop || !recipeInfo) {
      return {
        vendorPrice: 0,
        ahPrice: null,
        isLimitedStock: false,
        type: 'item'
      };
    }
    
    return {
      vendorPrice: null,
      ahPrice: null,
      isLimitedStock: recipeInfo?.limitedStock ?? false,
      type: 'item'
    };
  }

  // Fallback case (should never happen with valid data)
  return {
    vendorPrice: null,
    ahPrice: null,
    isLimitedStock: false,
    type: 'free'
  };
}

/** Total copper cost to craft the recipe once */
export function craftCost(
  recipe: Recipe,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  includeRecipeCost: boolean = false,
  recipeOnly: boolean = false,
  useMarketValue: boolean = false,
  allowSubCrafting: boolean = true,
  currentProfessionRecipeIds?: Set<number>
): number {
  // If we only want the recipe cost
  if (recipeOnly) {
    const recipeCost = getRecipeCost(recipe, prices, materialInfo, useMarketValue);
    // For recipe-only cost, prefer AH price for limited stock items
    if (recipeCost.isLimitedStock && recipeCost.ahPrice !== null) {
      return recipeCost.ahPrice;
    }
    // If neither vendor nor AH price exists, the recipe is unavailable
    if (recipeCost.vendorPrice === null && recipeCost.ahPrice === null) {
      return Infinity;
    }
    return recipeCost.vendorPrice ?? recipeCost.ahPrice ?? Infinity;
  }

  // Calculate base material costs
  const baseCost = Object.entries(recipe.materials).reduce((sum, [id, qty]) => {
    const itemId = parseInt(id);
    const matInfo = materialInfo[itemId];

    // For rod recipes: exclude rod products (e.g. Runed Truesilver Rod when making Runed Arcanite Rod)
    // They're made in the previous rod step, not bought
    if (ENCHANTING_ROD_SPELL_IDS.has(recipe.id) && ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(itemId)) {
      return sum;
    }

    // Use getItemCost which handles sub-crafting optimization
    const itemCost = getItemCost(itemId, prices, materialInfo, new Map(), false, useMarketValue, allowSubCrafting, currentProfessionRecipeIds);

    // For enchanting rods, include their recipe cost (always allow crafting rods)
    // Only for non-rod materials (rod products are excluded above)
    if (matInfo?.createdBy && ENCHANTING_ROD_SPELL_IDS.has(recipe.id)) {
      const rodRecipe = {
        id: matInfo.createdBy?.spellId ?? 0,
        name: matInfo.createdBy?.spellName ?? `Unknown Rod Recipe`,
        materials: matInfo.createdBy.reagents,
        source: { type: 'trainer' as const, cost: 0 },
        quality: 1,
        minSkill: 0,
        difficulty: { orange: 0, yellow: 0, green: 0, gray: 0 },
        icon: matInfo.icon || ''
      };
      const rodCraftCost = craftCost(rodRecipe, prices, materialInfo, true, false, useMarketValue, true, currentProfessionRecipeIds);
      return sum + (Math.min(itemCost, rodCraftCost) * qty);
    }

    return sum + (itemCost * qty);
  }, 0);

  // Add recipe cost if requested
  if (includeRecipeCost) {
    const recipeCost = getRecipeCost(recipe, prices, materialInfo, useMarketValue);
    // For recipe cost, prefer AH price for limited stock items
    let recipePrice;
    if (recipeCost.isLimitedStock && recipeCost.ahPrice !== null) {
      recipePrice = recipeCost.ahPrice;
    } else if (recipeCost.vendorPrice === null && recipeCost.ahPrice === null) {
      // If recipe is completely unavailable, the craft is impossible
      return Infinity;
    } else {
      recipePrice = recipeCost.vendorPrice ?? recipeCost.ahPrice ?? Infinity;
    }
    return baseCost + recipePrice;
  }

  return baseCost;
}

export function costPerSkillUp(
  r: Recipe,
  currentSkill: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  includeRecipeCost: boolean = false,
  useMarketValue: boolean = false,
  allowSubCrafting: boolean = true,
  currentProfessionRecipeIds?: Set<number>
): {
  cost: number;
  isLimitedStock?: boolean;
  vendorPrice?: number;
  ahPrice?: number;
} {
  const chance = expectedSkillUps(r, currentSkill);
  if (chance <= 0) {
    return { cost: Infinity };
  }

  const baseCost = craftCost(r, prices, materialInfo, includeRecipeCost, false, useMarketValue, allowSubCrafting, currentProfessionRecipeIds);
  const recipeCost = getRecipeCost(r, prices, materialInfo, useMarketValue);

  return {
    cost: baseCost / chance,
    isLimitedStock: recipeCost.isLimitedStock,
    vendorPrice: recipeCost.vendorPrice ?? undefined,
    ahPrice: recipeCost.ahPrice ?? undefined
  };
}

export const skipCraftingUnlessTopLevel = new Set<number>([
  // Add item IDs you want to treat as "do not craft unless direct"
  2318, // Light Leather
  2319, // Medium Leather
  4234, // Heavy Leather
  4304, // Thick Leather
  8170, // Rugged Leather
  11371, // Dark Iron bar
  234003, // Obsidian-Infused Thorium Bar
  17771, // Elementium Bar
  6037, // Truesilver Bar
  12359, // Thorium Bar
  3860, // Mithril Bar
  3575, // Iron Bar
  3577, // Gold Bar
  3859, // Steel Bar
  2840, // Copper Bar
  2842, // Silver Bar
  3576, // Tin Bar
  2841, // Bronze Bar
  7068, // Elemental Fire
  // Add more if needed
]);

/** Recipe items whose cost is paid in materials (e.g. Thorium Brotherhood turn-ins) */
const RECIPE_COST_MATERIAL_OVERRIDES: Record<number, { materialId: number; quantity: number }> = {
  12690: { materialId: 12359, quantity: 10 }, // Plans: Imperial Plate Bracers = 10 Thorium Bars
  12700: { materialId: 12359, quantity: 20 }, // Plans: Imperial Plate Boots = 20 Thorium Bars
};

export const forceAhOnlyItems = new Set<number>([
  12360, // Arcanite Bar
  12808, // Essence of Undeath
  12803, // Living Essence
  7080, // Essence of Water
  7082, // Essence of Air
  7076, // Essence of Earth
  7078, // Essence of Fire
  15409, // Refined Deeprock Salt
  22572, // Mote of Air
  22573, // Mote of Earth
  22574, // Mote of Fire
  22575, // Mote of Life
  22576, // Mote of Mana
  22577, // Mote of Shadow
  22578, // Mote of Water
  // Add more as needed
]);

export function getItemCost(
  itemId: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  memo = new Map<number, number>(),
  isTopLevel: boolean = false,
  useMarketValue: boolean = false,
  allowSubCrafting: boolean = true,
  currentProfessionRecipeIds?: Set<number>
): number {
  // Use cached result if already computed
  if (memo.has(itemId)) return memo.get(itemId)!;

  const itemData = materialInfo[itemId];
  
  // First check AH price
  const ahPriceRaw = useMarketValue ?
    (prices[itemId]?.marketValue ?? prices[itemId]?.minBuyout) :
    (prices[itemId]?.minBuyout ?? prices[itemId]?.marketValue);
  const ahPrice = ahPriceRaw && ahPriceRaw > 0 ? ahPriceRaw : Infinity;
  
  // Then check vendor price
  const vendorPrice = itemData?.buyPrice ?? Infinity;

  // Force AH-only items to use auction house price only (ignore vendor)
  if (forceAhOnlyItems.has(itemId)) {
    memo.set(itemId, ahPrice);
    return ahPrice;
  }

  // If item has limited stock at vendor, prefer AH price (even if vendor is cheaper)
  // because you can't buy enough from vendor
  let directPrice;
  if (itemData?.limitedStock && ahPrice < Infinity) {
    directPrice = ahPrice;
  } else {
    // Use the lower of AH and vendor price
    directPrice = Math.min(ahPrice, vendorPrice);
  }

  // Don't allow zero unless it's a vendor item
  if (directPrice === Infinity && itemData?.createdBy) {
    // We will compute craft cost and use that instead below
    directPrice = Infinity;
  }

  let craftCost = Infinity;
  const itemIsTedious = skipCraftingUnlessTopLevel.has(itemId);
  const shouldBlockCrafting = itemIsTedious;

  // Prevent cycles early
  memo.set(itemId, Infinity);

  // If allowSubCrafting is false, only use buy prices (AH/vendor)
  if (!allowSubCrafting) {
    memo.set(itemId, directPrice);
    return directPrice;
  }

  // Only consider crafting if:
  // 1. allowSubCrafting is true
  // 2. Item can be crafted (has createdBy)
  // 3. Not blocked by tedious items
  // 4. If currentProfessionRecipeIds is provided, the spellId must be in that set (same profession)
  const canCraft = itemData?.createdBy && !shouldBlockCrafting;
  const isSameProfession = !currentProfessionRecipeIds || 
    (itemData?.createdBy?.spellId && currentProfessionRecipeIds.has(itemData.createdBy.spellId));
  
  if (canCraft && isSameProfession && itemData.createdBy) {
    const { reagents, minCount = 0, maxCount = 0 } = itemData.createdBy;
    const outputCount = Math.max(1, maxCount + 1);

    const totalReagentCost = Object.entries(reagents).reduce((sum, [idStr, qty]) => {
      const id = parseInt(idStr);
      const qtyNum = typeof qty === 'number' ? qty : 0;
      const cost = getItemCost(id, prices, materialInfo, memo, false, useMarketValue, allowSubCrafting, currentProfessionRecipeIds);
      return sum + cost * qtyNum;
    }, 0);

    craftCost = totalReagentCost / outputCount;
  }

  const finalCost = Math.min(directPrice, craftCost);

  memo.set(itemId, finalCost);
  return finalCost;
}


/**
 * Expected skill-ups from one craft at the current skill, using
 * Blizzard's linear formula:
 *
 *   chance = (G − X) / (G − Y)
 */
export function expectedSkillUps(r: Recipe, skill: number): number {
  const Y = r.difficulty.yellow ?? 0;
  const G = r.difficulty.gray ?? Infinity;

  if (skill < Y) return 1;
  if (skill >= G) return 0;
  return (G - skill) / (G - Y);
}

/**
 * Calculate the expected number of crafts needed to go from low to high skill level
 * Uses sum-of-reciprocals method: sum(1/p for each level), then round once
 * This is mathematically correct - using average success rate becomes asymptotically wrong as rates approach 0%
 */
export function expectedCraftsBetween(
  low: number,
  high: number,
  d: Recipe['difficulty']
): number {
  const totalSkillUps = high - low;
  if (totalSkillUps <= 0) return 0;
  
  // Sum up the reciprocals (1/p for each level)
  // This is the correct way to calculate expected crafts when success rates vary
  let sumOfReciprocals = 0;
  for (let lvl = low; lvl < high; lvl++) {
    const Y = d.yellow ?? 0;
    const G = d.gray ?? Infinity;
    const p = (lvl < Y) ? 1 : (lvl >= G) ? 0 : (G - lvl) / (G - Y);
    
    if (p > 0) {
      sumOfReciprocals += 1 / p;
    } else {
      // If p is 0, we can't progress, return Infinity
      return Infinity;
    }
  }
  
  // Round once at the end
  return Math.ceil(sumOfReciprocals);
}

export function buildMaterialTree(
  itemId: number,
  quantity: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  isTopLevel: boolean = true,
  visited: Set<number> = new Set(),
  useMarketValue: boolean = false,
  allowSubCrafting: boolean = true,
  currentProfessionRecipeIds?: Set<number>
): MaterialTreeNode {
  const info = materialInfo[itemId];
  const vendorPrice = info?.buyPrice;
  const ahEntry = prices[itemId];
  const isListed = !!(ahEntry && (useMarketValue ? ahEntry.marketValue : ahEntry.minBuyout) && (useMarketValue ? ahEntry.marketValue! : ahEntry.minBuyout!) > 0);
  const isVendorItem = info?.buyPrice && !info?.auctionhouse;

  const ahPrice = isListed ? (useMarketValue ? ahEntry.marketValue! : ahEntry.minBuyout!) : Infinity;
  const usedCrafting = !isListed && !isVendorItem;

  // If item has limited stock at vendor, prefer AH price (even if vendor is cheaper)
  // because you can't buy enough from vendor
  let buyCost;
  if (forceAhOnlyItems.has(itemId)) {
    buyCost = ahPrice;
  } else if (info?.limitedStock && ahPrice < Infinity) {
    buyCost = ahPrice;
  } else if (isVendorItem) {
    buyCost = vendorPrice!;
  } else {
    buyCost = typeof vendorPrice === 'number' && vendorPrice < ahPrice ? vendorPrice : ahPrice;
  }

  let craftCost = Infinity;
  let children: MaterialTreeNode[] = [];

  const isTedious = skipCraftingUnlessTopLevel.has(itemId);

  // Prevent infinite loop
  if (visited.has(itemId)) {
    return {
      id: itemId,
      name: info?.name ?? `Item ${itemId}`,
      quantity,
      buyCost: buyCost * quantity,
      craftCost: Infinity,
      totalCost: buyCost * quantity,
      children: [],
      noAhPrice: usedCrafting,
    };
  }

  if (forceAhOnlyItems.has(itemId)) {
    return {
      id: itemId,
      name: info?.name ?? `Item ${itemId}`,
      quantity,
      buyCost: buyCost * quantity,
      craftCost: Infinity,
      totalCost: buyCost * quantity,
      children: [],
      noAhPrice: usedCrafting,
    };
  }

  // Mark as visited
  visited.add(itemId);

  const canCraft = info?.createdBy && !isTedious;
  const isSameProfession = !currentProfessionRecipeIds || 
    (info?.createdBy?.spellId && currentProfessionRecipeIds.has(info.createdBy.spellId));
  
  if (canCraft && allowSubCrafting && isSameProfession && info.createdBy) {
    const { reagents, minCount = 0, maxCount = 0 } = info.createdBy;
    const outputCount = Math.max(1, maxCount + 1);
    const craftsNeeded = quantity / outputCount;

    children = Object.entries(reagents).map(([idStr, qty]) => {
      const childId = parseInt(idStr);
      const qtyNum = typeof qty === 'number' ? qty : 0;
      return buildMaterialTree(
        childId,
        qtyNum * craftsNeeded,
        prices,
        materialInfo,
        false,
        new Set(visited), // Pass a copy to avoid corrupting sibling paths
        useMarketValue,
        allowSubCrafting,
        currentProfessionRecipeIds
      );
    });

    craftCost = children.reduce((sum, c) => sum + c.totalCost, 0);
  }

  const totalCost = Math.min(buyCost * quantity, craftCost);

  return {
    id: itemId,
    name: info?.name ?? `Item ${itemId}`,
    quantity,
    buyCost: buyCost * quantity,
    craftCost,
    totalCost,
    children,
    noAhPrice: usedCrafting,
  };
}