import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleLayout } from '@/components/ArticleLayout';

export const metadata: Metadata = {
  title: 'Privacy Policy | WoWCraft',
  description: 'How WoWCraft uses cookies, Google AdSense, and Vercel Analytics.',
};

export default function PrivacyPage() {
  return (
    <ArticleLayout>
      <h1 className="text-3xl font-bold text-white">Privacy policy</h1>
      <div className="mt-6 max-w-3xl space-y-4 text-base leading-relaxed text-neutral-300">
        <p>
          WoWCraft is operated by Malte Nilsson. The site does not ask you to create an account, and it does not sell personal information.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-white">Advertising</h2>
        <p>
          Some pages show ads from Google AdSense. Google uses cookies to serve and measure those ads, including ads based on your visits to this site and others. You can read how Google uses data in{' '}
          <a
            href="https://policies.google.com/technologies/partner-sites"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#e3b056] underline underline-offset-2 hover:text-white"
          >
            Google&apos;s partner sites policy
          </a>
          , and you can control ad personalization in{' '}
          <a
            href="https://adssettings.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#e3b056] underline underline-offset-2 hover:text-white"
          >
            Google&apos;s ad settings
          </a>
          . Visitors in the EEA, the UK, and Switzerland are asked for consent before personalized ads are used.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-white">Analytics</h2>
        <p>
          The site uses Vercel Analytics to count page views. That measurement is aggregated and is not used to build an advertising profile.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-white">Saved on your device</h2>
        <p>
          If you accept the auction-house disclaimer in the planner, the browser stores that choice in local storage so the notice is not shown again. That value stays on your device.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-white">Contact</h2>
        <p>
          Questions about this policy can go to{' '}
          <a href="mailto:malte.o.nilsson@gmail.com" className="text-[#e3b056] underline underline-offset-2 hover:text-white">
            malte.o.nilsson@gmail.com
          </a>
          . More about the project is on the <Link href="/about" className="text-[#e3b056] underline underline-offset-2 hover:text-white">About page</Link>.
        </p>
      </div>
    </ArticleLayout>
  );
}
