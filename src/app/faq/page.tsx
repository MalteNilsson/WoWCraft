'use client';

import Link from 'next/link';

const faqs = [
  {
    q: 'What is WoWCraft?',
    a: 'WoWCraft is a profession planning and optimization tool for World of Warcraft Classic and The Burning Crusade. It helps you find the most cost-effective leveling routes and recipe choices.',
  },
  {
    q: 'How does the Cost mode work?',
    a: 'Cost mode uses raw material prices to calculate how much it costs to craft each recipe. It shows you the cheapest way to level based on material costs alone.',
  },
  {
    q: 'What is Auction House mode?',
    a: 'Auction House mode estimates profit by subtracting material costs from the expected sale price of crafted items. Important: we use listing prices, not actual sale prices—items may not sell at listed prices, and prices can be volatile.',
  },
  {
    q: 'How does Disenchanting mode work?',
    a: 'Disenchanting mode is for enchanters who plan to disenchant their crafted items for materials. It subtracts the expected value of disenchant outcomes (e.g. dust, essences, shards) from the material cost, so you can see which recipes are most profitable when you disenchant the output instead of selling it.',
  },
  {
    q: 'Where does the price data come from?',
    a: 'Price data is sourced from TradeSkillMaster (TSM) for selected realms. Data is updated periodically. We show both minimum buyout and market value where available.',
  },
];

export default function FAQPage() {
  return (
    <div className="h-dvh lg:h-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      <header className="flex-none border-b border-neutral-800 px-4 py-4 lg:px-8 shrink-0">
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
      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-8 lg:px-8 lg:py-12 max-w-2xl mx-auto w-full">
        <h1 className="text-2xl lg:text-3xl font-bold text-white mb-2">FAQ</h1>
        <p className="text-neutral-400 text-sm lg:text-base mb-8">
          Frequently asked questions about WoWCraft
        </p>
        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="border-b border-neutral-800 pb-6 last:border-0">
              <h2 className="text-base lg:text-lg font-semibold text-white mb-2">{faq.q}</h2>
              <p className="text-neutral-300 text-sm lg:text-base leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
