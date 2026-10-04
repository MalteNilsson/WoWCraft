import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleLayout } from '@/components/ArticleLayout';
import { auctionDataUpdatedLabel, auctionRealms } from '@/lib/professionGuides';

export const metadata: Metadata = {
  title: 'FAQ | WoWCraft',
  description: 'How WoWCraft plans profession routes, prices materials, and uses auction house listings for Classic and The Burning Crusade.',
};

const faqs = [
  {
    q: 'What is WoWCraft?',
    a: 'WoWCraft plans a profession leveling route for World of Warcraft Classic and The Burning Crusade. You set a skill range, and it lists the crafts, how many to make, what they cost, and what to buy before you start.',
  },
  {
    q: 'What is the difference between Vanilla and The Burning Crusade?',
    a: 'Vanilla routes stop at skill 300. The Burning Crusade continues to 375 and adds its own recipes. Cooking and Jewelcrafting are available for The Burning Crusade. Jewelcrafting does not exist in Vanilla, and the Vanilla cooking list has no recipes yet.',
  },
  {
    q: 'How does Cost mode work?',
    a: 'Cost mode prices the route from the materials each craft consumes. It does not subtract anything you might earn by selling or disenchanting the result.',
  },
  {
    q: 'How does Vendor mode work?',
    a: 'Vendor mode uses a vendor price when the item has one, and it subtracts the vendor sell value of a crafted item when that value exists. Reagents such as thread, dye, and salt are often cheaper to judge this way.',
  },
  {
    q: 'How does Disenchant mode work?',
    a: 'Disenchant mode subtracts the expected value of the dust, essences, or shards a crafted item would disenchant into. If that value is zero, the planner falls back to the vendor sell price. Enchanting scrolls are not given a disenchant or vendor credit.',
  },
  {
    q: 'How does Auction House mode work?',
    a: 'Auction House mode compares material cost with the listing price of the crafted item. The numbers are TradeSkillMaster listings, not confirmed sales, and a listed price is not a promise that the item sells. Sparse listings are left out: an item needs at least four auctions, and a margin that is wildly out of line is ignored.',
  },
  {
    q: 'Where do the prices come from?',
    a: `Auction prices cover ${auctionRealms.join(', ')}, for Alliance and Horde. The snapshot used on the site was updated ${auctionDataUpdatedLabel}. Vendor prices come from the game data packed with the recipes.`,
  },
  {
    q: 'How does it choose the next craft?',
    a: 'For each skill point in the range you set, the planner estimates how many times a recipe must be crafted before it grants that point, then keeps the sequence with the lower expected cost. In the profit-oriented modes, a recipe with under a 10% chance to skill up is skipped.',
  },
  {
    q: 'Is WoWCraft affiliated with Blizzard?',
    a: 'No. WoWCraft is a fan-made planner. World of Warcraft is a registered trademark of Blizzard Entertainment.',
  },
  {
    q: 'Does the site use cookies?',
    a: 'Advertising pages use Google AdSense, which sets cookies. The privacy policy explains that, along with Vercel Analytics and the auction-house notice saved in your browser.',
  },
];

export default function FAQPage() {
  return (
    <ArticleLayout>
      <h1 className="text-3xl font-bold text-white">FAQ</h1>
      <p className="mt-3 max-w-3xl text-base text-neutral-400">
        How the planner prices a route, and what the auction numbers mean.
      </p>
      <div className="mt-8 max-w-3xl space-y-8">
        {faqs.map((faq) => (
          <section key={faq.q} className="border-b border-neutral-800 pb-8 last:border-0">
            <h2 className="text-lg font-semibold text-white">{faq.q}</h2>
            <p className="mt-2 text-base leading-relaxed text-neutral-300">{faq.a}</p>
          </section>
        ))}
      </div>
      <p className="mt-4 text-sm text-neutral-400">
        Details on cookies and ads are in the <Link href="/privacy" className="text-[#e3b056] underline underline-offset-2 hover:text-white">privacy policy</Link>.
      </p>
    </ArticleLayout>
  );
}
