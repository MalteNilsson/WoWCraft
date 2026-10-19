export function factionTextClass(faction: string): string {
  return faction === 'Horde' ? 'text-[#f07167]' : 'text-[#7aa7ff]';
}

export function factionRingClass(faction: string): string {
  return faction === 'Horde'
    ? 'shadow-[inset_0_0_0_1px_rgba(240,113,103,0.55)]'
    : 'shadow-[inset_0_0_0_1px_rgba(122,167,255,0.55)]';
}

export function FactionIcon({ faction, className = 'h-3.5 w-3.5' }: { faction: string; className?: string }) {
  const horde = faction === 'Horde';
  return (
    <img
      src={horde ? '/icons/horde.jpg' : '/icons/alliance.jpg'}
      alt=""
      className={`shrink-0 rounded-[3px] object-cover ${className}`}
    />
  );
}

export function FactionLabel({ faction, iconClassName = 'h-3 w-3' }: { faction: string; iconClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 align-middle ${factionTextClass(faction)}`}>
      <FactionIcon faction={faction} className={iconClassName} />
      <span>{faction}</span>
    </span>
  );
}
