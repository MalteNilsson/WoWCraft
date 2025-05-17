'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import rawRecipes  from '@/data/recipes/enchanting.json';
import priceRows   from '@/data/prices/realm-559.json';
import type { RawRecipe, Recipe, PriceMap } from '@/lib/types';
import { makeDynamicPlan } from '@/lib/planner';
import { toPriceMap }      from '@/lib/pricing';
import * as Slider from '@radix-ui/react-slider';

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

function calcCraftCost(recipe: Recipe): number {
  let total = 0;
  for (const [id, qty] of Object.entries(recipe.materials)) {
    const info = prices[id] ?? {};
    const unit = info.minBuyout ?? info.marketValue ?? 0;
    total += unit * qty;
  }
  return total;
}

// expectedSkillUps probability at a single skill level X
function expectedSkillUpsAt(X: number, d: Recipe['difficulty']): number {
  // formula: (G - X) / (G - Y)
  const G = d.gray!, Y = d.orange!;
  return (G - X) / (G - Y);
}

// expected total crafts to go from level low → high
function expectedCraftsBetween(
  low: number,
  high: number,
  d: Recipe['difficulty']
): number {
  let sum = 0;
  for (let lvl = low; lvl < high; lvl++) {
    const p = expectedSkillUpsAt(lvl, d);
    if (p > 0) sum += 1 / p;
  }
  return sum;
}

