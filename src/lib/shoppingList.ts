export type ShoppingListItem = {
  itemId: number;
  name?: string;
  quantity?: number;
  source?: 'vendor' | 'auction';
  icon?: string;
  /** WoW item quality, 0–7. */
  quality?: number;
  /** Copper to buy one of this item from `source`. */
  copper?: number;
};

/** One leveling-guide step embedded in the WeakAura. `each` is the reagent count for a single craft. */
export type GuideStep = {
  name: string;
  icon?: string;
  crafts: number;
  from: number;
  to: number;
  yellow: number;
  gray: number;
  green?: number;
  quality?: number;
  spell?: number;
  source?: string;
  sourceName?: string;
  sourceIcon?: string;
  sourceQuality?: number;
  eachCost?: number;
  /** Material cost of one craft before vendor, disenchant, or auction value is removed. */
  eachSpend?: number;
  recipeCost?: number;
  /** One-time item required to learn this step, such as a plan or pattern. */
  recipeItem?: { id: number; name: string; icon?: string; quantity: number };
  bop?: boolean;
  returns?: GuideReturns;
  alts?: GuideOption[];
  materials: { id: number; name: string; icon?: string; each: number }[];
};

/** Another recipe that can cover the same skill step. */
export type GuideOption = {
  name: string;
  icon?: string;
  quality?: number;
  spell?: number;
  crafts: number;
  yellow: number;
  green?: number;
  gray: number;
  eachCost: number;
  /** Material cost of one craft before vendor, disenchant, or auction value is removed. */
  eachSpend: number;
  recipeCost: number;
  bop?: boolean;
  source?: string;
  sourceName?: string;
  sourceIcon?: string;
  sourceQuality?: number;
  returns?: GuideReturns;
  materials: { id: number; name: string; icon?: string; each: number }[];
};

/** Money or disenchant materials recovered from one craft, before multiplying by the step's craft count. */
export type GuideReturns = {
  kind: 'vendor' | 'auction' | 'disenchant';
  copper: number;
  items?: { id: number; name: string; icon?: string; quality?: number; each: number; copper: number }[];
};

/** Empty Auctionator advanced-search fields, then the quantity. `"Name";;;;;;;;;;;;;84` */
const AUCTIONATOR_QUANTITY_PADDING = ';;;;;;;;;;;;;';

export function shoppingQuantity(quantity: number | undefined): number {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return 1;
  const cleaned = Math.round(quantity * 1000) / 1000;
  return Math.max(1, Math.ceil(cleaned));
}

/** Name Auctionator stores for the imported list, including the selected skill span. */
export function auctionatorListName(profession: string, skill: number, target: number): string {
  return `WoWCraft ${profession} ${skill}-${target}`.replace(/[\r\n^]/g, ' ').trim();
}

/** Title shown on the in-game shopping list. Forever Normal is the PvE realm. */
export function shoppingListTitle(profession: string, skill: number, target: number, realm: string, faction: string): string {
  const ruleset = realm === 'Forever PvP' ? 'PvP' : realm === 'Forever Normal' ? 'PvE' : realm;
  const side = faction === 'Horde' || faction === 'Alliance' ? faction : faction || 'Alliance';
  return `WoWCraft.io ${profession} ${skill}-${target} ${ruleset} ${side} Shopping List`.replace(/[\r\n^]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Auctionator shopping-tab import. First field is the list name; each later field is an exact item search with a quantity. */
export function auctionatorShoppingList(profession: string, skill: number, target: number, items: ShoppingListItem[]): string {
  const listName = auctionatorListName(profession, skill, target);
  const terms = items.flatMap((item) => {
    const name = (item.name || '').trim().replace(/["^]/g, '');
    if (!name) return [];
    return [`"${name}"${AUCTIONATOR_QUANTITY_PADDING}${shoppingQuantity(item.quantity)}`];
  });
  if (!terms.length) return '';
  return [listName, ...terms].join('^');
}

/** TSM shopping search. `/x` is the quantity to buy before that item drops out of the results. */
export function tsmShoppingList(items: ShoppingListItem[]): string {
  const terms = items.flatMap((item) => {
    if (!Number.isFinite(item.itemId) || item.itemId <= 0) return [];
    return [`i:${item.itemId}/x${shoppingQuantity(item.quantity)}`];
  });
  if (!terms.length) return '';
  return terms.join(';');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
