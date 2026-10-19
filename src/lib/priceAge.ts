import fetchSummary from '@/data/prices/fetch_summary_anniversary.json';
import foreverPriceAge from '@/data/prices/forever_price_age.json';

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

type FetchSummary = {
  timestamp: string;
  results: { realm: string; faction: string; success: boolean; timestamp: string }[];
};

const observedAtByRealmFaction = new Map<string, string>();

for (const row of (fetchSummary as FetchSummary).results) {
  if (row.success && row.timestamp) {
    observedAtByRealmFaction.set(`${row.realm}_${row.faction}`, row.timestamp);
  }
}

for (const [key, iso] of Object.entries(foreverPriceAge)) {
  if (iso) observedAtByRealmFaction.set(key, iso);
}

/** When the auction prices for this realm and faction were last observed. */
export function getPriceObservedAt(realm: string, faction: string): Date | null {
  const specific = observedAtByRealmFaction.get(`${realm}_${faction}`);
  if (specific) return new Date(specific);
  if (!realm.startsWith('Forever') && fetchSummary.timestamp) {
    return new Date(fetchSummary.timestamp);
  }
  return null;
}

export function isPriceStale(observedAt: Date, now: Date): boolean {
  return now.getTime() - observedAt.getTime() > STALE_AFTER_MS;
}

export function formatPriceAge(observedAt: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - observedAt.getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
