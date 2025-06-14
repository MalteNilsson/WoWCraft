import { Recipe, PriceMap, MaterialInfo, MaterialTreeNode } from "./types";
import { ENCHANTING_ROD_SPELL_IDS } from "./planner";


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
    const recipeInfo = materialInfo[recipe.source.recipeItemId];
    const priceData = prices[recipe.source.recipeItemId];
    
    // Get AH price from either minBuyout or marketValue based on toggle
    const minBuyout = priceData?.minBuyout ?? 0;
    const marketValue = priceData?.marketValue ?? 0;
    const ahPrice = useMarketValue ? 
      (marketValue > 0 ? marketValue : (minBuyout > 0 ? minBuyout : null)) :
      (minBuyout > 0 ? minBuyout : (marketValue > 0 ? marketValue : null));
    
    return {
      vendorPrice: recipeInfo?.buyPrice ?? null,
      ahPrice,
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
  useMarketValue: boolean = false
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
    
    // First check AH price
    const priceData = prices[itemId];
    const ahPrice = useMarketValue ?
      (priceData?.marketValue ?? priceData?.minBuyout ?? Infinity) :
      (priceData?.minBuyout ?? priceData?.marketValue ?? Infinity);
    
    // Then check vendor price
    const vendorPrice = matInfo?.buyPrice ?? Infinity;
    
    // Use the lower of the two prices
    const itemPrice = Math.min(ahPrice, vendorPrice);

    // For enchanting rods, include their recipe cost
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
      const rodCraftCost = craftCost(rodRecipe, prices, materialInfo, true, false, useMarketValue);
      return sum + (Math.min(itemPrice, rodCraftCost) * qty);
    }

    return sum + (itemPrice * qty);
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
  useMarketValue: boolean = false
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

  const baseCost = craftCost(r, prices, materialInfo, includeRecipeCost, false, useMarketValue);
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

export const forceAhOnlyItems = new Set<number>([
  12360, // Arcanite Bar
  12808, // Essence of Undeath
  12803, // Living Essence
  7080, // Essence of Water
  7082, // Essence of Air
  7076, // Essence of Earth
  7078, // Essence of Fire
  15409, // Refined Deeprock Salt
  // Add more as needed
]);

export function getItemCost(
  itemId: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  memo = new Map<number, number>(),
  isTopLevel: boolean = false,
  useMarketValue: boolean = false
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

  // Always use direct price if item is on force-AH list
  if (forceAhOnlyItems.has(itemId)) {
    const finalPrice = Math.min(ahPrice, vendorPrice);
    memo.set(itemId, finalPrice);
    return finalPrice;
  }

  // Use the lower of AH and vendor price
  let directPrice = Math.min(ahPrice, vendorPrice);

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

  if (itemData?.createdBy && !shouldBlockCrafting) {
    const { reagents, minCount = 0, maxCount = 0 } = itemData.createdBy;
    const outputCount = Math.max(1, maxCount + 1);

    const totalReagentCost = Object.entries(reagents).reduce((sum, [idStr, qty]) => {
      const id = parseInt(idStr);
      const cost = getItemCost(id, prices, materialInfo, memo, false, useMarketValue);
      return sum + cost * qty;
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

export function buildMaterialTree(
  itemId: number,
  quantity: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  isTopLevel: boolean = true,
  visited: Set<number> = new Set(),
  useMarketValue: boolean = false
): MaterialTreeNode {
  const info = materialInfo[itemId];
  const vendorPrice = info?.buyPrice;
  const ahEntry = prices[itemId];
  const isListed = !!(ahEntry && (useMarketValue ? ahEntry.marketValue : ahEntry.minBuyout) && (useMarketValue ? ahEntry.marketValue! : ahEntry.minBuyout!) > 0);
  const isVendorItem = info?.buyPrice && !info?.auctionhouse;

  const ahPrice = isListed ? (useMarketValue ? ahEntry.marketValue! : ahEntry.minBuyout!) : Infinity;
  const usedCrafting = !isListed && !isVendorItem;

  const buyCost = isVendorItem ? vendorPrice! : 
    (typeof vendorPrice === 'number' && vendorPrice < ahPrice ? vendorPrice : ahPrice);

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

  if (info?.createdBy && !isTedious) {
    const { reagents, minCount = 0, maxCount = 0 } = info.createdBy;
    const outputCount = Math.max(1, maxCount + 1);
    const craftsNeeded = quantity / outputCount;

    children = Object.entries(reagents).map(([idStr, qty]) => {
      const childId = parseInt(idStr);
      return buildMaterialTree(
        childId,
        qty * craftsNeeded,
        prices,
        materialInfo,
        false,
        new Set(visited), // Pass a copy to avoid corrupting sibling paths
        useMarketValue
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