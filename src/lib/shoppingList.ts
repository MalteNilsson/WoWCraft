export type ShoppingListItem = {
  itemId: number;
  name?: string;
  quantity?: number;
};

/** Empty Auctionator advanced-search fields, then the quantity. `"Name";;;;;;;;;;;;;84` */
const AUCTIONATOR_QUANTITY_PADDING = ';;;;;;;;;;;;;';

function shoppingQuantity(quantity: number | undefined): number {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return 1;
  const cleaned = Math.round(quantity * 1000) / 1000;
  return Math.max(1, Math.ceil(cleaned));
}

/** Auctionator shopping-tab import. First field is the list name; each later field is an exact item search with a quantity. */
export function auctionatorShoppingList(profession: string, skill: number, target: number, items: ShoppingListItem[]): string {
  const listName = `WoWCraft ${profession} ${skill}-${target}`.replace(/[\r\n^]/g, ' ').trim();
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
