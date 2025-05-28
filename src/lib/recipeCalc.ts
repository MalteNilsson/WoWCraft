import { Recipe, PriceMap, MaterialInfo, MaterialTreeNode } from "./types";


function getAverageOutput(minCount?: number, maxCount?: number): number {
  const min = (minCount ?? 0) + 1;
  const max = (maxCount ?? 0) + 1;
  return (min + max) / 2 || 1;
}

/** Total copper cost to craft the recipe once */
export function craftCost(
  r: Recipe,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>
): number {
  let sum = 0;
  for (const [idStr, qty] of Object.entries(r.materials)) {
    const id = parseInt(idStr);
    const price = getItemCost(id, prices, materialInfo, new Map(), true);
    if (price === Infinity) return Infinity;
    sum += price * qty;
  }
  return sum;
}

export function costPerSkillUp(
  r: Recipe,
  currentSkill: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>
): number {
  const chance = expectedSkillUps(r, currentSkill);
  return chance > 0 ? craftCost(r, prices, materialInfo) / chance : Infinity;
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
  isTopLevel: boolean = false
): number {
  // Use cached result if already computed
  if (memo.has(itemId)) return memo.get(itemId)!;

  const itemData = materialInfo[itemId];
  const vendorPrice = itemData?.vendorPrice;
  const ahPriceRaw = prices[itemId]?.minBuyout ?? prices[itemId]?.marketValue;
  const ahPrice = ahPriceRaw && ahPriceRaw > 0 ? ahPriceRaw : Infinity;


  // Always use direct price if item is on force-AH list
  if (forceAhOnlyItems.has(itemId)) {
    const finalPrice =
      typeof vendorPrice === 'number' && vendorPrice < ahPrice
        ? vendorPrice
        : ahPrice;
    memo.set(itemId, finalPrice);
    return finalPrice;
  }

  // Prefer vendor price if cheaper
  let directPrice: number;

  if (typeof vendorPrice === 'number' && vendorPrice < ahPrice) {
    directPrice = vendorPrice;
  } else {
    directPrice = ahPrice;
  }

  // Don't allow zero unless it's a vendor item
  if (!vendorPrice && directPrice === Infinity && itemData?.createdBy) {
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
      const cost = getItemCost(id, prices, materialInfo, memo, false);
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
 * Blizzard’s linear formula:
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
  visited: Set<number> = new Set()
): MaterialTreeNode {
  const info = materialInfo[itemId];
  const vendorPrice = info?.vendorPrice;
  const ahEntry = prices[itemId];
  const isListed = !!(ahEntry && ahEntry.minBuyout && ahEntry.minBuyout > 0);

  const ahPrice = isListed ? ahEntry.minBuyout! : Infinity;
  const usedCrafting = !isListed && !vendorPrice;

  const buyCost =
  typeof vendorPrice === 'number' && vendorPrice < ahPrice
    ? vendorPrice
    : ahPrice;

  let craftCost = Infinity;
  let children: MaterialTreeNode[] = [];

  const isTedious = skipCraftingUnlessTopLevel.has(itemId);

  // ❌ Prevent infinite loop
  if (visited.has(itemId)) {
    return {
      id: itemId,
      name: info?.name ?? `Item ${itemId}`,
      quantity,
      buyCost: buyCost * quantity,
      craftCost: Infinity,
      totalCost: buyCost * quantity,
      children: [],
      noAhPrice: usedCrafting, // ← ADD THIS LINE
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
      children: [], // No children allowed
      noAhPrice: usedCrafting, // ← ADD THIS LINE
    };
  }

  // ✅ Mark as visited
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
        new Set(visited) // Pass a copy to avoid corrupting sibling paths
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
    noAhPrice: usedCrafting, // ← ADD THIS LINE
  };
}