import { PriceMap } from "./types";

type TsmAuction = {
  itemId: number;
  minBuyout: number;
  marketValue: number;
};

/** Convert TSM auction rows → PriceMap keyed by itemId */
export function toPriceMap(
    rows: { itemId: number; minBuyout: number; marketValue: number }[]
  ): PriceMap {
    return rows.reduce<PriceMap>((map, row) => {
      map[row.itemId] = {
        minBuyout:   row.minBuyout,
        marketValue: row.marketValue
      };
      return map;
    }, {});
  }