// ── component ──
export default function EnchantingPlanner() {
  const [skill, setSkill]           = useState(1);
  const [view,  setView]            = useState<'route'|'all'>('route');
  const [selectedId, setSelectedId] = useState<number|null>(null);
  const [rngLow,  setRngLow]  = useState(1);
  const [rngHigh, setRngHigh] = useState(300);

  const { steps, totalCost, finalSkill } = useMemo(
    () => makeDynamicPlan(skill, 300, recipes, prices),
    [skill]
  );

  // clear selection when returning to route view
  useEffect(() => { if (view==='route') setSelectedId(null); }, [view]);

  const startOf = (i: number) => (i === 0 ? skill : steps[i - 1].endSkill);

  const sortedAll = useMemo(
    () => [...recipes].sort((a,b)=>a.minSkill - b.minSkill),
    []
  );

  const selected = useMemo<Recipe|null>(
    () => recipes.find(r => r.id === selectedId) ?? null,
    [selectedId]
  );


  // compute crafts & material totals
  const expCrafts = useMemo(() => {
    if (!selected) return 0;
    return expectedCraftsBetween(rngLow, rngHigh, selected.difficulty);
  }, [rngLow, rngHigh, selected]);

  const materialTotals = useMemo(() => {
    if (!selected) return {};
    const out: Record<string, { qty: number; cost: number }> = {};
    for (const [id, perCraft] of Object.entries(selected.materials)) {
      const totalQty = perCraft * expCrafts;
      const unit     = (prices[id]?.minBuyout ?? prices[id]?.marketValue ?? 0);
      out[id] = {
        qty:  totalQty,
        cost: totalQty * unit
      };
    }
    return out;
  }, [selected, expCrafts]);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="h-14 flex items-center gap-4 bg-neutral-800 border-b border-neutral-700 px-8 lg:px-32">
        <span className="text-lg font-bold tracking-wide">WoWCraft</span>
        <input type="search" placeholder="Search…"
          className="flex-1 max-w-lg mx-auto bg-neutral-700 rounded px-3 py-1 text-sm"
        />
        <select className="bg-neutral-700 rounded px-2 py-1 text-sm">
          <option>Anniversary</option>
          <option>Hardcore</option>
          <option>Classic Era</option>
        </select>
        <select className="bg-neutral-700 rounded px-2 py-1 text-sm">
          <option>Alliance</option>
          <option>Horde</option>
        </select>
      </header>

      {/* Panels */}
      <div className="flex flex-1 min-h-0">
        {/* Aside */}
        <aside className="w-56 lg:w-64 flex flex-col overflow-y-auto bg-neutral-800 border-r border-neutral-700 text-xs">
          {/* Slider+Tabs */}
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
                  ${view==='route'? 'bg-neutral-700 text-white' : 'bg-neutral-800 text-neutral-400'}`}
              >Optimal</button>
              <button onClick={()=>setView('all')}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-t
                  ${view==='all'? 'bg-neutral-700 text-white' : 'bg-neutral-800 text-neutral-400'}`}
              >All Recipes</button>
            </div>
          </div>

          {/* List */}
          <section className="flex-1 overflow-y-auto px-3 space-y-2 pt-4 pb-6">
            {view==='route' ? (
              steps.map((s,i) => (
                <div key={i} className="relative">
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2
                                   bg-neutral-700 text-[10px] px-2 py-0.5 rounded-full
                                   font-medium text-neutral-100 z-10">
                    {startOf(i)} → {s.endSkill}
                  </span>
                  <div onClick={()=>{
                      setSelectedId(s.recipe.id);
                      setRngLow(startOf(i));
                      setRngHigh(s.endSkill);
                    }}
                    className={`relative flex items-center gap-1 bg-neutral-900 rounded-lg px-2 py-1 mt-2
                      ${selectedId===s.recipe.id?'ring-2 ring-green-400':''}`}
                  >
                    <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                      diffColor(skill, s.recipe.difficulty)
                    }`} />
                    <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[10px]">
                      {s.crafts}×
                    </span>
                    <img src={iconSrc(s.recipe.id)} alt=""
                      className="w-5 h-5 rounded object-cover"
                    />
                    <a href={`https://www.wowhead.com/classic/spell=${s.recipe.id}`}
                      className="truncate whitespace-nowrap flex-1 text-[10px] hover:underline"
                      target="_blank" rel="noreferrer"
                    >
                      {s.recipe.name.length<=27
                        ? s.recipe.name
                        : `${s.recipe.name.slice(0,24)}…`}
                    </a>
                    <span className="text-[10px]">
                      {(calcCraftCost(s.recipe)/10000).toFixed(2)} g
                    </span>
                  </div>
                </div>
              ))
            ) : (
              sortedAll.map(r=>(
                <div key={r.id} onClick={() => {
                    setSelectedId(r.id);
                    setRngLow(r.minSkill);
                    setRngHigh(r.difficulty.gray!);
                  }}
                  className={`relative flex items-center gap-1 bg-neutral-900 rounded-lg px-2 py-1
                    ${selectedId===r.id?'ring-2 ring-green-400':''}`}
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                    diffColor(skill, r.difficulty)
                  }`} />
                  <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[10px]">
                    {r.minSkill}
                  </span>
                  <img src={iconSrc(r.id)} alt=""
                    className="w-5 h-5 rounded object-cover"
                  />
                  <a href={`https://www.wowhead.com/classic/spell=${r.id}`}
                    className="truncate whitespace-nowrap flex-1 text-[10px] hover:underline"
                    target="_blank" rel="noreferrer"
                  >
                    {r.name.length<=27?r.name:`${r.name.slice(0,24)}…`}
                  </a>
                </div>
              ))
            )}
          </section>

          {/* Footer */}
          <footer className="sticky bottom-0 z-30 bg-neutral-800 px-3 py-2 border-t border-neutral-700 text-center text-xs font-semibold">
            Total {(totalCost/10000).toFixed(2)} g | Ends {finalSkill}
          </footer>
        </aside>

        {/* Main panel */}
        <main className="flex-1 h-full overflow-y-auto bg-neutral-950 p-8">
          {!selected ? (
            <p className="text-neutral-400">Click a recipe to view details.</p>
          ) : (
            <section className="space-y-6">
              {/* Title & thresholds */}
              <div>
                <h2 className="text-2xl font-bold">{selected.name}</h2>
                <p>Requires skill <strong>{selected.minSkill}</strong></p>
                <p>Goes gray at <strong>{selected.difficulty.gray}</strong></p>
              </div>

              {/* Dual‐slider */}
              <div className="space-y-2">
                <label className="block text-sm">
                  Craft from <strong>{rngLow}</strong> to <strong>{rngHigh}</strong>
                </label>

                <Slider.Root
                  className="relative flex items-center select-none touch-none w-full h-6"
                  value={[rngLow, rngHigh]}
                  min={selected.minSkill}
                  max={selected.difficulty.gray!}
                  step={1}
                  onValueChange={([low, high]) => {
                    // enforce at least 1-unit gap
                    if (high - low >= 1) {
                      setRngLow(low);
                      setRngHigh(high);
                    }
                  }}
                >
                  <Slider.Track className="relative bg-neutral-700 flex-1 h-1 rounded">
                    <Slider.Range className="absolute bg-green-600/50 h-full rounded" />
                  </Slider.Track>

                  <Slider.Thumb className="block w-4 h-4 bg-neutral-100 rounded-full shadow-md" />
                  <Slider.Thumb className="block w-4 h-4 bg-neutral-100 rounded-full shadow-md" />
                </Slider.Root>
              </div>

              {/* Expected crafts */}
              <p>
                Expected crafts: <strong>{expCrafts.toFixed(1)}</strong>
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
                  {Object.entries(materialTotals).map(([id, {qty,cost}]) => (
                    <tr key={id} className="border-b border-neutral-800">
                      <td className="py-1">{id}</td>
                      <td className="py-1 text-right">{qty.toFixed(1)}</td>
                      <td className="py-1 text-right">{(cost/10000).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Total material cost */}
              <p className="pt-2 font-semibold">
                Total materials cost:&nbsp;
                {(Object.values(materialTotals).reduce((sum,m)=>sum + m.cost,0)/10000).toFixed(2)} g
              </p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
