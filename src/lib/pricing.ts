import { PriceMap } from "./types";
import type { MaterialInfo } from './types';

type TsmAuction = {
  itemId: number;
  minBuyout: number;
  marketValue: number;
};

/** Convert TSM auction rows → PriceMap keyed by itemId */

export const ignoreVendorPriceIds = new Set<number>([
  8846,  // Gromsblood
]);

export function toPriceMap(
  rows: { itemId: number; minBuyout: number; marketValue: number }[],
  materials: Record<string, { vendorPrice?: number; limitedStock?: boolean }>
): PriceMap {
  return rows.reduce<PriceMap>((map, row) => {
    const id = row.itemId;
    const idStr = String(id);

    const material = materials[idStr];
    const hasLimitedStock = material?.limitedStock === true;
    
    // Don't use vendor price if item has limited stock or is in ignore list
    const vendor = (ignoreVendorPriceIds.has(id) || hasLimitedStock)
      ? undefined
      : material?.vendorPrice;

    // Don't modify AH prices based on vendor price anymore
    map[id] = {
      minBuyout: row.minBuyout,
      marketValue: row.marketValue,
      vendorPrice: vendor
    };

    return map;
  }, {});
}