import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { professionGuides } from '@/lib/professionGuides';

export const metadata: Metadata = {
  title: 'WoWCraft — Classic Profession Leveling Planner',
  description:
    'WoWCraft builds cost-effective profession leveling routes for World of Warcraft Classic and The Burning Crusade, using skill-up chances, vendor prices, and auction house listings.',
};

type GameVersion = 'vanilla' | 'tbc' | 'forever';

const gameVersions: { id: GameVersion; label: string }[] = [
  { id: 'forever', label: 'Forever' },
  { id: 'tbc', label: 'The Burning Crusade' },
];

function parseGameVersion(value?: string): GameVersion {
  const normalized = value?.toLowerCase();
  if (normalized === 'tbc' || normalized === 'the burning crusade' || normalized === 'vanilla') return 'tbc';
  return 'forever';
}

function professionHref(slug: string, version: GameVersion): string {
  if (version === 'tbc') return `/${slug}?version=tbc`;
  return `/${slug}`;
}

function isAvailableInVersion(slug: string, version: GameVersion): boolean {
  if (version === 'tbc') return true;
  if (version === 'forever') return slug !== 'jewelcrafting';
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
    const versionQuery = version === 'tbc' ? '&version=tbc' : '';
    redirect(`/enchanting?skill=${params.skill}${versionQuery}`);
  }

  const cardHover = version === 'tbc'
    ? 'hover:border-emerald-400/45 hover:bg-emerald-400/[0.04]'
    : 'hover:border-[#1fb5f7]/45 hover:bg-[#1fb5f7]/[0.04]';

  return (
    <div className="relative flex h-dvh justify-center overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[-18rem] h-[34rem] w-[56rem] -translate-x-1/2 rounded-full bg-[#e3b056]/[0.09] blur-3xl" />
        <div className={`absolute right-[-6rem] top-24 h-80 w-80 rounded-full blur-3xl ${version === 'tbc' ? 'bg-emerald-400/10' : 'bg-[#1fb5f7]/10'}`} />
      </div>
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-y-auto px-5 sm:px-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <header className="flex flex-none items-center justify-between gap-4 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            <span className="text-[#e3b056]">WoW</span>Craft
          </Link>
          <nav className="flex gap-5 text-sm text-neutral-400">
            <Link href="/faq" className="transition-colors hover:text-white">FAQ</Link>
            <Link href="/about" className="transition-colors hover:text-white">About</Link>
            <Link href="/privacy" className="transition-colors hover:text-white">Privacy</Link>
          </nav>
        </header>

        <main className="flex-1 pb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e3b056]">Free for the Classic community</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Welcome to <span className="text-[#e3b056]">WoW</span>Craft
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-neutral-400">
            Tell us where your skill is and where you want it to go. We will lay out the crafts, what they cost on your realm, and what to buy before you start.
          </p>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium tracking-tight text-white">Choose a profession</h2>
              <p className="mt-1 text-sm text-neutral-500">The route opens as soon as you pick one.</p>
            </div>
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1" role="group" aria-label="Game version">
              {gameVersions.map((option) => {
                const selected = option.id === version;
                return (
                  <Link
                    key={option.id}
                    href={option.id === 'tbc' ? '/?version=tbc' : '/'}
                    aria-current={selected ? 'true' : undefined}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? option.id === 'tbc'
                          ? 'bg-emerald-400 text-neutral-950'
                          : 'bg-[#1fb5f7] text-neutral-950'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {professionGuides.map((guide) => {
                const available = isAvailableInVersion(guide.slug, version);
                const face = `flex min-h-32 w-full items-center gap-4 rounded-2xl px-4 py-4 ${
                  available
                    ? `border border-white/10 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition duration-200 hover:-translate-y-0.5 ${cardHover}`
                    : 'border border-white/5 bg-white/[0.015]'
                }`;
                const card = (
                  <>
                    <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-neutral-950/70 ${available ? '' : 'opacity-40'}`}>
                      <img src={`/icons/${guide.slug}.webp`} alt="" className="h-10 w-10" />
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-xl font-medium tracking-tight ${available ? 'text-white' : 'text-neutral-500'}`}>
                        {guide.name}
                      </span>
                      <span className={`mt-1 block text-sm leading-snug line-clamp-2 ${available ? 'text-neutral-400' : 'text-neutral-600'}`}>
                        {guide.card}
                      </span>
                      {!available && (
                        <span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-neutral-500">The Burning Crusade only</span>
                      )}
                    </span>
                  </>
                );
                return (
                  <li key={guide.slug} className="flex">
                    {available ? (
                      <Link href={professionHref(guide.slug, version)} className={face}>
                        {card}
                      </Link>
                    ) : (
                      <div className={face}>
                        {card}
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>

          <section className="mt-14 border-t border-white/10 pt-8">
            <h2 className="text-lg font-medium tracking-tight text-white">You will come out with a plan</h2>
            <ul className="mt-6 grid gap-8 desktop-layout:grid-cols-3">
              <li>
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[#e3b056]">01</p>
                <h3 className="mt-2 font-medium text-white">The next crafts</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  A path from your current skill to your goal, one recipe at a time, with how many you need to make.
                </p>
              </li>
              <li>
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[#e3b056]">02</p>
                <h3 className="mt-2 font-medium text-white">Your realm&apos;s prices</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  Material cost, vendor price, disenchant value, or the auction house, for Alliance and Horde.
                </p>
              </li>
              <li>
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[#e3b056]">03</p>
                <h3 className="mt-2 font-medium text-white">Everything to buy</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  One shopping list for the whole stretch, so you can stock up and then just craft.
                </p>
              </li>
            </ul>
            <p className="mt-8 max-w-2xl text-sm leading-relaxed text-neutral-500">
              Auction prices come from TradeSkillMaster for Forever PvE and PvP on US and EU. Forever runs to 300. The Burning Crusade runs to 375.
            </p>
          </section>
        </main>

        <footer className="border-t border-white/10 py-5">
          <p className="text-xs leading-relaxed text-neutral-600">
            WoWCraft is not affiliated with Blizzard Entertainment. World of Warcraft is a
            registered trademark of Blizzard Entertainment.
          </p>
        </footer>
      </div>
    </div>
  );
}
