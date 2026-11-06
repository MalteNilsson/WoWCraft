export const FOREVER_REALMS = ['Forever PvE US', 'Forever PvP US', 'Forever PvE EU', 'Forever PvP EU'] as const;

const FOREVER_REALM_ALIASES: Record<string, (typeof FOREVER_REALMS)[number]> = {
  'forever normal': 'Forever PvE US',
  'forever pve': 'Forever PvE US',
  'forever pve us': 'Forever PvE US',
  'forever pvp': 'Forever PvP US',
  'forever pvp us': 'Forever PvP US',
  'forever normal eu': 'Forever PvE EU',
  'forever pve eu': 'Forever PvE EU',
  'forever pvp eu': 'Forever PvP EU',
};

/** Map a Forever realm query, including the older Normal and PvP names, onto one of the four markets. */
export function canonicalForeverRealm(value: string): (typeof FOREVER_REALMS)[number] | null {
  return FOREVER_REALM_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function foreverRealmKind(realm: string): 'PvP' | 'PvE' | null {
  const market = canonicalForeverRealm(realm);
  if (!market) return null;
  return market.includes('PvP') ? 'PvP' : 'PvE';
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
  return '';
}

export function RealmName({ realm }: { realm: string }) {
  const market = canonicalForeverRealm(realm);
  if (!market) return <>{realm}</>;
  const kind = market.includes('PvP') ? 'PvP' : 'PvE';
  const region = market.endsWith('EU') ? 'EU' : 'US';
  return (
    <>
      <span className={kind === 'PvP' ? 'text-red-400' : 'text-emerald-400'}>{kind}</span>
      {' '}
      <span className="text-white">{region}</span>
    </>
  );
}
