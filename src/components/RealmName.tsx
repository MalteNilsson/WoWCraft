export const FOREVER_REALMS = [
  'Forever PvP US',
  'Forever PvP EU',
  'Forever PvE US',
  'Forever PvE EU',
  'Forever RP US',
  'Forever RP EU',
  'Forever RP-PvP US',
  'Forever RP-PvP EU',
] as const;

export type ForeverRealm = (typeof FOREVER_REALMS)[number];
export type ForeverRealmKind = 'PvE' | 'PvP' | 'RP' | 'RP-PvP';

const FOREVER_REALM_ALIASES: Record<string, ForeverRealm> = {
  'forever normal': 'Forever PvE US',
  'forever pve': 'Forever PvE US',
  'forever pve us': 'Forever PvE US',
  'forever pvp': 'Forever PvP US',
  'forever pvp us': 'Forever PvP US',
  'forever rp': 'Forever RP US',
  'forever rp us': 'Forever RP US',
  'forever roleplay': 'Forever RP US',
  'forever roleplay us': 'Forever RP US',
  'forever rp-pvp': 'Forever RP-PvP US',
  'forever rp-pvp us': 'Forever RP-PvP US',
  'forever rp pvp': 'Forever RP-PvP US',
  'forever rp pvp us': 'Forever RP-PvP US',
  'forever rppvp': 'Forever RP-PvP US',
  'forever rppvp us': 'Forever RP-PvP US',
  'forever normal eu': 'Forever PvE EU',
  'forever pve eu': 'Forever PvE EU',
  'forever pvp eu': 'Forever PvP EU',
  'forever rp eu': 'Forever RP EU',
  'forever roleplay eu': 'Forever RP EU',
  'forever rp-pvp eu': 'Forever RP-PvP EU',
  'forever rp pvp eu': 'Forever RP-PvP EU',
  'forever rppvp eu': 'Forever RP-PvP EU',
};

/** Map a Forever realm query, including the older Normal and PvP names, onto a market. */
export function canonicalForeverRealm(value: string): ForeverRealm | null {
  return FOREVER_REALM_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function foreverRealmKind(realm: string): ForeverRealmKind | null {
  const market = canonicalForeverRealm(realm);
  if (!market) return null;
  if (market.includes('RP-PvP')) return 'RP-PvP';
  if (market.includes('PvP')) return 'PvP';
  if (market.includes('RP')) return 'RP';
  return 'PvE';
}

export function foreverRealmRegion(realm: string): 'US' | 'EU' | null {
  const market = canonicalForeverRealm(realm);
  if (!market) return null;
  return market.endsWith('EU') ? 'EU' : 'US';
}

export function realmRingClass(realm: string): string {
  const kind = foreverRealmKind(realm);
  if (kind === 'PvP') return 'shadow-[inset_0_0_0_1px_rgba(248,113,113,0.55)]';
  if (kind === 'PvE') return 'shadow-[inset_0_0_0_1px_rgba(52,211,153,0.55)]';
  if (kind === 'RP') return 'shadow-[inset_0_0_0_1px_rgba(167,139,250,0.55)]';
  if (kind === 'RP-PvP') return 'shadow-[inset_0_0_0_1px_rgba(232,121,249,0.55)]';
  return '';
}

const KIND_CLASS: Record<ForeverRealmKind, string> = {
  PvE: 'text-emerald-400',
  PvP: 'text-red-400',
  RP: 'text-violet-400',
  'RP-PvP': 'text-fuchsia-400',
};

export function RealmName({ realm }: { realm: string }) {
  const market = canonicalForeverRealm(realm);
  if (!market) return <>{realm}</>;
  const kind = foreverRealmKind(market);
  const region = market.endsWith('EU') ? 'EU' : 'US';
  return (
    <>
      <span className={kind ? KIND_CLASS[kind] : 'text-white'}>{kind}</span>
      {' '}
      <span className="text-white">{region}</span>
    </>
  );
}
