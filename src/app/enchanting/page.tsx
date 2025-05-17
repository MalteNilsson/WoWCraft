'use client';

import { useState, useMemo, useEffect } from 'react';
import rawRecipes  from '@/data/recipes/enchanting.json';
import priceRows   from '@/data/prices/realm-559.json';
import type { RawRecipe, Recipe, PriceMap } from '@/lib/types';
import { makeDynamicPlan } from '@/lib/planner';
import { expectedSkillUps } from '@/lib/recipeCalc';
import { toPriceMap }      from '@/lib/pricing';
import * as Slider         from '@radix-ui/react-slider';
import Fuse from 'fuse.js';
import { Combobox } from '@headlessui/react';

// ── normalize once ──
const recipes: Recipe[] = (rawRecipes as RawRecipe[]).map(r => {
  const m: Record<string, number> = {};
  for (const [id, q] of Object.entries(r.materials)) {
    if (typeof q === 'number' && q > 0) m[id] = q;
  }
  return { ...r, materials: m };
});
const prices: PriceMap = toPriceMap(priceRows as any);

// ── helpers ──
const diffColor = (skill: number, d: Recipe['difficulty']) => {
  if (skill < d.orange!) return 'bg-orange-500';
  if (skill < d.yellow!) return 'bg-yellow-500';
  if (skill < d.green!)  return 'bg-green-500';
  return 'bg-neutral-500';
};
const iconSrc = (id: number) => `/icons/enchanting/${id}.jpg`;

function expectedSkillUpsAt(X: number, d: Recipe['difficulty']): number {
  // correct formula: (greySkill – yourSkill) / (greySkill – yellowSkill)
  const G = d.gray!, Y = d.yellow!;
  return (G - X) / (G - Y);
}

function expectedCraftsBetween(
  low: number,
  high: number,
  d: Recipe['difficulty']
): number {
  let sum = 0;
  for (let lvl = low; lvl < high; lvl++) {
    const p = expectedSkillUpsAt(lvl, d);
    if (p > 0) {
      sum += Math.ceil(1 / p);
    }
  }
  return sum;
}

function calcCraftCost(rec: Recipe): number {
  let total = 0;
  for (const [id, qty] of Object.entries(rec.materials)) {
    const info = prices[id] ?? {};
    const unit = info.minBuyout ?? info.marketValue ?? 0;
    total += unit * qty;
  }
  return total;
}

