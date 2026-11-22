import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { canonicalForeverRealm } from '@/components/RealmName';

type CostEntry = {
  realm: string;
  faction: string;
  profession: string;
  pricesObservedAt: string;
  recordedAt: string;
  totalCopper: number | null;
  reachedTarget: boolean;
};

type CostHistory = {
  entries: CostEntry[];
};

let entries: CostEntry[] | null = null;

function loadEntries(): CostEntry[] {
  if (entries) return entries;
  const file = path.join(process.cwd(), 'src/data/profession-costs/forever.json');
  const history = JSON.parse(fs.readFileSync(file, 'utf8')) as CostHistory;
  entries = history.entries ?? [];
  return entries;
}

/** Level-up cost points for one Forever profession, realm, and faction. */
export function GET(request: NextRequest) {
  const profession = request.nextUrl.searchParams.get('profession') ?? '';
  const realm = request.nextUrl.searchParams.get('realm') ?? '';
  const faction = request.nextUrl.searchParams.get('faction') ?? '';
  const market = canonicalForeverRealm(realm);

  if (!profession || !market || (faction !== 'Alliance' && faction !== 'Horde')) {
    return NextResponse.json({ points: [] });
  }

  const byObservedAt = new Map<string, { at: string; copper: number; recordedAt: string }>();
  for (const entry of loadEntries()) {
    if (entry.profession !== profession || entry.faction !== faction) continue;
    if (canonicalForeverRealm(entry.realm) !== market) continue;
    if (!entry.reachedTarget || typeof entry.totalCopper !== 'number' || entry.totalCopper <= 0) continue;
    const previous = byObservedAt.get(entry.pricesObservedAt);
    if (!previous || previous.recordedAt < entry.recordedAt) {
      byObservedAt.set(entry.pricesObservedAt, {
        at: entry.pricesObservedAt,
        copper: entry.totalCopper,
        recordedAt: entry.recordedAt,
      });
    }
  }

  const points = [...byObservedAt.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ at, copper }) => ({ at, copper }));

  return NextResponse.json({ points });
}
