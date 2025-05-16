'use client';

import { useState, useMemo } from 'react';
import rawRecipes  from '@/data/recipes/enchanting.json';
import priceRows   from '@/data/prices/realm-559.json';
import type { RawRecipe, Recipe, PriceMap } from '@/lib/types';
import { makeDynamicPlan } from '@/lib/planner';
import { toPriceMap } from '@/lib/pricing';

/* normalize recipes */
const recipes: Recipe[] = (rawRecipes as RawRecipe[]).map(r => {
  const m: Record<string, number> = {};
  for (const [id, q] of Object.entries(r.materials)) {
    if (typeof q === 'number' && q > 0) m[id] = q;
  }
  return { ...r, materials: m };
});
const prices: PriceMap = toPriceMap(priceRows as any);

/* helpers */
const diffColor = (skill: number, d: Recipe['difficulty']) => {
  if (skill < d.orange) return 'bg-orange-500';
  if (skill < d.yellow) return 'bg-yellow-500';
  if (skill < d.green)  return 'bg-green-500';
  return 'bg-neutral-700';
};
const iconSrc = (id: number) => `/icons/enchanting/${id}.jpg`;

/* component */
export default function EnchantingPlanner() {
  const [skill, setSkill] = useState(1);

  const { steps, totalCost, finalSkill } = useMemo(
    () => makeDynamicPlan(skill, 300, recipes, prices),
    [skill]
  );

  const startOf = (i: number) => (i === 0 ? skill : steps[i - 1].endSkill);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      {/* Topbar */}
      <header className="h-14 flex items-center gap-4 bg-neutral-800 border-b border-neutral-700 px-8 lg:px-32">
        <span className="text-lg font-bold tracking-wide">WoWCraft</span>
        <input
          type="search"
          placeholder="Search…"
          className="flex-1 max-w-lg mx-auto bg-neutral-800 rounded px-3 py-1 text-sm focus:outline-none"
        />
        <div className="flex items-center gap-2 ml-auto">
          <select
            className="bg-neutral-800 rounded px-2 py-1 text-sm"
            /* realm logic */
          >
            {/* …options… */}
          </select>
          <select
            className="bg-neutral-800 rounded px-2 py-1 text-sm"
            /* faction logic */
          >
            {/* …options… */}
          </select>
        </div>
      </header>

      {/* Main row */}
      <div className="flex flex-1 min-h-0 px-8 lg:px-32">
        {/* Left sidebar */}
        <aside className="w-80 lg:w-96 flex flex-col overflow-y-auto bg-neutral-800 border-r border-neutral-700">
          {/* sidebar header */}
          <div className="sticky top-0 z-30 bg-neutral-900 px-4 pt-6 pb-4">
            <label className="block text-xs uppercase tracking-wide mb-1">
              Skill <span className="font-semibold">{skill}</span>
            </label>
            <input
              type="range"
              min={1}
              max={300}
              value={skill}
              onChange={(e) => setSkill(+e.target.value)}
              className="w-full accent-green-500"
            />
          </div>

          {/* scrollable steps */}
          <section className="flex-1 overflow-y-auto px-4 space-y-2 pt-5 pb-6">
            {steps.map((s, i) => (
              <div key={i} className="relative">
                {/* skill chip */}
                <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2
                                 bg-neutral-700 text-[10px] px-2 py-0.5 rounded-full
                                 font-medium text-neutral-100 z-10">
                  {startOf(i)} → {s.endSkill}
                </span>

                {/* card */}
                <div className="relative flex items-center gap-2 bg-neutral-800 rounded-lg px-3 py-2 mt-0">
                  {/* difficulty bar */}
                  <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${diffColor(skill, s.recipe.difficulty)}`} />
                  {/* count pill */}
                  <span className="bg-neutral-900 rounded-full px-2 py-0.5 text-xs">
                    {s.crafts}×
                  </span>
                  {/* icon */}
                  <img
                    src={iconSrc(s.recipe.id)}
                    alt=""
                    className="w-6 h-6 rounded-md object-cover"
                  />
                  {/* name (truncated) */}
                  <a
                    href={`https://www.wowhead.com/classic/spell=${s.recipe.id}`}
                    className="truncate whitespace-nowrap flex-1 text-xs hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.recipe.name.length <= 27
                      ? s.recipe.name
                      : `${s.recipe.name.slice(0, 24)}…`}
                  </a>
                  {/* cost */}
                  <span className="text-xs">{(s.cost / 10000).toFixed(2)} g</span>
                </div>
              </div>
            ))}
          </section>

          {/* sticky footer */}
          <footer className="sticky bottom-0 z-30 bg-neutral-900 px-4 py-3 border-t border-neutral-800 text-center text-sm font-semibold">
            Total {(totalCost / 10000).toFixed(2)} g&nbsp;|&nbsp;Ends {finalSkill}
          </footer>
        </aside>

        {/* Right workspace */}
        <main className="flex-1 h-full overflow-y-auto bg-neutral-800 p-8">
          <div className="h-full rounded-lg border border-neutral-700 flex items-center justify-center text-neutral-400">
            Main workspace – add comparisons, charts, etc.
          </div>
        </main>
      </div>
    </div>
  );
}