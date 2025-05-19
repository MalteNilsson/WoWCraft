'use client';

import { useState, useMemo, useEffect } from 'react';
import rawRecipes  from '@/data/recipes/enchanting.json';
import priceRows   from '@/data/prices/realm-559.json';
import type { RawRecipe, Recipe, PriceMap, MaterialInfo } from '@/lib/types';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceLine, Customized  } from "recharts";
import { makeDynamicPlan, PlanStep } from '@/lib/planner';
import { expectedSkillUps } from '@/lib/recipeCalc';
import { toPriceMap }      from '@/lib/pricing';
import * as Slider         from '@radix-ui/react-slider';
import { Range, getTrackBackground } from 'react-range';
import Fuse from 'fuse.js';
import { Combobox } from '@headlessui/react';
import tradeMaterials from '@/data/materials/tradeMaterials.json';
import { FormatMoney } from '@/lib/utils';

// map WoW quality IDs to standard hex colors
const qualityColors: Record<number,string> = {
  0: '#9d9d9d', // poor (gray)
  1: '#ffffff', // common (white)
  2: '#1eff00', // uncommon (green)
  3: '#0070dd', // rare (blue)
  4: '#a335ee', // epic (purple)
  5: '#ff8000'  // legendary (orange)
  };

const professions = [
  'All Professions',
  'Alchemy',
  'Blacksmithing',
  'Enchanting',
  'Engineering',
  'Leatherworking',
  'Tailoring',
  'Herbalism',
  'Mining',
  'Skinning'
];

