'use client';

import { useEffect, useState } from 'react';
import { FactionLabel } from '@/components/FactionMark';
import { RealmName } from '@/components/RealmName';
import { formatPriceAge, getPriceObservedAt, isPriceStale } from '@/lib/priceAge';

type PriceAgeNoticeProps = {
  realm: string;
  faction: string;
  /** Sidebar line, or the stronger warning above the cost panel. */
  variant: 'inline' | 'banner';
};

export function PriceAgeNotice({ realm, faction, variant }: PriceAgeNoticeProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const observedAt = getPriceObservedAt(realm, faction);
  if (!observedAt) return null;

  const stale = isPriceStale(observedAt, now);
  const age = formatPriceAge(observedAt, now);
  const exact = observedAt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const credit = realm.startsWith('Forever') ? <AhledgerCredit /> : null;

  if (variant === 'banner') {
    if (!stale) return null;
    return (
      <div
        className="mx-4 mt-14 desktop-layout:mt-4 mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs desktop-layout:text-sm text-amber-300"
        title={`Prices observed ${exact}`}
      >
        Auction prices for <RealmName realm={realm} /> (<FactionLabel faction={faction} />) were updated {age} and may be unreliable.
        {credit}
      </div>
    );
  }

  return (
    <p
      className={`mb-2 text-[11px] desktop-layout:text-xs ${stale ? 'text-amber-300' : 'text-neutral-400'}`}
      title={`Prices observed ${exact}`}
    >
      {stale
        ? `Auction prices were updated ${age} and may be unreliable.`
        : `Auction prices updated ${age}.`}
      {credit}
    </p>
  );
}

function AhledgerCredit() {
  return (
    <>
      {' '}
      <a
        href="https://ahledger.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-white"
      >
        Prices from AHledger
      </a>
      {'.'}
    </>
  );
}
