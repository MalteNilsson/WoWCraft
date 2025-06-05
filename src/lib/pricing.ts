import { PriceMap } from "./types";
import type materialInfo from '@/lib/materialsLoader';

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
  materials: Record<string, { vendorPrice?: number }>
): PriceMap {
  return rows.reduce<PriceMap>((map, row) => {
    const id = row.itemId;
    const idStr = String(id);

    const vendor = ignoreVendorPriceIds.has(id)
      ? undefined
      : materials[idStr]?.vendorPrice;

    // Don't modify AH prices based on vendor price anymore
    map[id] = {
      minBuyout: row.minBuyout,
      marketValue: row.marketValue,
      vendorPrice: vendor
    };

    return map;
  }, {});
}