'use client';

import { useState, useMemo, useEffect } from 'react';
import rawAlchemy  from '@/data/recipes/alchemy.json';
import rawBlacksmithing  from '@/data/recipes/blacksmithing.json';
import rawEnchanting  from '@/data/recipes/enchanting.json';
import rawEngineering  from '@/data/recipes/engineering.json';
import rawLeatherworking  from '@/data/recipes/leatherworking.json';
import rawTailoring  from '@/data/recipes/tailoring.json';
import priceRows   from '@/data/prices/realm-559.json';
import type { RawRecipe, Recipe, PriceMap, MaterialInfo, MaterialTreeNode } from '@/lib/types';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceLine, Customized  } from "recharts";
import { makeDynamicPlan, PlanStep } from '@/lib/planner';
import { expectedSkillUps, craftCost, getItemCost, buildMaterialTree, skipCraftingUnlessTopLevel  } from '@/lib/recipeCalc';
import { toPriceMap, ignoreVendorPriceIds  }      from '@/lib/pricing';
import * as Slider         from '@radix-ui/react-slider';
import { Range, getTrackBackground } from 'react-range';
import Fuse from 'fuse.js';
import { Combobox } from '@headlessui/react';
import materialInfo from '@/lib/materialsLoader';
import { FormatMoney } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from 'use-debounce';

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
  //'All Professions',
  'Alchemy',
  'Blacksmithing',
  'Enchanting',
  'Engineering',
  'Leatherworking',
  'Tailoring',
];

const rawDataMap: Record<string, any[]> = {
  Alchemy: rawAlchemy,
  Blacksmithing: rawBlacksmithing,
  Enchanting: rawEnchanting,
  Engineering: rawEngineering,
  Leatherworking: rawLeatherworking,
  Tailoring: rawTailoring,
};




const prices = toPriceMap(
  priceRows as any[],
  Object.entries(materialInfo).reduce<Record<string, { vendorPrice?: number }>>((acc, [id, val]) => {
    if (val.vendorPrice != null) {
      acc[String(id)] = { vendorPrice: val.vendorPrice };
    }
    return acc;
  }, {})
);

// ── helpers ──
const diffColor = (skill: number, d: Recipe['difficulty']) => {
  if (skill < d.orange!) return 'bg-orange-500';
  if (skill < d.yellow!) return 'bg-yellow-500';
  if (skill < d.green!)  return 'bg-green-500';
  return 'bg-neutral-500';
};
const iconSrc = (id: number, professionId: string) => `/icons/${professionId.toLowerCase()}/${id}.jpg`;

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

function CollapsibleSection({
  expanded,
  children,
}: {
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`transition-all duration-300 ease-in-out overflow-hidden`}
      style={{
        maxHeight: expanded ? '999px' : '0px',
        opacity: expanded ? 1 : 0,
        transform: expanded ? 'scaleY(1)' : 'scaleY(0.95)',
        transitionProperty: 'max-height, opacity, transform',
      }}
    >
      {children}
    </div>
  );
}

function calcCraftCost(recipe: Recipe): number {
  return craftCost(recipe, prices, materialInfo ); // or rename to materialInfo
}

function SafeMoney({
  value,
  fallback,
}: {
  value: number;
  fallback?: React.ReactNode;
}) {
  if (!Number.isFinite(value) || isNaN(value)) {
    return (
      <span className="text-red-400 text-xs font-medium">
        {fallback ?? '⚠️ Unknown cost'}
      </span>
    );
  }

  return <FormatMoney copper={value} />;
}


