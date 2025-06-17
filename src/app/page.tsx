'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import rawAlchemy  from '@/data/recipes/alchemy.json';
import rawBlacksmithing  from '@/data/recipes/blacksmithing.json';
import rawEnchanting  from '@/data/recipes/enchanting.json';
import rawEngineering  from '@/data/recipes/engineering.json';
import rawLeatherworking  from '@/data/recipes/leatherworking.json';
import rawTailoring  from '@/data/recipes/tailoring.json';
import type { Recipe, MaterialInfo, MaterialTreeNode } from '@/lib/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceLine, Customized  } from "recharts";
import { makeDynamicPlan, PlanStep, blacklistedSpellIds, calculateTotalMaterials } from '@/lib/planner';
import { expectedSkillUps, craftCost as calculateCraftCost, getItemCost, buildMaterialTree } from '@/lib/recipeCalc';
import { toPriceMap }      from '@/lib/pricing';
import { Range, getTrackBackground } from 'react-range';
import Fuse from 'fuse.js';
import { Listbox } from '@headlessui/react';
import materialInfo from '@/lib/materialsLoader';
import { FormatMoney } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from 'use-debounce';
import { Analytics } from "@vercel/analytics/next"

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

// Function to dynamically load price data
async function loadPriceData(realm: string, faction: string): Promise<any[]> {
  try {
    const filename = `${realm}_${faction.toLowerCase()}.json`;
    
    // Import the price data directly from the src directory
    const data = await import(`@/data/prices/${filename}`);
    return data.default || data;
  } catch (error) {
    console.error(`Error loading price data for ${realm} ${faction}:`, error);
    // Fallback to Thunderstrike Alliance if the requested file doesn't exist
    if (realm !== 'Thunderstrike' || faction !== 'Alliance') {
      console.log('Falling back to Thunderstrike Alliance price data');
      return loadPriceData('Thunderstrike', 'Alliance');
    }
    throw error;
  }
}

// ── helpers ──
const diffColor = (skill: number, d: Recipe['difficulty']) => {
  if (skill < (d.orange ?? 1)) return 'bg-orange-500';
  if (skill < d.yellow!) return 'bg-yellow-500';
  if (skill < d.green!)  return 'bg-green-500';
  if (skill < d.gray!)   return 'bg-green-500';
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
  expCrafts,
}: {
  node: MaterialTreeNode;
  depth?: number;
  materialInfo: Record<number, MaterialInfo>;
  position?: 'top' | 'middle' | 'bottom' | 'only';
  expCrafts: number;
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

  // Calculate per-craft quantity by dividing total quantity by number of crafts
  const perCraftQuantity = node.quantity / expCrafts;

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
          <div className="flex flex-col">
          <span className="text-base font-medium" style={{ color: qualityColors[info?.quality ?? 1] }}>
            {node.name}
          </span>
            <span className="text-sm text-neutral-400">
              Per Craft: {perCraftQuantity}
          </span>
          </div>
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
              expCrafts={expCrafts}
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
  expCrafts,
}: {
  rootNodes: MaterialTreeNode[];
  materialInfo: Record<number, MaterialInfo>;
  expCrafts: number;
}) {
  return (
    <div>
      {rootNodes.map((node, i) => (
        <MaterialCard
          key={`${node.id}-${i}`}
          node={node}
          materialInfo={materialInfo}
          position={node.children?.length ? 'top' : 'only'}
          expCrafts={expCrafts}
        />
      ))}
    </div>
  );
}


