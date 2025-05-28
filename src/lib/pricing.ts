import { PriceMap } from "./types";
import type  materialInfo  from '@/lib/materialsLoader';

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

    const minBuyout = vendor != null ? Math.min(row.minBuyout, vendor) : row.minBuyout;
    const marketValue = vendor != null ? Math.min(row.marketValue, vendor) : row.marketValue;

    map[id] = {
      minBuyout,
      marketValue
    };

    return map;
  }, {});
}