// ── normalize once ──
const recipes: Recipe[] = (rawRecipes as any[]).map(r => {
  // 1) pull out (and discard) the raw `quality` field
  const { quality: _badQuality, materials: _rawMats, ...base } = r;

  // 2) rebuild your materials map
  const materials: Record<string, number> = {};
  for (const [id, qty] of Object.entries(_rawMats)) {
    if (typeof qty === 'number' && qty > 0) {
      materials[id] = qty;
    }
  }
  // 3) determine a clean, numeric quality
  const quality = typeof (_badQuality) === 'number' ? _badQuality : 1;

  // 4) return exactly the Recipe shape
  return {
    ...base,       // id, name, minSkill, difficulty
    quality,       // must be a number now
    materials,     // your filtered map
  };
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
      // find the first crafting step (skip any upgradeName-only steps)
      const firstCraft = steps.find( (s): s is Extract<PlanStep, { recipe: Recipe }> => 'recipe' in s );
      if (firstCraft) { setSelectedRecipeId(firstCraft.recipe.id); }
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

  const [rngLow, setRngLow]   = useState( selected ? selected.minSkill : 1 );
  const [rngHigh, setRngHigh] = useState( selected ? (selected.difficulty.gray||selected.minSkill) : 300 );

  const sliderMin = selected?.minSkill            ?? 1;
  const sliderMax = selected?.difficulty.gray     ?? 300;

  const clampedLow  = Math.max(sliderMin, Math.min(rngLow,  sliderMax));
  const clampedHigh = Math.max(sliderMin, Math.min(rngHigh, sliderMax));

  const totalLevelUps = Math.max(0, clampedHigh - clampedLow);
  const avgSuccessRate = useMemo(() => {
    if (!selected || totalLevelUps <= 0) return 0;
    let sum = 0;
    for (let lvl = clampedLow; lvl < clampedHigh; lvl++) {
      sum += expectedSkillUps(selected, lvl);
    }
    return sum / totalLevelUps;
  }, [selected, clampedLow, clampedHigh, totalLevelUps]);

  const avgAttempts = avgSuccessRate > 0 ? Math.ceil(1 / avgSuccessRate) : Infinity;

  useEffect(() => {
    if (selected && view === 'all') {
      setRngLow(selected.minSkill);
      setRngHigh(selected.difficulty.gray!);
    }
  }, [selected, view]);

  const probData = useMemo(() => {
    if (!selected) return [];
    const start = selected.minSkill;
    const end   = selected.difficulty.gray ?? start;
    const data  = [];
    for (let skill = start; skill <= end; skill++) {
      data.push({ skill, chance: expectedSkillUps(selected, skill) });
    }
    return data;
  }, [selected]);

  // drop the very first and last skill so we omit the edges
  const innerSkills  = probData.slice(1, -1).map(d => d.skill);
  // only draw 25%, 50%, 75% on the Y axis
  const innerChances = [0.25, 0.5, 0.75];

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

  useEffect(() => {
    if (!selected) return;
    const min = selected.minSkill;
    const max = selected.difficulty.gray ?? min;
    setRngLow(current => Math.max(min, Math.min(current, max)));
    setRngHigh(current => Math.max(min, Math.min(current, max)));
  }, [selected]);

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

  //const [matInfo, setMatInfo] = useState<Record<string,{name:string;icon:string|null}>>({});

  // Use pre-scraped material names and icons from JSON + /public/icons/materials
  const materialMap: Record<string, MaterialInfo> = tradeMaterials;

  const renderDifficultyDot = (props: any) => {
    if (!selected) return null;
    // some versions of Recharts pass x/y, others cx/cy
    const cx = props.cx ?? props.x;
    const cy = props.cy ?? props.y;
    const skill = props.payload.skill as number;
  
    // pull in the thresholds
    const { yellow, green, gray } = selected.difficulty;
  
    // pick the fill color in the correct order:
    let fill: string;
    if (skill < yellow!) {
      // below yellow = orange
      fill = '#ff8000';
    } else if (skill < green!) {
      // between yellow and green = yellow
      fill = '#ffff00';
    } else if (skill < gray!) {
      // between green and gray = green
      fill = '#1eff00';
    } else {
      // at or above gray = grey
      fill = '#9d9d9d';
    }
  
    return <circle cx={cx} cy={cy} r={2} fill={fill} />;
  };

  const xTicks = selected
    ? [selected.difficulty.orange,
        selected.difficulty.yellow,
        selected.difficulty.green,
        selected.difficulty.gray]
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b)
    : [];

  const renderXTick = selected
    ? (props: any) => {
        const { x, y, payload } = props;
        const v: number = payload.value;
        let fill = '#fff';
        if      (v === selected.difficulty.orange) fill = '#ff8000';
        else if (v === selected.difficulty.yellow) fill = '#ffff00';
        else if (v === selected.difficulty.green ) fill = '#1eff00';
        else if (v === selected.difficulty.gray  ) fill = '#9d9d9d';
        return (
          <text x={x} y={y+15} textAnchor="middle" fontSize={10} fill={fill}>
            {v}
          </text>
        );
      }
    : undefined;

    
  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="h-24 flex items-center gap-4 bg-neutral-800 border-b border-neutral-700 px-8 lg:px-32">
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
            className="w-full bg-neutral-700 rounded px-3 py-1 text-[16px]
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
                  `cursor-pointer px-3 py-1 text-[16px] ${
                    active ? 'bg-green-600 text-white' : 'text-neutral-100'
                  }`
                }
              >
                {r.name}
              </Combobox.Option>
            ))}

            {searchTerm && filteredRecipes.length === 0 && (
              <div className="px-3 py-1 text-[16px] text-neutral-400">
                No matches.
              </div>
            )}
          </Combobox.Options>
        </Combobox>
        <select className="bg-neutral-700 rounded px-2 py-1 text-[16px]">
          <option>Anniversary</option><option>Hardcore</option><option>Classic Era</option>
        </select>
        <select className="bg-neutral-700 rounded px-2 py-1 text-[16px]">
          <option>Alliance</option><option>Horde</option>
        </select>
      </header>

      {/* Panels */}
      <div className="flex flex-1 min-h-0">
        {/* Aside */}
        <aside className="w-150 lg:w-150 flex flex-col overflow-y-auto bg-neutral-800 border-r border-neutral-700 text-[16px]">
          {/* Slider + Tabs */}
          <div className="sticky top-0 z-30 bg-neutral-900 px-3 pt-6 pb-2">
          <select
            className="w-full bg-neutral-700 text-white text-sm rounded px-2 py-1 focus:outline-none mb-5"
            onChange={(e) => console.log('Selected:', e.target.value)}
          >
            <option value="">Select Profession</option>
            {professions.map((prof) => (
              <option key={prof} value={prof}>{prof}</option>
            ))}
          </select>




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

                if ('upgradeName' in s) {
                  return (
                      <div key={i} className="relative flex items-center justify-center gap-1 bg-neutral-900 rounded-none px-2 py-1 w-full h-15 font-bold text-yellow-400">
                      ⚙️ {s.note ?? `Upgrade to ${s.upgradeName}`}
                      </div>
                    );
                  }

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
                      className={`relative flex items-center gap-1 bg-neutral-900 rounded-none px-2 py-1 w-full h-15
                        ${selectedCardKey === primaryKey ? 'ring-2 ring-green-400' : ''}`}
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                        diffColor(skill, best.difficulty)
                      }`} />
                      <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[16px] flex items-center justify-center w-8">
                        {s.crafts}×
                      </span>
                      <img src={iconSrc(best.id)} alt="" className="w-7 h-7 rounded object-cover" />
                      <span 
                        className="truncate whitespace-nowrap flex-1 text-[16px]"
                        style={{ color: qualityColors[s.recipe.quality] }}>
                        {best.name.length <= 35 ? best.name : `${best.name.slice(0, 33)}…`}
                      </span>
                      <span className="text-[16px]">
                        <FormatMoney copper={s.crafts * calcCraftCost(best)} />
                      </span>
                      <span className="flex-shrink-0 w-24 text-center bg-neutral-700 text-[16px] px-0 py-0 rounded-full">
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
                          setRngLow(start);
                          setRngHigh(end);
                        }}
                        className="relative flex items-center gap-1 bg-neutral-900 rounded-none pl-3 pr-2 py-0.5 w-11/12 ml-auto cursor-pointer h-15"
                      >
                        <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                          diffColor(skill, alt.recipe.difficulty)
                        }`} />
                        <span className="bg-neutral-700 rounded-full px-1 py-0.5 text-[16px]">
                          or {alt.crafts}×
                        </span>
                        <img
                          src={iconSrc(alt.recipe.id)}
                          alt=""
                          className="w-7 h-7 rounded object-cover"
                        />
                        <span 
                          className="truncate whitespace-nowrap flex-1 text-[16px]"
                          style={{ color: qualityColors[s.recipe.quality] }}>
                          {alt.recipe.name.length <= 35
                            ? alt.recipe.name
                            : `${alt.recipe.name.slice(0, 33)}…`}
                        </span>
                        <span className="text-[16px]">
                          <FormatMoney copper={alt.cost} />
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
                  className={`relative flex items-center gap-1 bg-neutral-900 rounded-none px-2 py-1 h-15 ${
                    selectedRecipeId === r.id ? 'ring-2 ring-green-400' : ''
                  }`}
                >
                  <span
                    className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                      diffColor(skill, r.difficulty)
                    }`}
                  />
                  <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[16px] flex items-center justify-center w-8">
                    {r.minSkill}
                  </span>
                  <img
                    src={iconSrc(r.id)}
                    alt=""
                    className="w-7 h-7 rounded object-cover"
                  />
                  <span 
                    className="truncate whitespace-nowrap flex-1 text-[16px]"
                    style={{ color: qualityColors[r.quality ?? 1] }}>
                    {r.name.length <= 40 ? r.name : `${r.name.slice(0,37)}…`}
                  </span>
                </div>
              ))
            }
          </section>

          {/* Footer */}
          {view === 'route' && (
            <footer className="sticky bottom-0 z-30 bg-neutral-800 px-3 py-2 border-t border-neutral-700 text-center text-[24px] font-semibold ">
             Estimated Total Cost <FormatMoney copper={totalCost} /> g
            </footer>
          )}
        </aside>
        
        {/* Main panel */}
        <main className="frelative z-0 flex flex-col flex-1 h-full overflow-y-auto focus:outline-none xl:order-last">
        {!selected ? (
          <p className="text-neutral-400">Click a recipe to view details.</p>
        ) : (
          <div className="flex-1 w-full max-w-4xl py-12 mx-auto sm:px-6 lg:max-w-5xl lg:px-8">
            <div className="flex-none items-center -ml-0.5 sm:-ml-1.5">
              <div className="flex pb-5 text-[28px] items-center">
                <img
                  src={iconSrc(selected.id)}
                  alt={`${selected.name} icon`}
                  className="w-8 h-8 rounded mr-2 flex-shrink-0"
                />
                <a
                  href={`https://www.wowhead.com/classic/spell=${selected.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline text-green-300"
                  style={{ color: qualityColors[selected.quality ?? 1] }}
                >
                  {selected.name}
                </a>
              </div>
              <div className="flex-none">
                <div className="">Requires skill <strong>{selected.minSkill}</strong></div>  
                <div className="">Gray at <strong>{selected.difficulty.gray}</strong></div>
              </div>
            </div>
        
            <div className="mt-6 sm:border border-gray-700 bg-neutral-800 rounded-lg shadow-lg mt-12 pb-12">
            
              <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 border-t border-b border-gray-700 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Level-up Calculator</h3>
              </div>
                <div className="flex flex-row flex-nowrap gap-8 w-full h-full">
                  <div className="w-2/3 relative p-8" style={{ height: 350 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={probData} margin={{ top: 0, right: 0, bottom: 0, left: -60 }}>
                        <CartesianGrid
                          vertical={false}
                          horizontal={false}
                        />
                        <ReferenceLine
                          y={0.25}
                          stroke="#ccc"
                          strokeDasharray="3 3"
                        />
                        <ReferenceLine
                          y={0.50}
                          stroke="#ccc"
                          strokeDasharray="3 3"
                        />
                        <ReferenceLine
                          y={0.75}
                          stroke="#ccc"
                          strokeDasharray="3 3"
                        />
                        <XAxis
                          dataKey="skill"
                          domain={[ 'dataMin', 'dataMax' ]}
                          type="number"
                          axisLine={false}
                          tickLine={false}
                          ticks={xTicks}
                          tick={renderXTick}
                          //allowDataOverflow={false}
                          //label={{ value: "Skill Level", position: "insideBottomRight", offset: -10 }}
                        />
                        <YAxis
                          domain={[0, 1]}
                          tick={false}
                          tickLine={false}
                          axisLine={false}
                          //tickFormatter={v => `${Math.round(v * 100)}%`}
                          //label={{ value: "Chance to Skill-Up", angle: -90, position: "insideLeft" }}
                        />
                        <Customized
                          component={({ xAxisMap, yAxisMap }: any) => {
                            if (!selected || !probData.length) return null;

                            // grab the primary linear scales
                            const xScale = xAxisMap[0].scale;
                            const yScale = yAxisMap[0].scale;

                            // compute the screen coords
                            const lowX  = xScale(clampedLow);
                            const highX = xScale(clampedHigh);
                            const lowY  = yScale(expectedSkillUps(selected, clampedLow));
                            const highY = yScale(expectedSkillUps(selected, clampedHigh));
                            const y0    = yScale(0);

                            return (
                              <g>
                                {/* lower slider guide */}
                                <line
                                  x1={lowX}  y1={lowY}
                                  x2={lowX}  y2={y0}
                                  stroke="#888"
                                  //strokeDasharray="4 4"
                                  strokeWidth={1}
                                />
                                {/* upper slider guide */}
                                <line
                                  x1={highX} y1={highY}
                                  x2={highX} y2={y0}
                                  stroke="#888"
                                  //strokeDasharray="4 4"
                                  strokeWidth={1}
                                />
                              </g>
                            );
                          }}
                        />
                        <ReferenceArea
                          x1={clampedLow}
                          x2={clampedHigh}
                          fill="rgba(30,255,0,0.2)"
                        />
                        <Line
                          type="monotone"
                          dataKey="chance"
                          stroke="none"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Customized
                          component={({
                            // these props give you access to the internal scales
                            xAxisMap, yAxisMap,
                          }: any) => {
                            if (!selected || !probData.length) return null;

                            // grab the two axes (use your actual axis ID if you set one)
                            const xScale = xAxisMap[0].scale;
                            const yScale = yAxisMap[0].scale;

                            // build a single path: for each point we move to (M) and draw a circle via two arcs
                            const r = 2;  // half the previous 4px
                            const { orange, yellow, green, gray } = selected.difficulty;

                            const buildPath = (points: typeof probData) => points.map(({ skill, chance }) => {
                              const x = xScale(skill);
                              const y = yScale(chance);
                              return `M${x},${y} m-${r},0 a${r},${r} 0 1,0 ${2*r},0 a${r},${r} 0 1,0 -${2*r},0`;
                            }).join(' ');

                            const orangePts = probData.filter(d => d.skill < yellow!);
                            const yellowPts = probData.filter(d => d.skill >= yellow! && d.skill < green!);
                            const greenPts  = probData.filter(d => d.skill >= green!  && d.skill < gray!);
                            const grayPts   = probData.filter(d => d.skill >= gray!);

                            return (
                              <g>
                                <path d={buildPath(orangePts)} stroke="none" fill="#ff8000" />
                                <path d={buildPath(yellowPts)} stroke="none" fill="#ffff00" />
                                <path d={buildPath(greenPts)}  stroke="none" fill="#1eff00" />
                                <path d={buildPath(grayPts)}   stroke="none" fill="#9d9d9d" />
                              </g>
                            );
                          }}
                        />
                      </LineChart>
                      
                    </ResponsiveContainer>
                    <div className="relative bottom-7">
                      <Range
                        values={[clampedLow, clampedHigh]}
                        step={1}
                        min={sliderMin}
                        max={sliderMax}
                        onChange={([low, high]) => {
                          setRngLow(low);
                          setRngHigh(high);
                        }}
                        renderTrack={({ props, children }) => {
                          // extract key so we don’t spread it
                          const { key, style, ...rest } = props as any;
                          return (
                            <div
                              key={key}
                              {...rest}
                              style={{
                                ...style,
                                height: '2px',
                                borderRadius: '2px',
                                background: getTrackBackground({
                                  values: [rngLow, rngHigh],
                                  colors: ['#ddd', '#1eff00', '#ddd'],
                                  min: selected.minSkill,
                                  max: selected.difficulty.gray!
                                }),
                                pointerEvents: 'auto'
                              }}
                            >
                              {children}
                            </div>
                          );
                        }}
                        renderThumb={({ props, index }) => {
                          const { key, style, ...rest } = props;
                          return (
                            <div
                              key={key}
                              {...rest}
                              style={{
                                ...style,
                                height: '12px',
                                width: '12px',
                                borderRadius: '6px',
                                backgroundColor: '#fff',
                                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                                pointerEvents: 'auto'
                              }}
                            >
                            </div>
                          );
                        }}
                      />
                    </div>
                    
                  </div> {/* end chart container */} 

                  <aside className="flex-none w-1/3 bg-neutral-800 p-4 rounded-lg">
                    <div className="space-y-4 text-[16px] text-neutral-200 py-5 pr-8">
                      <div className="flex justify-between items-center">
                        <span>Total Level-ups</span>
                        <span className="font-semibold">{totalLevelUps}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Avg Success Rate</span>
                        <span className="font-semibold">{(avgSuccessRate * 100).toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span>Avg Attempts Required</span>
                          <span className="text-white rounded px-2 font-semibold">{(Object.values(materialTotals).reduce((s,m)=>s+m.qty,0))}</span>
                      </div>
                      <div className="flex justify-between items-center">
                          <span>Total materials cost:</span>
                          <span className="text-white rounded px-2 font-semibold"><FormatMoney copper={(Object.values(materialTotals).reduce((s,m)=>s+m.cost,0))} /></span>
                      </div>
                    </div>
                  </aside>

                  
                </div>

                

                {/* Expected crafts */}
                <div className="px-6">
                  <table className="w-full text-[16px] border-collapse">
                    <tbody>
                    {Object.entries(materialTotals).map(([id, {qty, cost}]) => {
                        const info: MaterialInfo = materialMap[id] ?? { name: `Item ${id}`, quality: null };
                        const iconUrl = `/icons/materials/${id}.jpg`;

                        return (
                          <tr key={id}>
                            <td   
                              className="py-1 flex items-center gap-1"
                              style={{ color: qualityColors[info.quality ?? 1] }}>
                              <img src={iconUrl} alt={info.name} className="w-4 h-4" />
                              <span>{info.name}</span>
                            </td>
                            <td className="py-1 text-right">{qty.toFixed(1)}</td>
                            <td className="py-1 text-right"><FormatMoney copper={cost} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
            </div>
          </div>
          )}
        </main>
      </div>
    </div>
  );
}