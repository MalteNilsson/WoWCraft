import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdSlot, AD_SLOT_SKYSCRAPER } from '@/components/AdSlot';
import { auctionDataUpdatedLabel, auctionRealms, professionGuides } from '@/lib/professionGuides';

export const metadata: Metadata = {
  title: 'WoWCraft — Classic Profession Leveling Planner',
  description:
    'WoWCraft builds cost-effective profession leveling routes for World of Warcraft Classic and The Burning Crusade, using skill-up chances, vendor prices, and auction house listings.',
};

type GameVersion = 'vanilla' | 'tbc';

const gameVersions: { id: GameVersion; label: string }[] = [
  { id: 'tbc', label: 'The Burning Crusade' },
  { id: 'vanilla', label: 'Vanilla' },
];

function parseGameVersion(value?: string): GameVersion {
  return value?.toLowerCase() === 'vanilla' ? 'vanilla' : 'tbc';
}

function professionHref(slug: string, version: GameVersion): string {
  return version === 'vanilla' ? `/${slug}?version=Vanilla` : `/${slug}`;
}

function isAvailableInVersion(slug: string, version: GameVersion): boolean {
  if (version === 'tbc') return true;
  return slug !== 'jewelcrafting' && slug !== 'cooking';
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string; version?: string }>;
}) {
  const params = await searchParams;
  const version = parseGameVersion(params.version);
  if (params.skill && /^\d+$/.test(params.skill)) {
    const versionQuery = version === 'vanilla' ? '&version=Vanilla' : '';
    redirect(`/enchanting?skill=${params.skill}${versionQuery}`);
  }

  return (
    <div className="flex h-dvh justify-center bg-neutral-950 px-4 text-neutral-100 desktop-layout:px-8">
      <div className="flex h-full w-full max-w-5xl flex-col overflow-y-auto border-x border-neutral-800 bg-neutral-925">
      <main className="flex-1 px-6 py-10 desktop-layout:max-[1919px]:px-10 min-[1920px]:px-6">
        <p className="text-sm font-medium tracking-wide text-[#e3b056]">Free for the Classic community</p>
        <h1 className="mt-2 text-3xl font-bold text-white desktop-layout:text-4xl">
          Welcome to <span className="text-[#e3b056]">WoW</span>Craft
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-neutral-300">
          Leveling a profession should feel like progress, not a spreadsheet.
          Tell WoWCraft where you are and where you want to end up, and it will
          lay out the crafts, what they cost on your realm, and what to buy before you start.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">Where do you want to start?</h2>
          <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-900 p-1" role="group" aria-label="Game version">
            {gameVersions.map((option) => {
              const selected = option.id === version;
              return (
                <Link
                  key={option.id}
                  href={option.id === 'vanilla' ? '/?version=vanilla' : '/'}
                  aria-current={selected ? 'true' : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                    selected
                      ? option.id === 'tbc'
                        ? 'bg-emerald-500 text-neutral-950'
                        : 'bg-[#e3b056] text-neutral-950'
                      : 'text-neutral-300 hover:text-white'
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="mt-4 min-[1920px]:grid min-[1920px]:grid-cols-[160px_minmax(0,1fr)_160px] min-[1920px]:items-stretch min-[1920px]:gap-6">
        <AdSlot
          slot={AD_SLOT_SKYSCRAPER}
          width={160}
          height={600}
          className="hidden h-[600px] w-[160px] items-center justify-center min-[1920px]:flex"
        />
        <ul className="grid grid-cols-2 gap-3 min-[1920px]:h-[600px] min-[1920px]:auto-rows-fr">
          {professionGuides.map((guide) => {
            const available = isAvailableInVersion(guide.slug, version);
            const card = (
              <>
                <img
                  src={`/icons/${guide.slug}.webp`}
                  alt=""
                  className={`h-14 w-14 shrink-0 ${available ? '' : 'opacity-40'}`}
                />
                <span className="min-w-0">
                  <span className={`block font-semibold ${available ? 'text-white' : 'text-neutral-500'}`}>
                    {guide.name}
                  </span>
                  <span className={`mt-1 block text-sm leading-snug ${available ? 'text-neutral-400' : 'text-neutral-500'}`}>
                    {guide.card}
                  </span>
                  {!available && (
                    <span className="mt-1 block text-xs text-neutral-500">The Burning Crusade only</span>
                  )}
                </span>
              </>
            );
            return (
              <li key={guide.slug}>
                {available ? (
                  <Link
                    href={professionHref(guide.slug, version)}
                    className="flex h-full items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3.5 transition-colors hover:border-[#e3b056]/70 hover:bg-neutral-800"
                  >
                    {card}
                  </Link>
                ) : (
                  <div className="flex h-full items-center gap-3 rounded-lg border border-neutral-800/70 bg-neutral-900/40 px-4 py-3.5">
                    {card}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <AdSlot
          slot={AD_SLOT_SKYSCRAPER}
          width={160}
          height={600}
          className="hidden h-[600px] w-[160px] items-center justify-center min-[1920px]:flex"
        />
        </div>
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-white">You will come out with a plan</h2>
          <ul className="mt-4 grid gap-3 desktop-layout:grid-cols-3">
            <li className="rounded-lg border border-neutral-800 bg-neutral-900/80 px-4 py-4">
              <h3 className="font-medium text-[#e3b056]">The next crafts</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                A path from your current skill to your goal, one recipe at a time, with how many you need to make.
              </p>
            </li>
            <li className="rounded-lg border border-neutral-800 bg-neutral-900/80 px-4 py-4">
              <h3 className="font-medium text-[#e3b056]">Your realm&apos;s prices</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                Material cost, vendor price, disenchant value, or the auction house, for Alliance and Horde.
              </p>
            </li>
            <li className="rounded-lg border border-neutral-800 bg-neutral-900/80 px-4 py-4">
              <h3 className="font-medium text-[#e3b056]">Everything to buy</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-300">
                One shopping list for the whole stretch, so you can stock up and then just craft.
              </p>
            </li>
          </ul>
          <p className="mt-6 text-sm leading-relaxed text-neutral-400">
            Auction prices are ready for {auctionRealms.join(', ')}, updated {auctionDataUpdatedLabel}.
            Vanilla runs to 300. The Burning Crusade runs to 375.
          </p>
        </section>
      </main>

      <footer className="border-t border-neutral-800">
        <p className="px-5 py-4 text-xs leading-relaxed text-neutral-500">
          WoWCraft is not affiliated with Blizzard Entertainment. World of Warcraft is a
          registered trademark of Blizzard Entertainment.
        </p>
      </footer>
      </div>
    </div>
  );
}
