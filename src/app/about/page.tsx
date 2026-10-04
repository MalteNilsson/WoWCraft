import type { Metadata } from 'next';
import { ArticleLayout } from '@/components/ArticleLayout';

export const metadata: Metadata = {
  title: 'About | WoWCraft',
  description: 'WoWCraft is a free profession leveling planner for World of Warcraft Classic and The Burning Crusade, built by Malte Nilsson.',
};

export default function AboutPage() {
  return (
    <ArticleLayout>
      <h1 className="text-3xl font-bold text-white">About WoWCraft</h1>
      <div className="mt-6 max-w-3xl space-y-6 text-base leading-relaxed text-neutral-300">
        <p>
          Hi and welcome to WoWCraft. I&apos;m <strong className="text-white">Malte &quot;StabShot&quot; Nilsson</strong>, and I built this as a free tool for the WoW Classic community. WoWCraft plans profession leveling routes from your current skill to a goal, prices the materials, and builds one shopping list for the stretch.
        </p>
        <p>
          The planner covers Vanilla through skill 300 and The Burning Crusade through skill 375. Auction prices come from TradeSkillMaster listing data for Thunderstrike, Spineshatter, Soulseeker, Dreamscythe, Nightslayer, and Doomhowl, for Alliance and Horde. Those figures are listings, not confirmed sales.
        </p>
        <p>
          The project is open source on{' '}
          <a
            href="https://github.com/MalteNilsson/WoWCraft"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#e3b056] underline underline-offset-2 hover:text-white"
          >
            GitHub
          </a>
          . I&apos;m from Sweden. If you want to talk about the site, write to{' '}
          <a href="mailto:malte.o.nilsson@gmail.com" className="text-[#e3b056] underline underline-offset-2 hover:text-white">
            malte.o.nilsson@gmail.com
          </a>{' '}
          or message stabshot on{' '}
          <a
            href="https://discord.com/users/199570995592298496"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#e3b056] underline underline-offset-2 hover:text-white"
          >
            Discord
          </a>
          .
        </p>
      </div>
    </ArticleLayout>
  );
}