function MaterialCard({
  node,
  depth = 0,
  materialInfo,
  position = 'only',
}: {
  node: MaterialTreeNode;
  depth?: number;
  materialInfo: Record<number, MaterialInfo>;
  position?: 'top' | 'middle' | 'bottom' | 'only';
}) {
  const roundedClass = {
    only: 'rounded-xl',
    top: 'rounded-t-xl',
    middle: 'rounded-none',
    bottom: 'rounded-b-xl',
  }[position];
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 64;
  const info = materialInfo[node.id];
  const iconUrl = info ? `/icons/materials/${node.id}.jpg` : null;

  const isParent = node.children && node.children.length > 0;
  const canCraftCheaper = node.craftCost < node.buyCost;

  const displayChildren = canCraftCheaper && isParent;

  return (
    <div style={{ marginLeft: `${indent}px` }}>
      <div
        onClick={() => displayChildren && setExpanded(prev => !prev)}
        className={`flex justify-between items-center bg-neutral-900 p-4 shadow border border-neutral-700 mb-px transition-all duration-200 ${
          displayChildren ? 'hover:bg-neutral-700 active:scale-[0.98] cursor-pointer' : ''
        } ${roundedClass}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-base">{node.quantity}</span>
          {iconUrl && (
            <img
              src={iconUrl}
              alt={info?.name ?? 'Item'}
              className="w-8 h-8 rounded object-cover border border-neutral-700"
            />
          )}
          <span className="text-base font-medium" style={{ color: qualityColors[info?.quality ?? 1] }}>
            {node.name}
          </span>
        </div>
        <div className="flex flex-col items-end text-right">
          {node.noAhPrice ? (
            <div className="flex flex-col items-end text-right text-yellow-400 font-medium">
              <div>⚠️ No auction listing — crafting cost used instead</div>
              <div><SafeMoney value={node.craftCost} /></div>
            </div>
          ) : (
            <span className="text-yellow-300 text-base font-normal">
              <SafeMoney
                value={node.buyCost}
                fallback="⚠️ No price available"
              />
            </span>
          )}

          {Number.isFinite(node.buyCost) &&
            Number.isFinite(node.craftCost) &&
            node.buyCost > node.craftCost && (
              <span className="text-green-400 text-xs font-semibold mt-2">
                Or Craft For: <SafeMoney value={node.craftCost} />
              </span>
          )}
        </div>
      </div>

      {displayChildren && (
        <CollapsibleSection expanded={expanded}>
          {node.children!.map((child, index, arr) => (
            <MaterialCard
              key={`${child.id}-${child.quantity}`}
              node={child}
              depth={depth + 1}
              materialInfo={materialInfo}
              position={
                arr.length === 1
                  ? 'only'
                  : index === 0
                  ? 'top'
                  : index === arr.length - 1
                  ? 'bottom'
                  : 'middle'
              }
            />
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}

function MaterialTreeFlat({
  rootNodes,
  materialInfo,
}: {
  rootNodes: MaterialTreeNode[];
  materialInfo: Record<number, MaterialInfo>;
}) {
  return (
    <div>
      {rootNodes.map((node, i) => (
        <MaterialCard
          key={`${node.id}-${i}`}
          node={node}
          materialInfo={materialInfo}
          position={node.children?.length ? 'top' : 'only'}
        />
      ))}
    </div>
  );
}


// ── component ──
export default function EnchantingPlanner() {
  const [skill, setSkill]           = useState(1);
  const [debouncedSkill] = useDebounce(skill, 200);
  const [target, setTarget]   = useState(300);
  const [view,  setView]            = useState<'route'|'all'>('route');
  const [selectedRecipeId, setSelectedRecipeId] = useState<number|null>(null);
  const [selectedCardKey, setSelectedCardKey]     = useState<string|null>(null);
  const [visibleCardKey, setVisibleCardKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProfession, setSelectedProfession] = useState('Enchanting');

  const tabs = ['route', 'all'] as const;


  const recipes: Recipe[] = useMemo(() => {
    const raw = rawDataMap[selectedProfession] || [];
    
    return raw.map(r => {
      const { quality: _badQuality, materials: _rawMats, ...base } = r;
  
      const materials: Record<string, number> = {};
      for (const [id, qty] of Object.entries(_rawMats)) {
        if (typeof qty === 'number' && qty > 0) {
          materials[id] = qty;
        }
      }
  
      const quality = typeof _badQuality === 'number' ? _badQuality : 1;
  
      return {
        ...base,
        quality,
        materials,
      };
    });
  }, [selectedProfession]);


  useEffect(() => {
    if (recipes.length > 0 && prices && selectedProfession) {
      makeDynamicPlan(skill, 300, recipes, prices, materialInfo, selectedProfession  );
    }
  }, [recipes, prices, skill, selectedProfession, materialInfo ]);

  const fuse = useMemo(
    () => new Fuse(recipes, { keys: ['name'], threshold: 0.3 }),
    [recipes]
  );

  useEffect(() => {
    setRngLow(skill);
    setRngHigh(target);
  }, [skill, target]);


  const { steps, totalCost, finalSkill } = useMemo(
    () => makeDynamicPlan(debouncedSkill, 300, recipes, prices, materialInfo, selectedProfession ),
    [debouncedSkill, recipes, prices, materialInfo]
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
  const sortedAll = useMemo(() => [...recipes].sort((a, b) => a.minSkill - b.minSkill), [recipes]);

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

  const [debouncedLow] = useDebounce(rngLow, 200);
  const [debouncedHigh] = useDebounce(rngHigh, 200);

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
  }, [debouncedLow, debouncedHigh, selected]);

  useEffect(() => {
    if (!selected) return;
    const min = selected.minSkill;
    const max = selected.difficulty.gray ?? min;
    setRngLow(current => Math.max(min, Math.min(current, max)));
    setRngHigh(current => Math.max(min, Math.min(current, max)));
  }, [selected]);

  const materialTotals = useMemo(() => {
    if (!selected) return {};
    const out: Record<string, {
      qty: number;
      buyCost: number;
      craftCost: number;
      saved: number;
    }> = {};
    
    for (const [id, perCraft] of Object.entries(selected.materials)) {
      const itemId = parseInt(id);
      const qty = perCraft * expCrafts;
    
      const buyUnit = prices[itemId]?.minBuyout ?? prices[itemId]?.marketValue ?? Infinity;
      const craftUnit = getItemCost(itemId, prices, materialInfo, new Map(), true);
      
      const buyCost = buyUnit * qty;
      const craftCost = craftUnit * qty;
      const saved = Math.max(0, buyCost - craftCost);
    
      out[id] = { qty, buyCost, craftCost, saved };
    }
    return out;
  }, [selected, expCrafts, prices, materialInfo]);

  const materialTrees = Object.entries(materialTotals).map(([id, { qty }]) => {
    return buildMaterialTree(parseInt(id), qty, prices, materialInfo);
  });
  

  //const [matInfo, setMatInfo] = useState<Record<string,{name:string;icon:string|null}>>({});

  // Use pre-scraped material names and icons from JSON + /public/icons/materials
  const materialMap = materialInfo;

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
                <img src={iconSrc(r.id, selectedProfession)} alt="" className="w-10 h-10 rounded object-cover" />{r.name}
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
        <aside className="w-150 lg:w-150 flex flex-col overflow-y-auto bg-neutral-950 text-[16px]">
          {/* Slider + Tabs */}
          <div className="sticky top-0 z-30 bg-neutral-900 px-3 pt-6 pb-2">
          <select
            className="w-full bg-neutral-700 text-white text-sm rounded px-2 py-1 focus:outline-none mb-5"
            onChange={(e) => setSelectedProfession(e.target.value)}
          >
            <option value="">Select Profession</option>
            {professions.map((prof) => (
              <option key={prof} value={prof}>{prof}</option>
            ))}
          </select>
            <div className="mb-4">
              <label className="block text-xs mb-1">
                SKILL <span className="font-semibold">{skill}</span>
              </label>
              <div className="flex items-center space-x-2">
                {/* Skill slider */}
                <input
                  type="range"
                  min={1}
                  max={300}
                  value={skill}
                  onChange={(e) => setSkill(+e.target.value)}
                  className="flex-1 accent-yellow-300"
                />

                {/* Stepper input */}
                <div className="flex flex-col items-center bg-neutral-900 w-1/4">
                  <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => setSkill((prev) => Math.max(1, prev - 1))}
                    >−</button>
                    
                    <input
                      type="number"
                      value={skill}
                      min={1}
                      max={300}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) {
                          setSkill(Math.min(300, Math.max(1, val)));
                        }
                      }}
                      className="text-lg text-center w-12 bg-transparent outline-none appearance-none
                                [&::-webkit-inner-spin-button]:appearance-none 
                                [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => setSkill((prev) => Math.min(300, prev + 1))}
                    >+</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="relative flex space-x-6 border-b border-neutral-700 font-semibold text-neutral-400 mb-2 justify-center">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setView(tab)}
                  className={`pb-2 relative ${
                    view === tab ? 'text-white' : 'hover:text-neutral-200'
                  }`}
                >
                  {tab === 'route' ? 'Optimal' : 'All Recipes'}
                  {view === tab && (
                    <motion.div
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-yellow-400"
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 px-2 py-1 w-full h-15 text-neutral-400 bg-neutral-900 border-b border-neutral-800 font-semibold text-[16px]">
              <span className="w-8 text-center">#</span>
              <span className="w-7" /> {/* icon space */}
              <span className="flex-1">Recipe</span>
              <span className="w-28 text-right">Total Cost</span>
              <span className="w-24 text-center">Skill</span>
            </div>
          </div>
          {/* List */}
          <section className="flex-1 overflow-y-auto px-0 space-y-px pt-0 pb-0">
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
                      className={`relative flex items-center gap-1 px-2 py-1 w-full h-15 cursor-pointer
                        transition-all duration-150 ease-out
                        hover:bg-neutral-700 active:bg-neutral-700 active:scale-[0.99]
                        ${selectedCardKey === primaryKey ? 'bg-neutral-600' : 'bg-neutral-900'}`}
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                        diffColor(skill, best.difficulty)
                      }`} />
                      <span className="bg-neutral-800 rounded-full px-1 py-0.5 text-[16px] flex items-center justify-center w-8">
                        {s.crafts}×
                      </span>
                      <img src={iconSrc(best.id, selectedProfession)} alt="" className="w-7 h-7 rounded object-cover" />
                      <span 
                        className="truncate whitespace-nowrap flex-1 text-[16px]"
                        style={{ color: qualityColors[s.recipe.quality] }}>
                        {best.name.length <= 35 ? best.name : `${best.name.slice(0, 33)}…`}
                      </span>
                      <span className="text-[16px]">
                        <FormatMoney copper={s.crafts * calcCraftCost(best)} />
                      </span>
                      <span className="flex-shrink-0 w-24 text-center text-yellow-200 bg-neutral-800 text-[16px] px-0 py-0 rounded-full">
                        {start} → {end}
                      </span>
                    </div>
              
                    {/* Alternative cards (up to 2) */}
                    <AnimatePresence mode="sync">
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
                            className={`relative flex items-center gap-1 rounded-none pl-3 pr-2 py-0.5 w-11/12 ml-auto cursor-pointer h-15 
                              transition-all duration-150 ease-out 
                              hover:bg-neutral-700 active:bg-neutral-700 active:scale-[0.99]
                              ${selectedCardKey === altKey ? 'bg-neutral-600' : 'bg-neutral-900'}`}
                          >
                            <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                              diffColor(skill, alt.recipe.difficulty)
                            }`} />
                            <span className="bg-neutral-700 rounded-full px-1 py-0.5 text-[16px]">
                              or {alt.crafts}×
                            </span>
                            <img
                              src={iconSrc(alt.recipe.id, selectedProfession)}
                              alt=""
                              className="w-7 h-7 rounded object-cover"
                            />
                            <span 
                              className="truncate whitespace-nowrap flex-1 text-[16px]"
                              style={{ color: qualityColors[alt.recipe.quality] }}>
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
                    ${selectedRecipeId === r.id ? 'bg-neutral-700':'bg-neutral-900'}`}
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
                    src={iconSrc(r.id, selectedProfession)}
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
            <footer className="sticky bottom-0 z-30 bg-neutral-875 px-3 py-2 border-t border-neutral-600 text-center text-[24px] font-semibold ">
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
                  src={iconSrc(selected.id, selectedProfession)}
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
                    <div className="flex flex-col items-center bg-neutral-900 rounded-b border border-neutral-700 w-1/2 p-3 border-t-0 -mt-0.5 border-r-0">
                      <span className="text-xs text-neutral-400 bg-neutral-900 mb-1 p-2">FROM</span>
                      <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                        <button
                          className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                          onClick={() => setRngLow(Math.max(1, rngLow - 1))}
                        >−</button>
                        <input
                          type="number"
                          value={rngLow}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val)) setRngLow(Math.max(1, Math.min(val, rngHigh - 1)));
                          }}
                          className="text-lg text-center w-12 bg-transparent outline-none appearance-none
                                    [&::-webkit-inner-spin-button]:appearance-none 
                                    [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                          onClick={() => setRngLow(rngLow + 1)}
                        >+</button>
                      </div>
                    </div>
                    <div className="flex flex-col items-center bg-neutral-900 rounded-b border border-neutral-700 w-1/2 p-3 border-t-0 -mt-0.5 border-l-0 border-r-0 -mr-1">
                      <span className="text-xs text-neutral-400 bg-neutral-900 mb-1 p-2">TO</span>
                      <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                        <button
                          className="text-lg text-white px-2 py-1 bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                          onClick={() => setRngHigh(Math.max(rngLow + 1, rngHigh - 1))}
                        >−</button>
                        <input
                          type="number"
                          value={rngHigh}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val)) setRngHigh(Math.max(1, Math.min(val, rngHigh - 1)));
                          }}
                          className="text-lg text-center w-12 bg-transparent outline-none appearance-none
                                    [&::-webkit-inner-spin-button]:appearance-none 
                                    [&::-webkit-outer-spin-button]:appearance-none"
                        />
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
                        <span className="text-white rounded px-2 font-semibold">{expCrafts}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Total materials cost:</span>
                        <span className="text-white rounded px-2 font-semibold"> <FormatMoney copper={(Object.values(materialTotals).reduce((s, m) => s + m.craftCost, 0))} /></span>
                      </div>
                    </div>
                  </aside>
                </div>

                <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 border-t border-b border-gray-700 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                  <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Material Calculations</h3>
                </div>

                {/* Expected crafts */}
                <div className="px-6 py-6">
                  <MaterialTreeFlat rootNodes={materialTrees} materialInfo={materialInfo} />
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