import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
];

export function ArticleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-dvh justify-center overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[-18rem] h-[34rem] w-[56rem] -translate-x-1/2 rounded-full bg-[#e3b056]/[0.09] blur-3xl" />
        <div className="absolute right-[-6rem] top-24 h-80 w-80 rounded-full bg-[#1fb5f7]/10 blur-3xl" />
      </div>
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-y-auto px-5 sm:px-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-600/40 hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600/60 scrollbar-thin scrollbar-thumb-neutral-600/40">
        <header className="flex flex-none items-center justify-between gap-4 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            <span className="text-[#e3b056]">WoW</span>Craft
          </Link>
          <nav className="flex items-center gap-5 text-sm text-neutral-400">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={link.href === '/'
                  ? 'rounded-full border border-[#e3b056]/40 bg-[#e3b056]/10 px-3 py-1 font-medium text-[#e3b056] transition-colors hover:border-[#e3b056]/70 hover:bg-[#e3b056]/20 hover:text-white'
                  : 'transition-colors hover:text-white'}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 pb-10">{children}</main>
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
