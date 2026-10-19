export function foreverRealmKind(realm: string): 'PvP' | 'Normal' | null {
  if (realm === 'Forever PvP') return 'PvP';
  if (realm === 'Forever Normal') return 'Normal';
  return null;
}

export function realmRingClass(realm: string): string {
  const kind = foreverRealmKind(realm);
  if (kind === 'PvP') return 'shadow-[inset_0_0_0_1px_rgba(248,113,113,0.55)]';
  if (kind === 'Normal') return 'shadow-[inset_0_0_0_1px_rgba(52,211,153,0.55)]';
  return '';
}

export function RealmName({ realm }: { realm: string }) {
  const kind = foreverRealmKind(realm);
  if (!kind) return <>{realm}</>;
  return (
    <>
      <span className="text-white">Forever</span>{' '}
      <span className={kind === 'PvP' ? 'text-red-400' : 'text-emerald-400'}>{kind}</span>
    </>
  );
}