// ── component ──
export default function EnchantingPlanner() {
  const [skill, setSkill]           = useState(1);
  const [view,  setView]            = useState<'route'|'all'>('route');
  const [selectedRecipeId, setSelectedRecipeId] = useState<number|null>(null);
  const [selectedCardKey, setSelectedCardKey]     = useState<string|null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fuse = useMemo(
    () => new Fuse(recipes, { keys: ['name'], threshold: 0.3 }),
    [recipes]
  );


  const { steps, totalCost, finalSkill } = useMemo(
    () => makeDynamicPlan(skill, 300, recipes, prices),
    [skill]
  );
  useEffect(() => {
    if (view === 'route' && steps.length > 0) {
      setSelectedRecipeId(steps[0].recipe.id);
    }
  }, [view, steps]);

  const startOf = (i: number) => (i === 0 ? skill : steps[i - 1].endSkill);
  const sortedAll = useMemo(() => [...recipes].sort((a,b)=>a.minSkill - b.minSkill), []);

  const filteredRecipes = useMemo(
    () =>
      searchTerm
        ? fuse.search(searchTerm).map(result => result.item)
        : sortedAll,
    [searchTerm, fuse, sortedAll]
  );

  const selected = useMemo<Recipe|null>(
    () => recipes.find(r => r.id === selectedRecipeId) ?? null,
    [selectedRecipeId]
  );

  const [rngLow, setRngLow]   = useState(1);
  const [rngHigh, setRngHigh] = useState(300);
  useEffect(() => {
    if (selected) {
      setRngLow(selected.minSkill);
      setRngHigh(selected.difficulty.gray!);
    }
  }, [selectedRecipeId]);

  useEffect(() => {
    if (view === 'route' && selectedRecipeId !== null) {
      const idx = steps.findIndex(s => s.recipe.id === selectedRecipeId);
      if (idx >= 0) {
        const start = idx === 0 ? skill : steps[idx - 1].endSkill;
        setRngLow(start);
        setRngHigh(steps[idx].endSkill);
      }
    }
  }, [selectedRecipeId, view]);

  useEffect(() => {
    if (selectedRecipeId !== null) {
      const el = document.getElementById(`recipe-${selectedRecipeId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedRecipeId])

  const expCrafts = useMemo(() => {
    if (!selected) return 0;
    // round up so crafts are always whole numbers
    return Math.ceil(
      expectedCraftsBetween(rngLow, rngHigh, selected.difficulty)
    );
  }, [rngLow, rngHigh, selected]);

  const materialTotals = useMemo(() => {
    if (!selected) return {};
    const out: Record<string,{qty:number;cost:number}> = {};
    for (const [id, perCraft] of Object.entries(selected.materials)) {
      const qty = perCraft * expCrafts;
      const unit = prices[id]?.minBuyout ?? prices[id]?.marketValue ?? 0;
      out[id] = { qty, cost: qty * unit };
    }
    return out;
  }, [selected, expCrafts]);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="h-14 flex items-center gap-4 bg-neutral-800 border-b border-neutral-700 px-8 lg:px-32">
        <span className="text-lg font-bold tracking-wide">WoWCraft</span>
        <Combobox
          onChange={(id: number) => {
            // switch to All Recipes and select
            setView('all');
            setSelectedRecipeId(id);
            // prefill slider for that recipe
            const r = recipes.find(r => r.id === id)!;
            setRngLow(r.minSkill);
            setRngHigh(Math.min(300, r.difficulty.gray!));
            setSearchTerm(''); // clear search
          }}
          as="div"
          className="relative flex-1 max-w-lg mx-auto"
        >
          <Combobox.Input
            className="w-full bg-neutral-700 rounded px-3 py-1 text-sm
                      text-neutral-100 placeholder-neutral-400 focus:outline-none"
            placeholder="Search for recipe"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Combobox.Options className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-neutral-800 rounded shadow-lg">
            {searchTerm && filteredRecipes.slice(0, 5).map((r) => (
              <Combobox.Option
                key={r.id}
                value={r.id}
                className={({ active }) =>
                  `cursor-pointer px-3 py-1 text-sm ${
                    active ? 'bg-green-600 text-white' : 'text-neutral-100'
                  }`
                }
              >
                {r.name}
              </Combobox.Option>
            ))}

            {searchTerm && filteredRecipes.length === 0 && (
              <div className="px-3 py-1 text-sm text-neutral-400">
                No matches.
              </div>
            )}
          </Combobox.Options>
        </Combobox>
        <select className="bg-neutral-700 rounded px-2 py-1 text-sm">
          <option>Anniversary</option><option>Hardcore</option><option>Classic Era</option>
        </select>
        <select className="bg-neutral-700 rounded px-2 py-1 text-sm">
          <option>Alliance</option><option>Horde</option>
        </select>
      </header>

      {/* Panels */}
      <div className="flex flex-1 min-h-0">
        {/* Aside */}
        <aside className="w-72 lg:w-80 flex flex-col overflow-y-auto bg-neutral-800 border-r border-neutral-700 text-xs">
          {/* Slider + Tabs */}
          <div className="sticky top-0 z-30 bg-neutral-800 px-3 pt-6 pb-2">
            <label className="block text-xs uppercase mb-1">
              Skill <span className="font-semibold">{skill}</span>
            </label>
            <input type="range" min={1} max={300} value={skill}
              onChange={e=>setSkill(+e.target.value)}
              className="w-full accent-green-500 mb-4"
            />
            <div className="flex space-x-1">
              <button onClick={()=>setView('route')}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-t
                  ${view==='route'? 'bg-neutral-700 text-white':'bg-neutral-800 text-neutral-400'}`}
              >Optimal</button>
              <button onClick={()=>setView('all')}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-t
                  ${view==='all'? 'bg-neutral-700 text-white':'bg-neutral-800 text-neutral-400'}`}
              >All Recipes</button>
            </div>
          </div>

          {/* List */}
          <section className="flex-1 overflow-y-auto px-3 space-y-px pt-4 pb-6">
            {view==='route'
              ? steps.map((s, i) => {
                const start = i === 0 ? skill : steps[i - 1].endSkill;
                const end   = s.endSkill;
                const best  = s.recipe;
                const primaryKey = `primary-${i}-${best.id}`;
              
                // calculate best CPU
                const pBest    = expectedSkillUps(best, start);
                const costBest = calcCraftCost(best);
                const cpuBest  = costBest / pBest;
              
                // find up to two alternatives within 20%
                const candidates = recipes
                // must be unlocked at 'start' and remain usable through 'end'
                .filter(r =>
                  r.minSkill <= start &&
                  (r.difficulty.gray ?? Infinity) >= end &&
                  r.id !== best.id
                )
                .map(r => {
                  const crafts = expectedCraftsBetween(start, end, r.difficulty);
                  const cost   = crafts * calcCraftCost(r);
                  return {
                    recipe: r,
                    crafts,
                    cost,
                    cpu: cost / (end - start),
                  };
                })
                .sort((a, b) => a.cpu - b.cpu)
                .slice(0, 2);
              
                return (
                  <div key={best.id} className="flex flex-col w-full space-y-px">
              
                    {/* Primary card */}
                    <div
                      id={primaryKey}
                      onClick={() => {
                        setSelectedRecipeId(best.id);
                        setSelectedCardKey(primaryKey);
                        setRngLow(start);
                        setRngHigh(end);
                      }}
                      className={`relative flex items-center gap-1 bg-neutral-900 rounded-none px-2 py-1 w-full
                        ${selectedCardKey === primaryKey ? 'ring-2 ring-green-400' : ''}`}
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                        diffColor(skill, best.difficulty)
                      }`} />
                      <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[9px] flex items-center justify-center w-8">
                        {s.crafts}×
                      </span>
                      <img src={iconSrc(best.id)} alt="" className="w-3 h-3 rounded object-cover" />
                      <span className="truncate whitespace-nowrap flex-1 text-[9px]">
                        {best.name.length <= 35 ? best.name : `${best.name.slice(0, 33)}…`}
                      </span>
                      <span className="text-[9px]">
                        {(s.crafts * calcCraftCost(best) / 10000).toFixed(2)} g
                      </span>
                      <span className="flex-shrink-0 w-16 text-center bg-neutral-700 text-[9px] px-0 py-0 rounded-full">
                        {start} → {end}
                      </span>
                    </div>
              
                    {/* Alternative cards (up to 2) */}
                    {(selectedCardKey === primaryKey || selectedCardKey?.startsWith(`alt-${i}-`)) && candidates.map((alt, ai) => {
                      const altKey = `alt-${i}-${ai}-${alt.recipe.id}`;
                      return (
                      <div
                        key={altKey}
                        id={altKey}
                        onClick={() => {
                          setSelectedRecipeId(alt.recipe.id); 
                          setSelectedCardKey(altKey);
                          setRngLow(alt.recipe.minSkill);
                          setRngHigh(alt.recipe.difficulty.gray!);
                        }}
                        className="relative flex items-center gap-1 bg-neutral-900 rounded-none pl-3 pr-2 py-0.5 w-11/12 ml-auto cursor-pointer"
                      >
                        <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                          diffColor(skill, alt.recipe.difficulty)
                        }`} />
                        <span className="bg-neutral-700 rounded-full px-1 py-0.5 text-[9px]">
                          or {alt.crafts}×
                        </span>
                        <img
                          src={iconSrc(alt.recipe.id)}
                          alt=""
                          className="w-3 h-3 rounded object-cover"
                        />
                        <span className="truncate whitespace-nowrap flex-1 text-[9px]">
                          {alt.recipe.name.length <= 35
                            ? alt.recipe.name
                            : `${alt.recipe.name.slice(0, 33)}…`}
                        </span>
                        <span className="text-[9px]">
                          {(alt.cost / 10000).toFixed(2)} g
                        </span>
                      </div>
                      );
                    })}
                  </div>
                );
              })
              : sortedAll.map((r) => (
                <div
                  key={r.id}
                  onClick={() => {
                    setSelectedRecipeId(r.id);
                    setRngLow(r.minSkill);
                    setRngHigh(r.difficulty.gray!);
                  }}
                  id={`recipe-${r.id}`}    // now correctly uses r.id
                  className={`relative flex items-center gap-1 bg-neutral-900 rounded-none px-2 py-1 ${
                    selectedRecipeId === r.id ? 'ring-2 ring-green-400' : ''
                  }`}
                >
                  <span
                    className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                      diffColor(skill, r.difficulty)
                    }`}
                  />
                  <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[9px] flex items-center justify-center w-8">
                    {r.minSkill}
                  </span>
                  <img
                    src={iconSrc(r.id)}
                    alt=""
                    className="w-3 h-3 rounded object-cover"
                  />
                  <span className="truncate whitespace-nowrap flex-1 text-[9px]">
                    {r.name.length <= 27 ? r.name : `${r.name.slice(0,24)}…`}
                  </span>
                </div>
              ))
            }
          </section>

          {/* Footer */}
          {view === 'route' && (
            <footer className="sticky bottom-0 z-30 bg-neutral-800 px-3 py-2 border-t border-neutral-700 text-center text-xs font-semibold">
              Total {(totalCost/10000).toFixed(2)} g | Ends {finalSkill}
            </footer>
          )}
        </aside>

        {/* Main panel */}
        <main className="flex-1 h-full overflow-y-auto bg-neutral-950 p-8">
          {!selected ? (
            <p className="text-neutral-400">Click a recipe to view details.</p>
          ) : (
            <section className="space-y-6">
              {/* Title now a link */}
              <h2 className="text-2xl font-bold">
                <a
                  href={`https://www.wowhead.com/classic/spell=${selected.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline text-green-300"
                >
                  {selected.name}
                </a>
              </h2>

              {/* thresholds & slider */}
              <p>Requires skill <strong>{selected.minSkill}</strong>  |  Gray at <strong>{selected.difficulty.gray}</strong></p>

              <div className="relative h-8 overflow-visible">
                <Slider.Root
                  className="relative z-10 flex items-center select-none w-full h-6"
                  value={[rngLow, rngHigh]}
                  min={Math.max(1, selected.minSkill)}
                  max={Math.min(300, selected.difficulty.gray!)}
                  step={1}
                  onValueChange={([low, high]) => {
                    if (high - low >= 1) {
                      setRngLow(low)
                      setRngHigh(high)
                    }
                  }}
                >
                  <Slider.Track className="relative bg-neutral-700 flex-1 h-1 rounded">
                    <Slider.Range className="absolute bg-green-600/50 h-full rounded" />
                  </Slider.Track>
                  <Slider.Thumb className="block w-4 h-4 bg-neutral-100 rounded-full shadow-md" />
                  <Slider.Thumb className="block w-4 h-4 bg-neutral-100 rounded-full shadow-md" />
                </Slider.Root>

                {/* Low value label */}
                <div
                  className="absolute -top-4 text-xs font-medium text-neutral-100"
                  style={{
                    left: `${
                      ((rngLow - selected.minSkill) /
                        (selected.difficulty.gray! - selected.minSkill)) *
                      100
                    }%`,
                    transform: 'translateX(-50%)'
                  }}
                >
                  {rngLow}
                </div>

                {/* High value label */}
                <div
                  className="absolute -top-4 text-xs font-medium text-neutral-100"
                  style={{
                    left: `${
                      ((rngHigh - selected.minSkill) /
                        (selected.difficulty.gray! - selected.minSkill)) *
                      100
                    }%`,
                    transform: 'translateX(-50%)'
                  }}
                >
                  {rngHigh}
                </div>
              </div>

              {/* Expected crafts */}
              <p>
                Expected crafts: <strong>{expCrafts}</strong>
              </p>

              {/* Materials summary */}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-700">
                    <th className="text-left pb-1">Item ID</th>
                    <th className="text-right pb-1">Qty</th>
                    <th className="text-right pb-1">Cost (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(materialTotals).map(([id,{qty,cost}])=>(
                    <tr key={id} className="border-b border-neutral-800">
                      <td className="py-1">{id}</td>
                      <td className="py-1 text-right">{qty.toFixed(1)}</td>
                      <td className="py-1 text-right">{(cost/10000).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Total cost */}
              <p className="pt-2 font-semibold">
                Total materials cost:&nbsp;
                {(Object.values(materialTotals).reduce((s,m)=>s+m.cost,0)/10000).toFixed(2)} g
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}