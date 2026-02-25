/**
 * Region data from TSM pricing API (GET /region/{regionId}).
 * Used for soldPerDay sanity-checking in auction-house price sourcing.
 */

import realmsData from '@/data/prices/realms.json';

export type RegionItemStat = {
  regionId: number;
  itemId: number;
  petSpeciesId: number | null;
  quantity: number;
  marketValue: number;
  avgSalePrice: number;
  saleRate: number;
  soldPerDay: number;
  historical: number;
};

/** Map itemId -> soldPerDay for quick lookup during AH candidate filtering */
export type RegionSoldPerDayMap = Map<number, number>;

type RealmEntry = { name: string; regionId: number };
type RegionEntry = { regionId: number; name: string; regionPrefix?: string; realms: RealmEntry[] };

/** Map realms.json region name/prefix to TSM pricing API regionId (1=NA, 2=EU) */
function toPricingRegionId(region: RegionEntry): number {
  const name = (region.name ?? '').toLowerCase();
  const prefix = (region.regionPrefix ?? '').toLowerCase();
  if (name.includes('europe') || prefix === 'eu') return 2;
  if (name.includes('north america') || name.includes('america') || prefix === 'us') return 1;
  return 1; // default to NA
}

/** Build realm name -> pricing regionId from realms.json. Cached. */
let realmToPricingRegionCache: Map<string, number> | null = null;

function buildRealmToRegionMap(): Map<string, number> {
  if (realmToPricingRegionCache) return realmToPricingRegionCache;
  const map = new Map<string, number>();
  const items = (realmsData as { items?: RegionEntry[] }).items ?? [];
  for (const region of items) {
    const pricingId = toPricingRegionId(region);
    for (const realm of region.realms ?? []) {
      map.set(realm.name, pricingId);
    }
  }
  realmToPricingRegionCache = map;
  return map;
}

/** Get TSM pricing API regionId (1=NA, 2=EU) for a realm from realms.json. Returns 1 if unknown. */
export function getRegionIdForRealm(realm: string): number {
  return buildRealmToRegionMap().get(realm) ?? 1;
}

/** Build itemId -> soldPerDay map from region JSON array */
export function buildRegionSoldPerDayMap(regionData: RegionItemStat[]): RegionSoldPerDayMap {
  const map = new Map<number, number>();
  for (const row of regionData) {
    if (row.itemId != null && row.petSpeciesId == null) {
      map.set(row.itemId, row.soldPerDay ?? 0);
    }
  }
  return map;
}
