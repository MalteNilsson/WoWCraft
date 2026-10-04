import Link from 'next/link';
import { AdSlot, AD_SLOT_SKYSCRAPER } from '@/components/AdSlot';

const links = [
  { href: '/', label: 'Home' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
];

export function ArticleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh justify-center gap-0 bg-neutral-950 px-4 text-neutral-100 desktop-layout:px-8 min-[1920px]:gap-6 min-[1920px]:px-6">
      <AdSlot
        slot={AD_SLOT_SKYSCRAPER}
        width={160}
        height={600}
        className="sticky top-4 z-10 hidden h-[600px] w-[160px] shrink-0 items-center justify-center self-start min-[1920px]:flex"
      />
      <div className="flex h-full min-w-0 w-full max-w-5xl flex-col overflow-y-auto border-x border-neutral-800 bg-neutral-925">
        <header className="flex flex-none flex-wrap items-center justify-between gap-4 border-b border-neutral-800 px-6 py-4">
          <Link href="/" className="text-lg font-bold text-white">
            <span className="text-[#e3b056]">WoW</span>Craft
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-400">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-white">
                {link.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 px-6 py-10 desktop-layout:px-10">{children}</main>
        <footer className="border-t border-neutral-800 px-6 py-4 text-xs leading-relaxed text-neutral-500">
          WoWCraft is not affiliated with Blizzard Entertainment. World of Warcraft is a
          registered trademark of Blizzard Entertainment.
        </footer>
      </div>
      <AdSlot
        slot={AD_SLOT_SKYSCRAPER}
        width={160}
        height={600}
        className="sticky top-4 z-10 hidden h-[600px] w-[160px] shrink-0 items-center justify-center self-start min-[1920px]:flex"
      />
    </div>
  );
}