// ── component ──
export default function EnchantingPlanner() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [skill, setSkill] = useState(1);
  const [debouncedSkill] = useDebounce(skill, 200);
  const [committedSkill, setCommittedSkill] = useState(1);
  const [target, setTarget] = useState(300);
  const [view, setView] = useState<'route'|'all'>('route');
  const [selectedRecipeId, setSelectedRecipeId] = useState<number|null>(null);
  const [selectedCardKey, setSelectedCardKey] = useState<string|null>(null);
  const [visibleCardKey, setVisibleCardKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProfession, setSelectedProfession] = useState('Enchanting');
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [useMarketValue, setUseMarketValue] = useState(false);

  // Add isSliding state to track active slider interaction
  const [isSliding, setIsSliding] = useState(false);
  const [isReleased, setIsReleased] = useState(false);
  const [isDirectChange, setIsDirectChange] = useState(false);
  const [includeRecipeCost, setIncludeRecipeCost] = useState(true);
  const [skipLimitedStock, setSkipLimitedStock] = useState(true);
  
  // Add state for prices
  const [prices, setPrices] = useState<any>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  
  const lastSkillChange = useRef<number>(Date.now());
  const lastSkillValue = useRef<number>(skill);

  // Track the last non-debounced skill value
  useEffect(() => {
    lastSkillValue.current = skill;
  }, [skill]);

  // Coordinate sliding state with debounced value
  useEffect(() => {
    if (isReleased && !isSliding && skill === debouncedSkill) {
      setCommittedSkill(skill);
      setIsReleased(false);
      setIsBlurComplete(true);
    }
  }, [debouncedSkill, isReleased, isSliding, skill]);

  const handleSliderStart = () => {
    setIsDirectChange(false);
    setIsSliding(true);
    setIsReleased(false);
    setIsBlurComplete(false);
  };

  const handleSliderEnd = () => {
      setIsReleased(true);
    setIsSliding(false);
  };

  const handleSliderChange = (value: number) => {
    setSkill(value);
    lastSkillChange.current = Date.now();
  };

  const handleDirectSkillChange = (newValue: number) => {
    const boundedValue = Math.min(300, Math.max(1, newValue));
    setIsDirectChange(true);
    setIsSliding(false);
    setIsReleased(false);
    setSkill(boundedValue);
    setCommittedSkill(boundedValue);
    lastSkillValue.current = boundedValue;
    setIsBlurComplete(true);
  };

  // Reset direct change flag after a delay
  useEffect(() => {
    if (isDirectChange) {
      const timer = setTimeout(() => {
        setIsDirectChange(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isDirectChange]);

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

  // Use committedSkill for the plan calculation
  const plan = useMemo(() => {
    if (!recipes.length) {
      return {
        steps: [],
        totalCost: 0,
        finalSkill: committedSkill,
      };
    }
    return makeDynamicPlan(
      committedSkill,
        target,
        recipes,
        prices,
        materialInfo,
      selectedProfession,
        includeRecipeCost,
      skipLimitedStock,
      useMarketValue
  );
  }, [committedSkill, target, recipes, prices, materialInfo, selectedProfession, includeRecipeCost, skipLimitedStock, useMarketValue]);

  const fuse = useMemo(
    () => new Fuse(recipes, { keys: ['name'], threshold: 0.3 }),
    [recipes]
  );

  useEffect(() => {
    setRngLow(committedSkill);
    setRngHigh(target);
  }, [committedSkill, target]);

  // Use committedSkill for effects that trigger recipe selection
  useEffect(() => {
    // Reset states when view changes
    setSelectedCardKey(null);
    setVisibleCardKey(null);
    
    if (view === 'route') {
      // When switching to route view, select the first recipe from steps
      const first = plan.steps.find((s): s is Extract<PlanStep, { recipe: Recipe }> => 'recipe' in s);
      if (first) {
        setSelectedRecipeId(first.recipe.id);
        setRngLow(committedSkill);
        setRngHigh(first.endSkill);
      }
    }
  }, [view, plan, committedSkill]);

  // Use faster debounced value for visual updates like difficulty colors
  const startOf = (i: number) => (i === 0 ? committedSkill : plan.steps[i - 1].endSkill);
  const sortedAll = useMemo(() => [...recipes].sort((a, b) => a.minSkill - b.minSkill), [recipes]);

  const filteredRecipes = useMemo(() => {
    if (view === 'all') {
      return searchTerm
        ? fuse.search(searchTerm).map(result => result.item)
        : sortedAll;
    }
    return [];
  }, [searchTerm, fuse, sortedAll, view]);

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

  const [isBlurComplete, setIsBlurComplete] = useState(true);

  // Store both expanded and selected card info
  const [expandedCard, setExpandedCard] = useState<{
    recipeName: string;
    endSkill: number;
    isFromClick: boolean;
  } | null>(null);

  const [selectedCard, setSelectedCard] = useState<{
    recipeName: string;
    endSkill: number;
  } | null>(null);

  const handleCardClick = (recipeName: string, endSkill: number, start: number, end: number, isAlternative: boolean = false, recipeId: number) => {
    // If clicking a main card, toggle expansion and set selection
    if (!isAlternative) {
      if (expandedCard?.recipeName === recipeName && expandedCard?.endSkill === endSkill) {
        setExpandedCard(null);
      } else {
        setExpandedCard({ recipeName, endSkill, isFromClick: true });
      }
      setSelectedCard({ recipeName, endSkill });
    } else {
      // If clicking an alternative, just update selection
      setSelectedCard({ recipeName, endSkill });
    }
    
    // Update the selected recipe in the main window
    setSelectedRecipeId(recipeId);
    
    // Update skill range
    setRngLow(start);
    setRngHigh(end);
  };

  // Update wasVisible to consider both previous visibility and click state
  const shouldAnimate = (recipeName: string, endSkill: number) => {
    const wasVisible = previouslyVisible.has(`${recipeName}-${endSkill}`);
    const isClickExpansion = expandedCard?.isFromClick && 
                            expandedCard.recipeName === recipeName && 
                            expandedCard.endSkill === endSkill;
    return !wasVisible || isClickExpansion;
  };

  // Effect to reset isFromClick after animation
  useEffect(() => {
    if (expandedCard?.isFromClick) {
      const timer = setTimeout(() => {
        if (expandedCard) {
          setExpandedCard({ ...expandedCard, isFromClick: false });
        }
      }, 300); // Slightly longer than animation duration
      return () => clearTimeout(timer);
    }
  }, [expandedCard]);

  // In the card rendering, check against selectedInfo
  const isSelected = (recipeName: string, endSkill: number) => {
    return selectedCard?.recipeName === recipeName && 
           selectedCard?.endSkill === endSkill;
  };

  const isExpanded = (recipeName: string, endSkill: number) => {
    return expandedCard?.recipeName === recipeName && 
           expandedCard?.endSkill === endSkill;
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
    const out: Record<string, {
      qty: number;
      buyCost: number;
      craftCost: number;
      saved: number;
    }> = {};
    
    for (const [id, perCraft] of Object.entries(selected.materials)) {
      const itemId = parseInt(id);
      const qty = perCraft * expCrafts;
    
      const buyUnit = useMarketValue ?
        (prices[itemId]?.marketValue ?? prices[itemId]?.minBuyout ?? Infinity) :
        (prices[itemId]?.minBuyout ?? prices[itemId]?.marketValue ?? Infinity);
      const craftUnit = getItemCost(itemId, prices, materialInfo, new Map(), true, useMarketValue);
      
      const buyCost = buyUnit * qty;
      const craftCost = craftUnit * qty;
      const saved = Math.max(0, buyCost - craftCost);
    
      out[id] = { qty, buyCost, craftCost, saved };
    }
    return out;
  }, [selected, expCrafts, prices, materialInfo, useMarketValue]);

  const materialTrees = Object.entries(materialTotals).map(([id, { qty }]) => {
    return buildMaterialTree(parseInt(id), qty, prices, materialInfo, true, new Set(), useMarketValue);
  });
  

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

  // Add state to track previously visible recipes
  const [previouslyVisible, setPreviouslyVisible] = useState<Set<string>>(new Set());

  // Update the visible recipes when committed skill changes
  useEffect(() => {
    const currentlyVisible = new Set(
      plan.steps
        .filter((s): s is Extract<typeof s, { recipe: Recipe }> => 'recipe' in s)
        .map(s => `${s.recipe.name}-${s.endSkill}`)
    );
    setPreviouslyVisible(currentlyVisible);
  }, [committedSkill]);

  const lastProfessionChange = useRef(selectedProfession);
  const lastViewChange = useRef(view);

  // Update selected card and recipe when profession changes
  useEffect(() => {
    if (lastProfessionChange.current === selectedProfession) return;
    lastProfessionChange.current = selectedProfession;

    if (plan.steps.length > 0) {
      const firstStep = plan.steps[0];
      if ('recipe' in firstStep) {
        const recipeStep = firstStep as Extract<PlanStep, { recipe: Recipe }>;
        const cardKey = `${recipeStep.recipe.name}-${recipeStep.endSkill}`;
        setSelectedCardKey(cardKey);
        setSelectedRecipeId(recipeStep.recipe.id);
      }
    } else if (recipes.length > 0) {
      const firstRecipe = recipes[0];
      const cardKey = `${firstRecipe.name}-${firstRecipe.minSkill}`;
      setSelectedCardKey(cardKey);
      setSelectedRecipeId(firstRecipe.id);
    }
  }, [selectedProfession, plan, recipes]);

  // New selectors state and options
  const versions = ["Vanilla", "The Burning Crusade"];
  const [selectedVersion, setSelectedVersion] = useState("Vanilla");

  // Only Thunderstrike for Vanilla for now
  const vanillaRealms = ["Thunderstrike", "Spineshatter", "Soulseeker", "Dreamscythe", "Nightslayer", "Doomhowl"];
  const tbcRealms: string[] = [];
  const realms = selectedVersion === "Vanilla" ? vanillaRealms : tbcRealms;
  const [selectedRealm, setSelectedRealm] = useState(vanillaRealms[0]);

  const factions = ["Alliance", "Horde"];
  const [selectedFaction, setSelectedFaction] = useState("Alliance");

  // Load prices when realm or faction changes
  useEffect(() => {
    async function loadPrices() {
      setIsLoadingPrices(true);
      console.log(`Loading prices for ${selectedRealm} ${selectedFaction}...`);
      try {
        const priceRows = await loadPriceData(selectedRealm, selectedFaction);
        console.log(`Loaded ${priceRows.length} price rows for ${selectedRealm} ${selectedFaction}`);
        const priceMap = toPriceMap(
          priceRows,
          Object.entries(materialInfo).reduce<Record<string, { vendorPrice?: number }>>((acc, [id, val]) => {
            if (val.vendorPrice != null) {
              acc[String(id)] = { vendorPrice: val.vendorPrice };
            }
            return acc;
          }, {})
        );
        setPrices(priceMap);
      } catch (error) {
        console.error('Failed to load prices:', error);
        // Set empty prices as fallback
        setPrices({});
      } finally {
        setIsLoadingPrices(false);
      }
    }

    loadPrices();
  }, [selectedRealm, selectedFaction]);

  // Add effect to reset realm if version changes and current realm is not available
  useEffect(() => {
    if (!realms.includes(selectedRealm)) {
      setSelectedRealm(realms[0] || "");
    }
  }, [selectedVersion, realms, selectedRealm]);

  const [showMaterials, setShowMaterials] = useState(false);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 overflow-hidden">

      {/* Panels */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Aside */}
        <aside className="w-150 lg:w-150 flex flex-col bg-neutral-950 text-[16px]">
          {/* Slider + Tabs */}
          <div className="flex-none bg-neutral-900 px-3 pt-6 pb-2">
            {/* Logo and name */}
            <div className="flex items-center gap-2 mb-4">
              <img src="/icons/WoWCraft.png" alt="WoWCraft Logo" className="w-16 h-16 mb-2 ml-2" />
              <span className="text-[32px] font-bold text-white"><span className="text-[#e3b056]">WoW</span>Craft.io</span>
            </div>
            {/* End logo and name */}
            <div className="flex gap-2 mb-4">
              {/* Version Selector */}
              <Listbox value={selectedVersion} onChange={setSelectedVersion}>
                {({ open }) => (
                  <div className="relative w-1/3">
                    <Listbox.Button className={`w-full bg-neutral-800 text-white rounded px-3 py-1.5 text-sm flex items-center justify-between transition-colors duration-150 ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/50'}`}>
                      <span className="font-semibold">{selectedVersion}</span>
                      <svg className={`h-4 w-4 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-10 mt-1 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {versions.map((ver) => (
                        <Listbox.Option key={ver} value={ver} className={({ active }) => `relative cursor-pointer select-none py-2 pl-3 pr-9 ${active ? 'bg-neutral-700 text-white' : 'text-neutral-300'}`}>
                          {({ selected }) => (
                            <span className={`block truncate font-semibold ${selected ? 'text-white' : ''}`}>{ver}</span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
              {/* Realm Selector */}
              <Listbox value={selectedRealm} onChange={setSelectedRealm}>
                {({ open }) => (
                  <div className="relative w-1/3">
                    <Listbox.Button className={`w-full bg-neutral-800 text-white rounded px-3 py-1.5 text-sm flex items-center justify-between transition-colors duration-150 ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/50'}`}>
                      <span className="font-semibold">{selectedRealm}</span>
                      <svg className={`h-4 w-4 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-10 mt-1 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {realms.map((realm) => (
                        <Listbox.Option key={realm} value={realm} className={({ active }) => `relative cursor-pointer select-none py-2 pl-3 pr-9 ${active ? 'bg-neutral-700 text-white' : 'text-neutral-300'}`}>
                          {({ selected }) => (
                            <span className={`block truncate font-semibold ${selected ? 'text-white' : ''}`}>{realm}</span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
              {/* Faction Selector */}
              <Listbox value={selectedFaction} onChange={setSelectedFaction}>
                {({ open }) => (
                  <div className="relative w-1/3">
                    <Listbox.Button className={`w-full bg-neutral-800 text-white rounded px-3 py-1.5 text-sm flex items-center justify-between transition-colors duration-150 ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/50'}`}>
                      <span className="font-semibold">{selectedFaction}</span>
                      <svg className={`h-4 w-4 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-10 mt-1 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {factions.map((fac) => (
                        <Listbox.Option key={fac} value={fac} className={({ active }) => `relative cursor-pointer select-none py-2 pl-3 pr-9 ${active ? 'bg-neutral-700 text-white' : 'text-neutral-300'}`}>
                          {({ selected }) => (
                            <span className={`block truncate font-semibold ${selected ? 'text-white' : ''}`}>{fac}</span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
            <div className="w-full mb-5">
              <Listbox value={selectedProfession} onChange={setSelectedProfession}>
                {({ open }) => (
                  <div className="relative w-full">
                    <Listbox.Button className={`w-full bg-neutral-800 text-white rounded px-3 py-1.5 text-lg flex items-center justify-between transition-colors duration-150 ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/50'}`}>
                      <div className="flex items-center gap-2">
                        <img src={`/icons/${selectedProfession.toLowerCase()}.webp`} alt="" className="w-10 h-10" />
                        <span className="font-semibold">{selectedProfession}</span>
                      </div>
                      <svg
                        className={`h-4 w-4 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-10 mt-1 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none text-lg">
              {professions.map((prof) => (
                        <Listbox.Option
                          key={prof}
                          value={prof}
                          className={({ active }) =>
                            `relative cursor-pointer select-none py-2 pl-3 pr-9 ${
                              active ? 'bg-neutral-700 text-white' : 'text-neutral-300'
                            }`
                          }
                        >
                          {({ selected }) => (
                            <div className="flex items-center gap-2">
                              <img src={`/icons/${prof.toLowerCase()}.webp`} alt="" className="w-10 h-10" />
                              <span className={`block truncate font-semibold ${selected ? 'text-white' : ''}`}>
                                {prof}
                              </span>
                            </div>
                          )}
                        </Listbox.Option>
              ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs">
                  Current Skill Level <span className="font-semibold text-yellow-300">{skill}</span>
                </label>
                <div className="relative">
                  <button
                    onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
                  >
                    <span>Advanced Settings</span>
                    <svg
                      className={`w-4 h-4 transition-transform ${isAdvancedSettingsOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  <AnimatePresence>
                    {isAdvancedSettingsOpen && (
                      <motion.div
                        initial={{ opacity: 0, x: -10, scaleX: 0.95 }}
                        animate={{ opacity: 1, x: 0, scaleX: 1 }}
                        exit={{ opacity: 0, x: -10, scaleX: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute left-full top-0 ml-2 w-64 bg-neutral-800 rounded shadow-lg border border-neutral-700 z-50 origin-left"
                      >
                        <div className="p-3 space-y-3">
                          <div className="flex items-center justify-between">
                    <label className="text-xs text-neutral-400">Include Recipe Cost</label>
                    <button 
                      onClick={() => setIncludeRecipeCost(!includeRecipeCost)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-400/50 ${
                        includeRecipeCost ? 'bg-yellow-400' : 'bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out ${
                          includeRecipeCost ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                          <div className="flex items-center justify-between">
                    <label className="text-xs text-neutral-400">Skip Limited Stock</label>
                    <button 
                      onClick={() => setSkipLimitedStock(!skipLimitedStock)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-400/50 ${
                        skipLimitedStock ? 'bg-yellow-400' : 'bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out ${
                          skipLimitedStock ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-neutral-400">Use Market Value</label>
                            <button 
                              onClick={() => setUseMarketValue(!useMarketValue)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-400/50 ${
                                useMarketValue ? 'bg-yellow-400' : 'bg-neutral-700'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out ${
                                  useMarketValue ? 'translate-x-5' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {/* Skill slider */}
                <input
                  type="range"
                  min={1}
                  max={300}
                  value={skill}
                  onChange={(e) => handleSliderChange(+e.target.value)}
                  onMouseDown={handleSliderStart}
                  onTouchStart={handleSliderStart}
                  onMouseUp={handleSliderEnd}
                  onTouchEnd={handleSliderEnd}
                  className="flex-1 accent-yellow-300"
                />

                {/* Stepper input */}
                <div className="flex flex-col items-center bg-neutral-900 w-1/4">
                  <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => handleDirectSkillChange(skill - 1)}
                    >−</button>
                    
                    <input
                      type="number"
                      value={skill}
                      min={1}
                      max={300}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) {
                          handleDirectSkillChange(val);
                        }
                      }}
                      className="text-lg text-center w-12 bg-transparent outline-none appearance-none text-yellow-300
                                [&::-webkit-inner-spin-button]:appearance-none 
                                [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => handleDirectSkillChange(skill + 1)}
                    >+</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="mb-4">
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
                  {tab === 'route' ? 'Leveling Guide' : 'All Recipes'}
                  {view === tab && (
                    <motion.div
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-yellow-400"
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 px-2 py-1 w-full h-12 text-neutral-400 bg-neutral-900 border-b border-neutral-800 font-semibold text-[16px]">
              <span className="w-8 text-center">#</span>
              <span className="w-7" /> {/* icon space */}
              <span className="flex-1">Recipe</span>
              <span className="w-28 text-right">Total Cost</span>
              <span className="w-24 text-center">Skill</span>
            </div>
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 flex flex-col min-h-0">
            <section 
              ref={scrollRef}
              className="flex-1 overflow-y-scroll pb-15
                [&::-webkit-scrollbar]:w-2
                [&::-webkit-scrollbar-track]:bg-transparent
                [&::-webkit-scrollbar-thumb]:bg-neutral-600/40
                [&::-webkit-scrollbar-thumb]:rounded-full
                [&::-webkit-scrollbar-thumb]:transition-colors
                [&::-webkit-scrollbar-thumb]:duration-300
                hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600/60
                motion-safe:transition-[scrollbar-color]
                motion-safe:duration-300
                scrollbar-thin
                scrollbar-thumb-neutral-600/40
                hover:scrollbar-thumb-neutral-600/60"
            >
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={`${view}-${committedSkill}`}
                  initial={isDirectChange ? { opacity: 1, filter: 'blur(0px)' } : {
                    opacity: 0.85,
                    filter: 'blur(3px)'
                  }}
                  animate={isDirectChange ? { opacity: 1, filter: 'blur(0px)' } : {
                    opacity: isSliding ? 0.85 : 1,
                    filter: isSliding ? 'blur(3px)' : 'blur(0px)'
                  }}
                  transition={{ 
                    duration: 0.5,
                    ease: [0.4, 0.0, 0.2, 1]
                  }}
                  onAnimationComplete={() => {
                    if (!isSliding) {
                      setIsBlurComplete(true);
                    }
                  }}
                  className=""
                >
                  {view === 'route' ? (
                    <div className="flex flex-col">
                      {plan.steps.map((s, i) => {
                        if ('upgradeName' in s) {
                          return (
                            <motion.div
                              key={`upgrade-${s.upgradeName}-${s.endSkill}-${committedSkill}`}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 10 }}
                              transition={{ 
                                duration: 0.2,
                                ease: "easeInOut"
                              }}
                              className="relative flex items-center justify-center gap-1 bg-neutral-900 rounded-none px-2 py-1 w-full h-[60px] font-bold text-yellow-400"
                            >
                              ⚔️ {s.note ?? `Upgrade to ${s.upgradeName}`}
                            </motion.div>
                          );
                        }

                        const start = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
                        const end = s.endSkill;
                        const best = s.recipe;
                        
                        const candidates = recipes
                          .filter(r =>
                            r.minSkill <= start &&
                            (r.difficulty.gray ?? Infinity) >= end &&
                            r.id !== best.id &&
                            !blacklistedSpellIds.has(r.id) &&
                            (!skipLimitedStock || !(
                              r.source?.type === 'item' &&
                              r.source.recipeItemId &&
                              (materialInfo[r.source.recipeItemId]?.bop || materialInfo[r.source.recipeItemId]?.limitedStock)
                            ))
                          )
                          .map(r => {
                            const crafts = expectedCraftsBetween(start, end, r.difficulty);
                            const baseCost = calculateCraftCost(r, prices, materialInfo);
                            // Get recipe cost separately
                            const recipeCost = includeRecipeCost && r.source ? calculateCraftCost(r, prices, materialInfo, true, true) : 0;
                            // Total cost = (number of crafts * material costs) + recipe cost
                            const cost = (baseCost * crafts) + recipeCost;
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
                            key={`card-${best.name}-${end}-${committedSkill}`}
                            initial={shouldAnimate(best.name, end) ? { opacity: 0, x: -10 } : { opacity: 1, x: 0 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            transition={{ 
                              duration: 0.5,
                              ease: "easeOut"
                            }}
                            className="relative"
                          >
                            <div className="flex flex-col w-full backdrop-blur-sm">
                              {/* Primary card content */}
                              <div
                                id={`craft-${best.id}-${end}`}
                                onClick={() => handleCardClick(best.name, end, start, end, false, best.id)}
                                className={`relative flex items-center gap-1 px-2 py-1 w-full h-[60px] cursor-pointer
                                  transition-all duration-150 ease-out will-change-transform
                                  hover:bg-neutral-700 active:bg-neutral-700 active:scale-[0.99]
                                  ${isSelected(best.name, end) ? 'bg-neutral-600' : 'bg-neutral-900'}`}
                              >
                                <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                                  diffColor(committedSkill, best.difficulty)
                                }`} />
                                <span className="text-[16px] flex items-center justify-center w-8">
                                  {s.crafts}×
                                </span>
                                <img src={iconSrc(best.id, selectedProfession)} alt="" className="w-7 h-7 rounded object-cover" />
                                <span 
                                  className="truncate whitespace-nowrap flex-1 text-[16px]"
                                  style={{ color: qualityColors[s.recipe.quality] }}>
                                  {best.name.length <= 35 ? best.name : `${best.name.slice(0, 33)}…`}
                                </span>
                                <span className="text-[16px]">
                                  <FormatMoney copper={s.cost} />
                                </span>
                                <span className="flex-shrink-0 w-24 text-center text-yellow-200 bg-neutral-800 text-[16px] px-0 py-0 rounded-full">
                                  {start} → {end}
                                </span>
                              </div>

                              {/* Alternative cards */}
                              <AnimatePresence mode="sync">
                              {isExpanded(best.name, end) && (
                                <motion.div
                                  initial={shouldAnimate(best.name, end) ? { height: 0, opacity: 0 } : { height: 'auto', opacity: 1 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{
                                    height: {
                                      type: "tween",
                                      duration: 0.3,
                                      ease: "easeInOut"
                                    },
                                    opacity: {
                                      duration: 0.3
                                    }
                                  }}
                                >
                                  <motion.div
                                    initial={shouldAnimate(best.name, end) ? { opacity: 0, y: -20 } : { opacity: 1, y: 0 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{
                                      duration: 0.4,
                                      ease: "easeOut"
                                    }}
                                  >
                                  {candidates.map((alt: { recipe: Recipe; crafts: number; cost: number }, index) => (
                                    <motion.div
                                      key={`alt-${alt.recipe.name}-${end}-${committedSkill}`}
                                      initial={shouldAnimate(best.name, end) ? { opacity: 0, x: -20 } : { opacity: 1, x: 0 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      exit={{ opacity: 0, x: -20 }}
                                      transition={{ 
                                        duration: 0.3,
                                        ease: "easeOut"
                                      }}
                                      onClick={() => handleCardClick(alt.recipe.name, end, start, end, true, alt.recipe.id)}
                                      className={`relative flex items-center gap-1 rounded-none pl-2 pr-2 py-0.5 w-11/12 ml-auto cursor-pointer h-[60px] 
                                        transition-all duration-150 ease-out will-change-transform
                                        hover:bg-neutral-700 active:bg-neutral-700 active:scale-[0.99]
                                        ${isSelected(alt.recipe.name, end) ? 'bg-neutral-600' : 'bg-neutral-900'}`}
                                    >
                                      <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                                        diffColor(committedSkill, alt.recipe.difficulty)
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
                                        className="truncate whitespace-nowrap flex-1 text-[16px] pl-1"
                                        style={{ color: qualityColors[alt.recipe.quality] }}>
                                        {alt.recipe.name.length <= 35
                                          ? alt.recipe.name
                                          : `${alt.recipe.name.slice(0, 33)}…`}
                                      </span>
                                      <span className="text-[16px]">
                                        <FormatMoney copper={alt.cost} />
                                      </span>
                                    </motion.div>
                                  ))}
                                  </motion.div>
                                </motion.div>
                              )}
                              </AnimatePresence>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {filteredRecipes.map((r) => (
                        <div
                          key={r.id}
                          onClick={() => {
                            setSelectedRecipeId(r.id);
                            setRngLow(r.minSkill);
                            setRngHigh(r.difficulty.gray!);
                          }}
                          id={`recipe-${r.id}`}
                          className={`relative flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors duration-250 ease-in-out hover:bg-neutral-700 h-[60px]
                            ${selectedRecipeId === r.id ? 'bg-neutral-700':'bg-neutral-900'}`}
                        >
                          <span
                            className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                              diffColor(committedSkill, r.difficulty)
                            }`}
                          />
                          <div className="pl-3">
                            <img
                              src={iconSrc(r.id, selectedProfession)}
                              alt=""
                              className="w-7 h-7 rounded object-cover"
                            />
                          </div>
                          <span 
                            className="truncate whitespace-nowrap flex-1 text-[16px]"
                            style={{ color: qualityColors[r.quality ?? 1] }}>
                            {r.name.length <= 40 ? r.name : `${r.name.slice(0,37)}…`}
                          </span>
                          <span className="flex-shrink-0 w-24 text-center text-yellow-200 bg-neutral-800 text-[16px] px-0 py-0 rounded-full">
                            {r.minSkill}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </section>

            {/* Footer */}
            <div className="relative">
              <AnimatePresence mode="wait">
                {view === 'route' && (
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 20, opacity: 0 }}
                    transition={{ 
                      y: { duration: 0.2 },
                      opacity: { duration: 0.2 },
                      ease: "easeOut"
                    }}
                    className="absolute inset-x-0 bottom-0 bg-neutral-900/95 backdrop-blur-sm 
                              border-t border-neutral-700 py-3 px-4 text-center"
                  >
                    <div className="text-2xl font-semibold flex items-center justify-center relative">
                      <div>
                        <span className="text-neutral-400">Total Cost: </span>
                        <span className="text-yellow-300">
                          <FormatMoney copper={plan.totalCost} />
                        </span>
                      </div>
                      <div className="absolute right-0">
                        <button
                          onClick={() => setShowMaterials(!showMaterials)}
                          className="flex items-center gap-2 px-3 py-1.5 text-[15px] text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded font-extrabold transition-colors border border-neutral-600"
                        >
                          <span>Materials</span>
                          <svg
                            className={`w-4 h-4 transition-transform ${showMaterials ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </aside>

        {/* Materials Panel (now sibling to aside, not inside it) */}
        <AnimatePresence>
          {showMaterials && view === 'route' && (
            <motion.div
              initial={{ opacity: 0, x: -20, scaleX: 0.95 }}
              animate={{ opacity: 1, x: 0, scaleX: 1 }}
              exit={{ opacity: 0, x: -20, scaleX: 0.95 }}
              transition={{ 
                duration: 0.2,
                ease: "easeOut"
              }}
              className="absolute left-[37.5rem] top-0 w-64 h-full bg-neutral-900/95 backdrop-blur-sm rounded shadow-lg border border-neutral-800 z-50 origin-left"
            >
              <div className="p-3 h-full flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-neutral-200">Required Materials</h3>
                  <button
                    onClick={() => setShowMaterials(false)}
                    className="text-neutral-400 hover:text-neutral-200 transition-colors duration-200"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-2 overflow-y-auto flex-1">
                  {calculateTotalMaterials(plan.steps, materialInfo).map(material => (
                    <div key={material.itemId} className="flex justify-between items-center text-neutral-200">
                      <span className="flex-1">{material.name || `Item ${material.itemId}`}</span>
                      <span className="text-yellow-300 font-medium">
                        {material.quantity.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main panel */}
        <main className="relative z-0 flex flex-col flex-1 h-full overflow-y-auto focus:outline-none xl:order-last bg-neutral-950
          [&::-webkit-scrollbar]:w-2
          [&::-webkit-scrollbar-track]:bg-transparent
          [&::-webkit-scrollbar-thumb]:bg-neutral-600/40
          [&::-webkit-scrollbar-thumb]:rounded-full
          [&::-webkit-scrollbar-thumb]:transition-colors
          [&::-webkit-scrollbar-thumb]:duration-300
          hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600/60
          motion-safe:transition-[scrollbar-color]
          motion-safe:duration-300
          scrollbar-thin
          scrollbar-thumb-neutral-600/40
          hover:scrollbar-thumb-neutral-600/60">
        
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
                          const minSkill = selected.minSkill ?? 1;

                          const buildPath = (points: typeof probData) => points.map(({ skill, chance }) => {
                            const x = xScale(skill);
                            const y = yScale(chance);
                            return `M${x},${y} m-${r},0 a${r},${r} 0 1,0 ${2*r},0 a${r},${r} 0 1,0 -${2*r},0`;
                          }).join(' ');

                          const orangePts = probData.filter(d => d.skill >= minSkill && d.skill < yellow!);
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
                        // extract key so we don't spread it
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
                        className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
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
                        className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
                        onClick={() => setRngLow(rngLow + 1)}
                      >+</button>
                    </div>
                  </div>
                  <div className="flex flex-col items-center bg-neutral-900 rounded-b border border-neutral-700 w-1/2 p-3 border-t-0 -mt-0.5 border-l-0 border-r-0 -mr-1">
                    <span className="text-xs text-neutral-400 bg-neutral-900 mb-1 p-2">TO</span>
                    <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                      <button
                        className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
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
                        className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-10 h-10"
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
                <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Cost Calculations</h3>
              </div>
              <div className="flex justify-between items-stretch bg-neutral-800 divide-x divide-neutral-800 overflow-hidden text-neutral-100 text-[16px] h-24">
                <div className="flex-1 flex flex-col items-center justify-center p-4">
                  <span className="text-neutral-400 mb-2">Base Cost Per Attempt</span>
                  <span className="text-xl font-semibold">
                    <FormatMoney copper={calculateCraftCost(selected, prices, materialInfo)} />
                  </span>
                </div>
                {selected && selected.source?.type === 'item' && selected.source.recipeItemId ? (
                  (() => {
                    const recipeInfo = materialInfo[selected.source.recipeItemId];
                    const recipeId = selected.source.recipeItemId;
                    const priceData = prices[recipeId];
                    console.log('Recipe Info:', {
                      recipeId,
                      recipeInfo,
                      priceData,
                      rawPrices: prices[recipeId],
                      minBuyout: priceData?.minBuyout,
                      marketValue: priceData?.marketValue,
                      vendorPrice: recipeInfo?.buyPrice,
                      limitedStock: recipeInfo?.limitedStock,
                      auctionhouse: recipeInfo?.auctionhouse
                    });
                    // Get AH price directly from price data
                    const ahPrice = priceData?.minBuyout ?? priceData?.marketValue;
                    
                    if (recipeInfo?.bop) {
                      return (
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                          <span className="text-neutral-400 mb-2">Recipe Cost</span>
                          <span className="text-red-400 text-base">Not Available (BoP)</span>
                        </div>
                      );
                    }

                    // For all non-BoP recipes, show both vendor and AH prices if they exist
                    return (
                      <>
                        {recipeInfo?.buyPrice && (
                          <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <span className="text-neutral-400 mb-2">Vendor Recipe Cost</span>
                            <div className="flex flex-col items-center gap-1">
                              {recipeInfo.limitedStock && (
                                <div className="text-base text-yellow-400 flex items-center gap-1">
                                  <span>⚠️ Limited Stock</span>
                                </div>
                              )}
                              <span className="text-xl font-semibold">
                                <FormatMoney copper={recipeInfo.buyPrice} />
                              </span>
                            </div>
                          </div>
                        )}
                        {ahPrice && ahPrice > 0 && (
                          <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <span className="text-neutral-400 mb-2">AH Recipe Cost</span>
                            <span className="text-xl font-semibold">
                              <FormatMoney copper={ahPrice} />
                            </span>
                          </div>
                        )}
                        {!recipeInfo?.buyPrice && (!ahPrice || ahPrice <= 0) && (
                          <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <span className="text-neutral-400 mb-2">Recipe Cost</span>
                            <span className="text-red-400 text-base">No price available</span>
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-4">
                    <span className="text-neutral-400 mb-2">Recipe Cost</span>
                    <span className="text-xl font-semibold">
                      <FormatMoney copper={selected?.source?.type === 'trainer' ? (selected.source.cost ?? 0) : 0} />
                    </span>
                  </div>
                )}
                <div className="flex-1 flex flex-col items-center justify-center p-4">
                  <span className="text-neutral-400 mb-2">Average Cost Per Level</span>
                  <span className="text-xl font-semibold">
                    <FormatMoney copper={selected ? (Object.values(materialTotals).reduce((s, m) => s + m.craftCost, 0) / totalLevelUps) : 0} />
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-6 bg-neutral-900 sm:border-t-0 sm:py-6 sm:rounded-t-lg sm:px-6">
                <h3 className="text-base font-medium leading-6 text-white lg:text-lg">Material Calculations</h3>
              </div>
              <div className="px-6 py-6">
                <MaterialTreeFlat rootNodes={materialTrees} materialInfo={materialInfo} expCrafts={expCrafts} />
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