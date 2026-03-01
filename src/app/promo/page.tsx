'use client';

import Link from 'next/link';

export default function PromoPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="flex-none border-b border-neutral-800 px-4 py-4 lg:px-8">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            href="/enchanting"
            className="text-neutral-400 hover:text-white transition-colors text-sm font-medium"
          >
            ← Back to Planner
          </Link>
          <span className="text-lg font-bold">
            <span className="text-[#e3b056]">WoW</span>Craft.io
          </span>
        </div>
      </header>
      <main className="flex-1 px-4 py-8 lg:px-8 lg:py-12 max-w-2xl mx-auto w-full">
        <h1 className="text-2xl lg:text-3xl font-bold text-white mb-6">About Project</h1>
        <div className="space-y-6 text-neutral-300 text-sm lg:text-base leading-relaxed">
          <p>
            Hi and welcome to WoWCraft! I&apos;m <strong className="text-white">Malte &quot;StabShot&quot; Nilsson</strong>, and I built this as a free tool for the WoW Classic community out of love for the game and building useful software. WoWCraft is a crafting planner and leveling guide that helps you find profitable crafts and skill up in the easiest way by calculating cost-effective profession leveling routes, material requirements, and skill progression paths using auction house data and vendor pricing. The project is open source on{' '}
            <a
              href="https://github.com/MalteNilsson/WoWCraft"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
            >
              GitHub
            </a>
            .
          </p>
          <p>
            I&apos;m from Sweden and hold a Master&apos;s degree in Computer Science. I enjoy building full-stack web applications and tools that solve real problems. I&apos;m currently looking for employment. If you&apos;re interested in working together or have an opportunity you&apos;d like to discuss, please reach out:
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://discord.com/users/199570995592298496"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold transition-colors"
            >
              Discord: stabshot
            </a>
            <a
              href="mailto:malte.o.nilsson@gmail.com"
              className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-900 font-semibold transition-colors"
            >
              malte.o.nilsson@gmail.com
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
