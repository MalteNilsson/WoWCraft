import { PriceMap } from "./types";
import type { MaterialInfo } from './types';

type TsmAuction = {
  itemId: number;
  minBuyout: number;
  marketValue: number;
  numAuctions?: number;
};

/** Convert TSM auction rows → PriceMap keyed by itemId */

export const ignoreVendorPriceIds = new Set<number>([
  765, // Silverleaf
  785, // Mageroyal
  2447, // Peacebloom
  2449, // Earthroot
  2453, // Bruiseweed
  3355, // Wild Steelbloom
  3356, // Kingsblood
  3357, // Liferoot
  3358, // Khadgar's Whisker
  8845, // Ghost Mushroom
  8846, // Gromsblood
  13463, // Dreamfoil
  13464, // Golden Sansam
  13468, // Black Lotus
  248822, // Death Lotus
  249274, // Stranglevine
  249399, // Frilled Lichen
  249424, // Rosecap
]);

export function toPriceMap(
  rows: { itemId: number; minBuyout: number; marketValue: number; numAuctions?: number }[],
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
      vendorPrice: vendor,
      numAuctions: row.numAuctions
    };

    return map;
  }, {});
}