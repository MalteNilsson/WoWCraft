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
import tradeMaterials from '@/data/materials/materials.json';
import { FormatMoney } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [target, setTarget]   = useState(300);
  const [view,  setView]            = useState<'route'|'all'>('route');
  const [selectedRecipeId, setSelectedRecipeId] = useState<number|null>(null);
  const [selectedCardKey, setSelectedCardKey]     = useState<string|null>(null);
  const [visibleCardKey, setVisibleCardKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fuse = useMemo(
    () => new Fuse(recipes, { keys: ['name'], threshold: 0.3 }),
    [recipes]
  );

  useEffect(() => {
    setRngLow(skill);
    setRngHigh(target);
  }, [skill, target]);


  const { steps, totalCost, finalSkill } = useMemo(
    () => makeDynamicPlan(skill, 300, recipes, prices),
    [skill]
  );

  useEffect(() => {
    const first = steps.find((s): s is Extract<PlanStep, { recipe: Recipe }> => 'recipe' in s);
    if (first) {
      setSelectedRecipeId(first.recipe.id);
      setSelectedCardKey(`primary-0-${first.recipe.id}`);
      setRngLow(skill);
      setRngHigh(first.endSkill);
    }
  }, [view, steps, skill]);

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

  const handleCardClick = (groupKey: string, cardKey: string, recipeId: number, start: number, end: number) => {
    setSelectedRecipeId(recipeId);       // for loading chart, etc.
    setSelectedCardKey(cardKey);         // to track the actual card
    setRngLow(start);
    setRngHigh(end);
  
    if (groupKey !== visibleCardKey) {
      setTimeout(() => {
        setVisibleCardKey(groupKey);
      }, 100);
    }
  };

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
          className="relative flex-1 max-w-2/3 mx-auto "
        >
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400 pointer-events-none"
            viewBox="0 0 18 18"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M3.7407 10.5782C1.85599 8.69306 1.85599 5.62599 3.7407 3.7409C4.68325 2.79835 5.9211 2.32727 7.15933 2.32727C8.39718 2.32727 9.63503 2.79835 10.578 3.7409C12.4627 5.62561 12.4627 8.69228 10.5784 10.5774C10.578 10.5778 10.578 10.5778 10.5776 10.5782C10.5776 10.5785 10.5772 10.5785 10.5772 10.5789C8.69209 12.4625 5.62541 12.4629 3.7407 10.5782ZM17.6589 16.0127L12.9741 11.3282C14.9807 8.53125 14.7358 4.60661 12.224 2.09483C9.43169 -0.698277 4.88697 -0.698277 2.09425 2.09483C-0.698083 4.88717 -0.698083 9.4315 2.09425 12.2242C3.49042 13.6208 5.32507 14.3189 7.15933 14.3189C8.62457 14.3189 10.0859 13.8656 11.3277 12.9743L16.0125 17.6591C16.2399 17.8861 16.5379 17.9998 16.8359 17.9998C17.1335 17.9998 17.4315 17.8861 17.6589 17.6591C18.1137 17.2043 18.1137 16.4674 17.6589 16.0127Z" />
          </svg>
          <Combobox.Input
            className="w-full bg-neutral-700 rounded px-3 py-1 text-[16px]
                      text-neutral-100 placeholder-neutral-400 focus:outline-none pl-10"
            placeholder="Search for recipe"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Combobox.Options className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-neutral-800 rounded shadow-lg">
            {searchTerm && filteredRecipes.slice(0, 5).map((r) => (
              <Combobox.Option
                key={r.id}
                value={r.id}
                style={{ color: qualityColors[r.quality] }}
                className={({ active }) =>
                  `flex gap-x-2 items-center cursor-pointer font-bold  px-3 py-1 text-[16px] ${
                    active ? 'bg-neutral-600 text-white' : ''
                  }`
                
                }
              >
                <img src={iconSrc(r.id)} alt="" className="w-10 h-10 rounded object-cover" />{r.name}
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
              className="w-full accent-yellow-300 mb-4"
            />
            <div className="flex space-x-1">
              <button onClick={()=>setView('route')}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-t transition-colors duration-250 ease-in-out
                  ${view==='route'? 'bg-neutral-700 text-white':'bg-neutral-800 text-neutral-400'}`}
              >Optimal</button>
              <button onClick={()=>setView('all')}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-t duration-250 ease-in-out
                  ${view==='all'? 'bg-neutral-700 text-white':'bg-neutral-800 text-neutral-400'}`}
              >All Recipes</button>
            </div>
          </div>

          {/* List */}
          <section className="flex-1 overflow-y-auto px-3 space-y-px pt-4 pb-6">
            <AnimatePresence mode="popLayout">
            {view==='route'
              ? steps.map((s, i) => {

                if ('upgradeName' in s) {
                  return (
                      <div key={`upgrade-${s.upgradeName}-${s.endSkill}`} className="relative flex items-center justify-center gap-1 bg-neutral-900 rounded-none px-2 py-1 w-full h-15 font-bold text-yellow-400">
                      ⚙️ {s.note ?? `Upgrade to ${s.upgradeName}`}
                      </div>
                    );
                  }

                const start = i === 0 ? skill : steps[i - 1].endSkill;
                const end = s.endSkill;
                const best = s.recipe;
                const groupKey = `group-${i}`;
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
                  
                  <motion.div
                    key={primaryKey}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex flex-col w-full space-y-px"
                  >
              
                    {/* Primary card */}
                    <div
                      id={`craft-${s.recipe.id}-${s.endSkill}`}
                      onClick={() => handleCardClick(groupKey, primaryKey, best.id, start, end)}
                      className={`relative flex items-center gap-1 px-2 py-1 w-full h-15 cursor-pointer transition-colors duration-250 ease-in-out hover:bg-neutral-700
                        ${selectedCardKey === primaryKey
                          ? 'bg-neutral-600'
                          : 'bg-neutral-900'
                        }`}
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
                    <AnimatePresence mode="wait">
                    {visibleCardKey === groupKey && candidates.map((alt, ai) => {
                      
                      const altKey = `alt-${i}-${ai}-${alt.recipe.id}`;
                      return (
                        <motion.div
                          key={altKey}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0.5, height: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div
                            key={altKey}
                            id={altKey}
                            onClick={() => handleCardClick(groupKey, altKey, alt.recipe.id, start, end)}
                            className={`relative flex items-center gap-1 rounded-none pl-3 pr-2 py-0.5 w-11/12 ml-auto cursor-pointer h-15 transition-colors duration-250 ease-in-out hover:bg-neutral-700
                              ${selectedCardKey === altKey ? 'bg-neutral-600' : 'bg-neutral-900'}`}
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
                        </motion.div>
                      );
                    })}
                    </AnimatePresence>
                  </motion.div>
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
                  className={`relative flex items-center gap-1 px-2 py-1 w-full h-15 cursor-pointer transition-colors duration-250 ease-in-out hover:bg-neutral-700 
                    ${selectedRecipeId === r.id ? 'bg-neutral-700':'bg-neutral-800'}`}
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
            </AnimatePresence>
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
            <div className="flex-none items-center">
              <div className="flex pb-5 text-[36px] items-center">
                <img
                  src={iconSrc(selected.id)}
                  alt={`${selected.name} icon`}
                  className="w-16 h-16 rounded mr-2 flex-shrink-0"
                />
                <a
                  href={`https://www.wowhead.com/classic/spell=${selected.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline font-semibold"
                  style={{ color: qualityColors[selected.quality ?? 1] }}
                >
                  {selected.name}
                </a>
              </div>
              <div className="flex-none">
              </div>
            </div>
        
            <div className="sm:border border-gray-900 bg-neutral-800 rounded-lg shadow-lg mt-4 pb-12">
            
              <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 border-t border-b border-gray-700 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Level-up Calculator</h3>
              </div>
                <div className="flex w-full h-full">
                  <div className="w-3/5 relative p-8" style={{ height: 350 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={probData} margin={{ top: 2, right: 0, bottom: 0, left: -22 }}>
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
                          ticks={[0, 0.25, 0.5, 0.75, 1]}
                          tickFormatter={(v) => `${v * 100}%`}
                          tick={{ fill: '#ccc', fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
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
                          fill="rgba(209, 213, 219, 0.2)"
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
                    <div className="relative bottom-7 ml-9.5">
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
                                  colors: ['#4b5563', '#d1d5db', '#4b5563'],
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
                                backgroundColor: '#9ca3af',
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

                  <aside className="flex-none w-2/5 bg-neutral-800 rounded-lg relative h-full" style={{ height: 350 }}>
                    <div className="flex justify-center items-center">
                    <div className="flex flex-col items-center bg-neutral-900 rounded border border-neutral-700 w-1/2 p-3 border-t-0 -mt-0.5 border-r-0">
                      <span className="text-xs text-neutral-400 bg-neutral-900 mb-1 p-2">FROM</span>
                      <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                        <button
                          className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                          onClick={() => setRngLow(Math.max(1, rngLow - 1))}
                        >−</button>
                        <span className="text-lg">{rngLow}</span>
                        <button
                          className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                          onClick={() => setRngLow(rngLow + 1)}
                        >+</button>
                      </div>
                    </div>
                    <div className="flex flex-col items-center bg-neutral-900 rounded border border-neutral-700 w-1/2 p-3 border-t-0 -mt-0.5 border-l-0 border-r-0 -mr-1">
                        <span className="text-xs text-neutral-400 bg-neutral-900 mb-1 p-2">TO</span>
                        <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                          <button
                            className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                            onClick={() => setRngHigh(Math.max(rngLow + 1, rngHigh - 1))}
                          >−</button>
                          <span className="text-lg">{rngHigh}</span>
                          <button
                            className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                            onClick={() => setRngHigh(rngHigh + 1)}
                          >+</button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-6 text-[16px] text-neutral-200 p-3 bg-neutral-800 -mb-0.5">
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

                <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 border-t border-b border-gray-700 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                  <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Material Calculations</h3>
                </div>

                {/* Expected crafts */}
                <div className="px-6 py-6">
                  <table className="w-full text-[20px] border-collapse">
                    {/* Table Header */}
                    <thead>
                      <tr className="text-left text-neutral-400 border-b border-neutral-700 ">
                        <th className="py-2">Name</th>
                        <th className="py-2 text-right">Amount</th>
                        <th className="py-2 text-right">Estimated Cost</th>
                      </tr>
                    </thead>

                    {/* Table Body */}
                    <tbody>
                      {Object.entries(materialTotals).map(([id, { qty, cost }]) => {
                        const info: MaterialInfo = materialMap[id] ?? { name: `Item ${id}`, quality: null };
                        const iconUrl = `/icons/materials/${id}.jpg`;

                        return (
                          <tr key={id}>
                            <td
                              className="py-1 flex items-center gap-1"
                              style={{ color: qualityColors[info.quality ?? 1] }}
                            >
                              <img src={iconUrl} alt={info.name} className="w-4 h-4" />
                              <span>{info.name}</span>
                            </td>
                            <td className="py-1 text-right">{qty}</td>
                            <td className="py-1 text-right">
                              <FormatMoney copper={cost} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                  <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Cost Calculations</h3>
                </div>
                <div className="flex justify-between items-stretch bg-neutral-800 divide-x divide-neutral-800 overflow-hidden text-neutral-100 text-[16px] h-24">
  
                  

                </div>

                <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                  <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Auction House Profit Calculation</h3>
                </div>
                <div className="flex justify-between items-stretch bg-neutral-800 divide-x divide-neutral-800 overflow-hidden text-neutral-100 text-[16px] h-24">
  
                  

                </div>
            </div>
          </div>
          )}
        </main>
      </div>
    </div>
  );
}