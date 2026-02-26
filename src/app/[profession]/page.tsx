'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
// Vanilla recipes
import vanillaAlchemy from '@/data/recipes/vanilla/alchemy.json';
import vanillaBlacksmithing from '@/data/recipes/vanilla/blacksmithing.json';
import vanillaEnchanting from '@/data/recipes/vanilla/enchanting.json';
import vanillaEngineering from '@/data/recipes/vanilla/engineering.json';
import vanillaLeatherworking from '@/data/recipes/vanilla/leatherworking.json';
import vanillaTailoring from '@/data/recipes/vanilla/tailoring.json';
// TBC recipes
import tbcAlchemy from '@/data/recipes/tbc/alchemy.json';
import tbcBlacksmithing from '@/data/recipes/tbc/blacksmithing.json';
import tbcEnchanting from '@/data/recipes/tbc/enchanting.json';
import tbcEngineering from '@/data/recipes/tbc/engineering.json';
import tbcJewelcrafting from '@/data/recipes/tbc/jewelcrafting.json';
import tbcLeatherworking from '@/data/recipes/tbc/leatherworking.json';
import tbcTailoring from '@/data/recipes/tbc/tailoring.json';
import type { Recipe, MaterialInfo, MaterialTreeNode } from '@/lib/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceLine, Customized  } from "recharts";
import { makeDynamicPlan, blacklistedSpellIds, MaterialRequirement, getMinSoldPerDayForProfession } from '@/lib/planner';
import { getEffectiveMinSkill } from '@/lib/recipeCalc';
import { getRegionIdForRealm, buildRegionSoldPerDayMap, type RegionItemStat } from '@/lib/regionDataLoader';
import { ENCHANTING_ROD_SPELL_IDS, ENCHANTING_ROD_PRODUCT_ITEM_IDS } from '@/lib/rodConstants';
import { expectedSkillUps, craftCost as calculateCraftCost, getItemCost, buildMaterialTree, expectedCraftsBetween, getRecipeCost } from '@/lib/recipeCalc';
import { toPriceMap }      from '@/lib/pricing';
import { Range, getTrackBackground } from 'react-range';
import Fuse from 'fuse.js';
import { Listbox } from '@headlessui/react';
import { materialInfoMap } from '@/lib/materialsLoader';
import { FormatMoney } from '@/lib/utils';
import { getDisenchantOutcomes, getExpectedDisenchantValue } from '@/lib/disenchant';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from 'use-debounce';
import { useRouter, useParams, useSearchParams } from 'next/navigation';

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
  'Jewelcrafting',
  'Leatherworking',
  'Tailoring',
];

// Max skill level per version
const MAX_SKILL_VANILLA = 300;
const MAX_SKILL_TBC = 375;

function getMaxSkill(version: string): number {
  return version === 'The Burning Crusade' ? MAX_SKILL_TBC : MAX_SKILL_VANILLA;
}

// Version-keyed recipe data (vanilla/ and tbc/ directories)
const rawDataMap: Record<string, Record<string, any[]>> = {
  Vanilla: {
    Alchemy: vanillaAlchemy as any[],
    Blacksmithing: vanillaBlacksmithing as any[],
    Enchanting: vanillaEnchanting as any[],
    Engineering: vanillaEngineering as any[],
    Leatherworking: vanillaLeatherworking as any[],
    Tailoring: vanillaTailoring as any[],
  },
  'The Burning Crusade': {
    Alchemy: tbcAlchemy as any[],
    Blacksmithing: tbcBlacksmithing as any[],
    Enchanting: tbcEnchanting as any[],
    Engineering: tbcEngineering as any[],
    Jewelcrafting: tbcJewelcrafting as any[],
    Leatherworking: tbcLeatherworking as any[],
    Tailoring: tbcTailoring as any[],
  },
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

// Function to load region data for soldPerDay sanity-check in auction-house mode
async function loadRegionData(regionId: number): Promise<Map<number, number>> {
  const regionNames: Record<number, string> = { 1: 'North_America', 2: 'Europe' };
  const name = regionNames[regionId] ?? 'North_America';
  try {
    const data = await import(`@/data/prices/region_${regionId}_${name}.json`);
    const rows = (data.default ?? data) as RegionItemStat[];
    return buildRegionSoldPerDayMap(Array.isArray(rows) ? rows : []);
  } catch {
    return new Map();
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

// expectedCraftsBetween is now imported from recipeCalc.ts

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

/** Cost with red - for expense, green + for profit (used when price sourcing subtracts output value) */
function SignedCost({ copper }: { copper: number }) {
  if (copper > 0) {
    return <span className="text-red-400">−<FormatMoney copper={copper} /></span>;
  }
  if (copper < 0) {
    return <span className="text-green-400">+<FormatMoney copper={-copper} /></span>;
  }
  return <FormatMoney copper={0} />;
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
              <div className="text-xs text-neutral-400 mt-1">
                Per Craft: <SafeMoney value={node.craftCost / expCrafts} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-end text-right">
              <span className="text-yellow-300 text-base font-normal">
                <SafeMoney
                  value={node.buyCost}
                  fallback="⚠️ No price available"
                />
              </span>
              <span className="text-xs text-neutral-400 mt-1">
                Per Craft: <SafeMoney value={node.buyCost / expCrafts} />
              </span>
            </div>
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
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const urlProfession = params.profession as string;
  const urlSkill = searchParams.get('skill');
  const urlTarget = searchParams.get('target');
  const urlVersion = searchParams.get('version');
  const urlRealm = searchParams.get('realm');
  const urlFaction = searchParams.get('faction');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const [skill, setSkill] = useState(1);
  const [debouncedSkill] = useDebounce(skill, 200);
  const [committedSkill, setCommittedSkill] = useState(1);
  // Initialize target based on version (default to TBC max)
  const [target, setTarget] = useState(() => {
    if (urlVersion && urlVersion.toLowerCase() === 'vanilla') {
      return MAX_SKILL_VANILLA;
    }
    return MAX_SKILL_TBC;
  });
  const [committedTarget, setCommittedTarget] = useState(() => {
    if (urlVersion && urlVersion.toLowerCase() === 'vanilla') {
      return MAX_SKILL_VANILLA;
    }
    return MAX_SKILL_TBC;
  });
  const [view, setView] = useState<'route'|'all'>('route');
  const [selectedRecipeId, setSelectedRecipeId] = useState<number|null>(null);
  const [selectedCardKey, setSelectedCardKey] = useState<string|null>(null);
  const [visibleCardKey, setVisibleCardKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  // Initialize profession from URL if available, otherwise default to Enchanting
  // Use lazy initializer function to read from URL params
  const [selectedProfession, setSelectedProfession] = useState(() => {
    if (urlProfession) {
      const normalizedProfession = urlProfession.charAt(0).toUpperCase() + urlProfession.slice(1).toLowerCase();
      // Check if profession is valid and available for the initial version
      const initialVersion = urlVersion ? 
        (urlVersion.toLowerCase() === 'the burning crusade' || urlVersion.toLowerCase() === 'tbc' ? 'The Burning Crusade' : 'Vanilla') 
        : 'The Burning Crusade';
      const initialAvailableProfessions = initialVersion === 'The Burning Crusade' 
        ? professions 
        : professions.filter(p => p !== 'Jewelcrafting');
      if (initialAvailableProfessions.includes(normalizedProfession)) {
        return normalizedProfession;
      }
    }
    return 'Enchanting';
  });
  // Define realms and factions early for use in initial state
  const realms = useMemo(() => ["Thunderstrike", "Spineshatter", "Soulseeker", "Dreamscythe", "Nightslayer", "Doomhowl"], []);
  const factions = useMemo(() => ["Alliance", "Horde"], []);
  
  // Initialize from URL params if available
  const [selectedVersion, setSelectedVersion] = useState(() => {
    if (urlVersion) {
      const normalizedVersion = urlVersion.charAt(0).toUpperCase() + urlVersion.slice(1).toLowerCase();
      if (normalizedVersion === 'Vanilla' || normalizedVersion === 'The Burning Crusade' || normalizedVersion === 'Tbc') {
        return normalizedVersion === 'Tbc' ? 'The Burning Crusade' : normalizedVersion;
      }
    }
    return 'The Burning Crusade';
  });

  // Get max skill for current version
  const maxSkill = useMemo(() => getMaxSkill(selectedVersion), [selectedVersion]);

  // Version-specific material data (vanilla vs TBC have different vendor prices, createdBy, etc.)
  const materialInfo = materialInfoMap[selectedVersion] ?? materialInfoMap['The Burning Crusade'];

  // Filter professions based on version (Jewelcrafting only available in TBC)
  const availableProfessions = useMemo(() => {
    if (selectedVersion === 'The Burning Crusade') {
      return professions; // All professions including Jewelcrafting
    }
    return professions.filter(p => p !== 'Jewelcrafting'); // Exclude Jewelcrafting in Vanilla
  }, [selectedVersion]);
  const [selectedRealm, setSelectedRealm] = useState(() => {
    if (urlRealm) {
      const normalizedRealm = realms.find(r => r.toLowerCase() === urlRealm.toLowerCase());
      if (normalizedRealm) {
        return normalizedRealm;
      }
    }
    return 'Thunderstrike';
  });
  const [selectedFaction, setSelectedFaction] = useState(() => {
    if (urlFaction) {
      const normalizedFaction = factions.find(f => f.toLowerCase() === urlFaction.toLowerCase());
      if (normalizedFaction) {
        return normalizedFaction;
      }
    }
    return 'Alliance';
  });
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [useMarketValue, setUseMarketValue] = useState(false);
  const optimizeSubCrafting = false; // Sub-crafting optimization disabled
  const [priceSourcing, setPriceSourcing] = useState<'cost' | 'cost-vendor' | 'disenchant' | 'auction-house'>('cost');

  // Add isSliding state to track active slider interaction
  const [isSliding, setIsSliding] = useState(false);
  const [isReleased, setIsReleased] = useState(false);
  const [isDirectChange, setIsDirectChange] = useState(false);
  const [includeRecipeCost, setIncludeRecipeCost] = useState(true);
  const skipLimitedStock = true; // Always skip limited-stock BoP recipes
  const [recalculateForEachLevel, setRecalculateForEachLevel] = useState(false);
  const [shouldBlur, setShouldBlur] = useState(false);
  const [isBlurComplete, setIsBlurComplete] = useState(true);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add state for prices
  const [prices, setPrices] = useState<any>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  // Region data for soldPerDay sanity-check in auction-house mode
  const [regionSoldPerDay, setRegionSoldPerDay] = useState<Map<number, number> | null>(null);
  // Track the current price loading request to ignore outdated ones
  const priceLoadRequestIdRef = useRef(0);
  
  const lastSkillChange = useRef<number>(Date.now());
  const lastSkillValue = useRef<number>(skill);

  const [sliderValue, setSliderValue] = useState([committedSkill, committedTarget]);

  // When committedSkill/committedTarget change, update the sliderValue
  useEffect(() => {
    setSliderValue([committedSkill, committedTarget]);
  }, [committedSkill, committedTarget]);

  // Handle URL profession parameter changes (when URL changes after initial load)
  useEffect(() => {
    if (urlProfession) {
      const normalizedProfession = urlProfession.charAt(0).toUpperCase() + urlProfession.slice(1).toLowerCase();
      if (availableProfessions.includes(normalizedProfession)) {
        // Only update if it's different from current to prevent unnecessary updates
        if (normalizedProfession !== selectedProfession) {
          setSelectedProfession(normalizedProfession);
        }
      } else {
        // Invalid profession in URL or not available for current version, redirect to default
        router.push('/enchanting');
      }
    } else {
      // No profession in URL, default to Enchanting
      if (selectedProfession !== 'Enchanting') {
        setSelectedProfession('Enchanting');
      }
    }
  }, [urlProfession, router, selectedProfession, availableProfessions]);

  // Redirect away from Jewelcrafting if switching from TBC to Vanilla
  useEffect(() => {
    if (selectedVersion === 'Vanilla' && selectedProfession === 'Jewelcrafting') {
      // Redirect to Enchanting if on Jewelcrafting when switching to Vanilla
      const params = new URLSearchParams();
      if (committedSkill > 1) params.set('skill', committedSkill.toString());
      if (committedTarget < getMaxSkill(selectedVersion)) params.set('target', committedTarget.toString());
      params.set('realm', selectedRealm);
      params.set('faction', selectedFaction);
      const queryString = params.toString();
      const newUrl = `/enchanting${queryString ? `?${queryString}` : ''}`;
      router.push(newUrl, { scroll: false });
      setSelectedProfession('Enchanting');
    }
  }, [selectedVersion, selectedProfession, committedSkill, committedTarget, selectedRealm, selectedFaction, router]);

  // Handle URL skill parameter
  useEffect(() => {
    if (urlSkill) {
      const skillLevel = parseInt(urlSkill);
      if (!isNaN(skillLevel) && skillLevel >= 1 && skillLevel <= maxSkill) {
        setSkill(skillLevel);
        setCommittedSkill(skillLevel);
        lastSkillValue.current = skillLevel;
      }
    }
  }, [urlSkill]);

  // Handle URL target parameter
  useEffect(() => {
    // Store the previous max skill before checking URL
    const previousMaxFromUrl = urlMaxSkillRef.current;
    
    if (urlTarget) {
      const targetLevel = parseInt(urlTarget);
      if (!isNaN(targetLevel) && targetLevel >= 1 && targetLevel <= maxSkill) {
        // Only update if the URL target is different from current committed target
        // Also check if the URL target is the previous max skill from URL (indicating a version change)
        // In that case, ignore it and let the version change effect handle the update
        const isPreviousMaxSkillFromUrl = targetLevel === previousMaxFromUrl;
        if (targetLevel !== committedTarget && !isPreviousMaxSkillFromUrl) {
          setTarget(targetLevel);
          setCommittedTarget(targetLevel);
        }
      }
    }
    // Update the URL max skill ref when maxSkill changes (after checking)
    urlMaxSkillRef.current = maxSkill;
  }, [urlTarget, maxSkill, committedTarget]);

  // Handle URL version parameter
  useEffect(() => {
    if (urlVersion) {
      const normalizedVersion = urlVersion.charAt(0).toUpperCase() + urlVersion.slice(1).toLowerCase();
      const versions = ["Vanilla", "The Burning Crusade"];
      if (versions.includes(normalizedVersion) || normalizedVersion === 'Tbc') {
        setSelectedVersion(normalizedVersion === 'Tbc' ? 'The Burning Crusade' : normalizedVersion);
      } else {
        // Invalid version in URL, redirect to default
        router.push('/enchanting');
      }
    }
  }, [urlVersion, router]);

  // Handle URL faction parameter
  useEffect(() => {
    if (urlFaction) {
      const normalizedFaction = factions.find(f => f.toLowerCase() === urlFaction.toLowerCase());
      if (normalizedFaction) {
        setSelectedFaction(normalizedFaction);
      }
    }
  }, [urlFaction]);

  // Helper function to build URL with all parameters
  const buildUrlWithParams = (profession: string, skill: number, target: number, version: string, realm: string, faction: string) => {
    const params = new URLSearchParams();
    if (skill > 1) params.set('skill', skill.toString());
    const maxSkillForVersion = getMaxSkill(version);
    if (target < maxSkillForVersion) params.set('target', target.toString());
    if (version !== 'The Burning Crusade') params.set('version', version);
    // Always include realm parameter
    params.set('realm', realm);
    // Always include faction parameter
    params.set('faction', faction);
    
    const queryString = params.toString();
    return `/${profession.toLowerCase()}${queryString ? `?${queryString}` : ''}`;
  };

  // Update URL when any selector changes
  const updateUrl = useCallback((overrides?: { realm?: string; faction?: string; version?: string }) => {
    const realm = overrides?.realm ?? selectedRealm;
    const faction = overrides?.faction ?? selectedFaction;
    const version = overrides?.version ?? selectedVersion;
    const newUrl = buildUrlWithParams(selectedProfession, committedSkill, committedTarget, version, realm, faction);
    router.push(newUrl, { scroll: false });
  }, [selectedProfession, committedSkill, committedTarget, selectedRealm, selectedFaction, selectedVersion, router]);
  
  // Track recent user-initiated changes to prevent URL effects from overwriting them
  // We track the timestamp of any recent change, not the specific value
  const recentUserChangeTimestampRef = useRef<number>(0);
  // Track previous max skill to detect version changes
  const previousMaxSkillRef = useRef(getMaxSkill(selectedVersion));
  // Track the max skill that was in the URL before version change (for URL handler)
  const urlMaxSkillRef = useRef(getMaxSkill(selectedVersion));
  // Refs to access current values in useEffect without adding them as dependencies
  const committedSkillRef = useRef(committedSkill);
  const committedTargetRef = useRef(committedTarget);
  
  // Keep refs in sync with state
  useEffect(() => {
    committedSkillRef.current = committedSkill;
  }, [committedSkill]);
  
  useEffect(() => {
    committedTargetRef.current = committedTarget;
  }, [committedTarget]);

  // Ref to track pending profession change - prevents re-render until data is ready
  const pendingProfessionRef = useRef<string | null>(null);
  // Counter to force useMemo recalculation when pendingProfessionRef changes
  // This doesn't affect UI rendering, just triggers useMemo dependencies
  const [pendingProfessionCounter, setPendingProfessionCounter] = useState(0);
  
  // Handle profession change and update URL
  const handleProfessionChange = (newProfession: string) => {
    // CRITICAL: Preserve current recipe and plan BEFORE starting profession change
    // This keeps them visible until the new profession's data is ready
    if (selected) {
      preservedRecipeRef.current = selected;
      preservedRecipeProfessionRef.current = selectedProfession; // Track which profession this recipe belongs to
    }
    // Preserve current plan
    preservedPlanRef.current = plan;
    // Update previous profession ref for animation detection
    previousProfessionForAnimationRef.current = selectedProfession;
    
    // Store new profession in ref - DON'T update selectedProfession state yet
    // This prevents re-render - we'll update state once all data is ready
    pendingProfessionRef.current = newProfession;
    
    // Update URL immediately for navigation
    const newUrl = buildUrlWithParams(newProfession, committedSkill, committedTarget, selectedVersion, selectedRealm, selectedFaction);
    router.push(newUrl, { scroll: false }); // Prevent scroll jump during navigation
    
    // Increment counter to trigger useMemo recalculation (but selectedProfession stays unchanged)
    setPendingProfessionCounter(c => c + 1);
  };

  // Handle version change - URL will be updated by the version change effect
  const handleVersionChange = (newVersion: string) => {
    setSelectedVersion(newVersion);
    // Don't call updateUrl here - let the version change effect handle it
    // after it has updated the skill/target values
  };

  // Handle realm change and update URL
  const handleRealmChange = (newRealm: string) => {
    // Track timestamp of user-initiated change
    recentUserChangeTimestampRef.current = Date.now();
    setSelectedRealm(newRealm);
    updateUrl({ realm: newRealm });
  };

  // Handle faction change and update URL
  const handleFactionChange = (newFaction: string) => {
    // Track timestamp of user-initiated change
    recentUserChangeTimestampRef.current = Date.now();
    setSelectedFaction(newFaction);
    updateUrl({ faction: newFaction });
  };

  // Track the last non-debounced skill value
  useEffect(() => {
    lastSkillValue.current = skill;
  }, [skill]);

  // Coordinate sliding state with debounced value - improved to prevent snapping
  useEffect(() => {
    // Only update committed skill when we're not actively sliding and the values match
    if (isReleased && !isSliding && skill === debouncedSkill && skill === lastSkillValue.current) {
      setCommittedSkill(skill);
      setIsReleased(false);
      setIsBlurComplete(true);
      // Update URL when skill is committed
      updateUrl();
    }
  }, [debouncedSkill, isReleased, isSliding, skill, updateUrl]);

  const handleSliderStart = () => {
    setIsDirectChange(false);
    setIsSliding(true);
    setIsReleased(false);
    setIsBlurComplete(false);
    setShouldBlur(true);
    // Clear any existing timeout
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const handleSliderEnd = () => {
    setIsReleased(true);
    setIsSliding(false);
    // Remove the delay: fade out blur immediately in parallel with content
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    setShouldBlur(false);
    blurTimeoutRef.current = null;
    // Immediately commit the current skill value when sliding ends
    setCommittedSkill(skill);
    setCommittedTarget(target);
    lastSkillValue.current = skill;
    setIsBlurComplete(true);
    updateUrl();
  };

  const handleSliderChange = (value: number) => {
    setSkill(value);
    lastSkillChange.current = Date.now();
  };

  const handleDirectSkillChange = (newValue: number) => {
    const boundedValue = Math.min(maxSkill, Math.max(1, newValue));
    setIsDirectChange(true);
    setIsSliding(false);
    setIsReleased(false);
    setShouldBlur(false);
    // Clear any existing blur timeout
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setSkill(boundedValue);
    setCommittedSkill(boundedValue);
    lastSkillValue.current = boundedValue;
    setIsBlurComplete(true);
    
    // Ensure target is at least skill + 1
    if (target <= boundedValue) {
      const newTarget = Math.min(maxSkill, boundedValue + 1);
      setTarget(newTarget);
      setCommittedTarget(newTarget);
    }
    
    // Update URL immediately for direct changes
    updateUrl();
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

  // Cleanup blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const tabs = ['route', 'all'] as const;

  // CRITICAL: Declare all refs BEFORE recipes useMemo so they're available
  // Ref to preserve the current recipe during profession transitions
  // When profession changes, we keep showing this recipe until the new one is ready
  const preservedRecipeRef = useRef<Recipe | null>(null);
  // Track which profession the preserved recipe belongs to
  const preservedRecipeProfessionRef = useRef<string | null>(null);
  // Ref to preserve the current plan during profession transitions
  // When profession changes, we keep showing the old plan until the new one is ready
  const preservedPlanRef = useRef<ReturnType<typeof makeDynamicPlan> | null>(null);
  // Track previous profession to detect profession changes (for animation)
  const previousProfessionForAnimationRef = useRef<string>(selectedProfession);
  
  const recipes: Recipe[] = useMemo(() => {
    // Use pending profession if it exists, otherwise use current profession
    const activeProfession = pendingProfessionRef.current || selectedProfession;
    const versionData = rawDataMap[selectedVersion];
    const raw = (versionData?.[activeProfession] || []) as any[];

    return raw.map((r) => {
      const materials: Record<string, number> = {};
      for (const [id, qty] of Object.entries(r.materials || {})) {
        if (typeof qty === 'number' && qty > 0) materials[id] = qty;
      }
      return {
        ...r,
        quality: typeof r.quality === 'number' ? r.quality : 1,
        materials,
      } as Recipe;
    });
  }, [selectedProfession, selectedVersion, pendingProfessionCounter]);

  // Create a Set of recipe IDs for the current profession (for sub-crafting optimization)
  const currentProfessionRecipeIds = useMemo(() => {
    return new Set(recipes.map(r => r.id));
  }, [recipes]);

  // Helper to get the correct profession for a recipe's icon
  // Uses preserved profession if recipe is from preserved ref, otherwise uses active profession
  const getRecipeProfession = (recipeId: number, currentProfession: string): string => {
    // If recipe matches preserved recipe, use preserved profession
    if (preservedRecipeRef.current && recipeId === preservedRecipeRef.current.id && preservedRecipeProfessionRef.current) {
      return preservedRecipeProfessionRef.current;
    }
    // Check if recipe exists in current recipes array - if so, it belongs to the active profession
    // (which could be pendingProfessionRef.current during transition)
    const activeProfession = pendingProfessionRef.current || currentProfession;
    const recipeExistsInCurrent = recipes.some(r => r.id === recipeId);
    if (recipeExistsInCurrent) {
      return activeProfession;
    }
    // Recipe not in current recipes and not preserved - use current profession as fallback
    return currentProfession;
  };

  // Use committedSkill for the plan calculation
  const plan = useMemo(() => {
    // If there's a pending profession change, show preserved plan to prevent flickering
    // We'll update to the new plan once selectedProfession updates
    if (pendingProfessionRef.current && preservedPlanRef.current) {
      return preservedPlanRef.current;
    }
    
    // Use pending profession if it exists, otherwise use current profession
    // This allows us to calculate plan for the new profession without updating selectedProfession
    const activeProfession = pendingProfessionRef.current || selectedProfession;
    
    // Don't calculate plan while prices are loading to prevent empty plan flash
    if (isLoadingPrices) {
      return {
        steps: [],
        totalCost: 0,
        finalSkill: committedSkill,
      };
    }
    
    if (!recipes.length) {
      return {
        steps: [],
        totalCost: 0,
        finalSkill: committedSkill,
      };
    }
    
    // Don't calculate if prices object is empty (not yet loaded)
    if (Object.keys(prices).length === 0) {
      return {
        steps: [],
        totalCost: 0,
        finalSkill: committedSkill,
      };
    }
    
    const newPlan = makeDynamicPlan(
      committedSkill,
        committedTarget,
        recipes,
        prices,
        materialInfo,
      activeProfession,
        includeRecipeCost,
      skipLimitedStock,
      useMarketValue,
      recalculateForEachLevel,
      optimizeSubCrafting,
      currentProfessionRecipeIds,
      priceSourcing,
      priceSourcing === 'auction-house' ? (regionSoldPerDay ?? undefined) : undefined
    );
    
    // Update preserved plan ref for next transition
    preservedPlanRef.current = newPlan;
    
    return newPlan;
  }, [committedSkill, committedTarget, recipes, prices, selectedProfession, includeRecipeCost, skipLimitedStock, useMarketValue, recalculateForEachLevel, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, regionSoldPerDay, isLoadingPrices]);

  const fuse = useMemo(
    () => new Fuse(recipes, { keys: ['name'], threshold: 0.3 }),
    [recipes]
  );

  useEffect(() => {
    setRngLow(committedSkill);
    setRngHigh(committedTarget);
  }, [committedSkill, committedTarget]);


  // Use committedSkill for effects that trigger recipe selection
  useEffect(() => {
    // Skip if there's a pending profession change (it will handle selection)
    if (pendingProfessionRef.current) return;
    
    // Reset states when view changes
    setSelectedCardKey(null);
    setVisibleCardKey(null);
    // Don't automatically select a recipe - let user select manually
  }, [view]);

  // Use faster debounced value for visual updates like difficulty colors
  const startOf = (i: number) => (i === 0 ? committedSkill : plan.steps[i - 1].endSkill);
  const sortedAll = useMemo(() => 
    [...recipes]
      .filter(r => !blacklistedSpellIds.has(r.id))
      .sort((a, b) => (a.minSkill ?? 1) - (b.minSkill ?? 1)), 
    [recipes]
  );

  const filteredRecipes = useMemo(() => {
    if (view === 'all') {
      return searchTerm
        ? fuse.search(searchTerm).map(result => result.item)
        : sortedAll;
    }
    return [];
  }, [view, searchTerm, fuse, sortedAll]);
  
  // Store previous recipe to show during profession transitions
  // Why useMemo here?
  // 1. Memoization: Avoids recalculating the selected recipe on every render
  // 2. Side effects: Updates refs (previousRecipeRef, previousProfessionRef) when dependencies change
  // 3. Dependency tracking: Only recalculates when selectedRecipeId, recipes, or profession changes
  // 4. React optimization: Prevents unnecessary re-renders of components that depend on `selected`
  // Without useMemo, this would run on every render, even when nothing relevant changed
  const selected = useMemo<Recipe|null>(() => {
    // If selectedRecipeId is set, use it - this is the correct recipe
    if (selectedRecipeId !== null) {
      const found = recipes.find(r => r.id === selectedRecipeId);
      if (found) {
        // Update preserved recipe ref for next transition
        preservedRecipeRef.current = found;
        preservedRecipeProfessionRef.current = selectedProfession; // Track current profession
        return found;
      }
    }
    
    // If selectedRecipeId is null, show preserved recipe (keeps current recipe visible during transition)
    if (preservedRecipeRef.current) {
      return preservedRecipeRef.current;
    }
    
    // No recipe available
    return null;
  }, [selectedRecipeId, recipes, selectedProfession]);

  const [rngLow, setRngLow]   = useState(1);
  const [rngHigh, setRngHigh] = useState(maxSkill);


  const sliderMin = selected?.minSkill            ?? 1;
  const sliderMax = selected?.difficulty.gray     ?? maxSkill;

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
    if (!selected || totalLevelUps <= 0) return 0;
    // Use expectedCraftsBetween to match planner calculations (sum-of-reciprocals method)
    return expectedCraftsBetween(clampedLow, clampedHigh, selected.difficulty);
  }, [selected, clampedLow, clampedHigh, totalLevelUps]);

  useEffect(() => {
    if (!selected) {
      // If no recipe selected, update rngHigh to maxSkill when version changes
      setRngHigh(maxSkill);
      return;
    }
    const min = selected.minSkill;
    const max = selected.difficulty.gray ?? min;
    setRngLow((current: number) => Math.max(min, Math.min(current, max)));
    setRngHigh((current: number) => Math.max(min, Math.min(current, max)));
  }, [selected, maxSkill]);

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
      if (ENCHANTING_ROD_SPELL_IDS.has(selected.id) && ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(itemId)) continue;
      const qty = perCraft * expCrafts;
    
      const buyUnit = useMarketValue ?
        (prices[itemId]?.marketValue ?? prices[itemId]?.minBuyout ?? Infinity) :
        (prices[itemId]?.minBuyout ?? prices[itemId]?.marketValue ?? Infinity);
      const craftUnit = getItemCost(itemId, prices, materialInfo, new Map(), true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds);
      
      const buyCost = buyUnit * qty;
      const craftCost = craftUnit * qty;
      const saved = Math.max(0, buyCost - craftCost);
    
      out[id] = { qty, buyCost, craftCost, saved };
    }
    return out;
  }, [selected, expCrafts, prices, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds]);

  const materialTrees = Object.entries(materialTotals).map(([id, { qty }]) => {
    return buildMaterialTree(parseInt(id), qty, prices, materialInfo, true, new Set(), useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds);
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
  ? Array.from(new Set([
      selected.difficulty.orange,
      selected.difficulty.yellow,
      selected.difficulty.green,
      selected.difficulty.gray
    ].filter((v): v is number => typeof v === 'number')))
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
  }, [committedSkill, plan.steps]);

  const lastViewChange = useRef(view);

  // CRITICAL: Effect to handle pending profession changes
  // This batches all state updates together - only triggers ONE re-render when everything is ready
  useEffect(() => {
    // Check if there's a pending profession change
    if (!pendingProfessionRef.current) return;
    
    const pendingProfession = pendingProfessionRef.current;
    
    // Wait for prices to load (they're already loading based on realm/faction)
    // Prices are needed for plan calculation, so we must wait for them
    if (isLoadingPrices) return;
    
    // Get recipes for pending profession (they're already available in rawDataMap)
    const versionData = rawDataMap[selectedVersion];
    const rawPendingRecipes = (versionData?.[pendingProfession] || []) as any[];
    if (rawPendingRecipes.length === 0) return;

    const pendingRecipes: Recipe[] = rawPendingRecipes.map((r) => {
      const materials: Record<string, number> = {};
      for (const [id, qty] of Object.entries(r.materials || {})) {
        if (typeof qty === 'number' && qty > 0) materials[id] = qty;
      }
      return { ...r, quality: typeof r.quality === 'number' ? r.quality : 1, materials } as Recipe;
    });
    
    // Calculate plan for pending profession BEFORE updating state
    // This ensures we have the recipe selected before the re-render
    const pendingPlan = makeDynamicPlan(
      committedSkill,
      committedTarget,
      pendingRecipes,
      prices,
      materialInfo,
      pendingProfession,
      includeRecipeCost,
      skipLimitedStock,
      useMarketValue,
      recalculateForEachLevel,
      optimizeSubCrafting,
      currentProfessionRecipeIds,
      priceSourcing,
      priceSourcing === 'auction-house' ? (regionSoldPerDay ?? undefined) : undefined
    );
    
    // Update preserved plan ref with the new plan BEFORE updating state
    // This ensures the plan useMemo uses the new plan when selectedProfession updates
    preservedPlanRef.current = pendingPlan;
    
    // Select the topmost recipe (first in sorted list by minSkill, excluding blacklisted)
    let selectedRecipeIdToSet: number | null = null;
    let selectedCardKeyToSet: string | null = null;
    
    if (pendingRecipes.length > 0) {
      // Filter out blacklisted recipes and sort by minSkill to get the topmost one
      // Treat null minSkill as 1
      const sortedRecipes = [...pendingRecipes]
        .filter(r => !blacklistedSpellIds.has(r.id))
        .sort((a, b) => (a.minSkill ?? 1) - (b.minSkill ?? 1));
      
      if (sortedRecipes.length > 0) {
        const topRecipe = sortedRecipes[0];
        selectedRecipeIdToSet = topRecipe.id;
        selectedCardKeyToSet = `${topRecipe.name}-${topRecipe.minSkill}`;
        
        // Update preserved recipe ref
        preservedRecipeRef.current = topRecipe;
        preservedRecipeProfessionRef.current = pendingProfession; // Track which profession this recipe belongs to
      }
    }
    
    // Everything is ready - batch update ALL state in one go
    // React 18+ automatically batches these updates, so this triggers only ONE re-render
    setSelectedRecipeId(selectedRecipeIdToSet);
    setSelectedCardKey(selectedCardKeyToSet);
    setVisibleCardKey(null);
    setSelectedProfession(pendingProfession);
    
    // Update previous profession ref AFTER state update for animation detection
    // This will be used in the next render to detect profession change
    previousProfessionForAnimationRef.current = pendingProfession;
    
    // Clear pending profession ref and reset counter
    // The plan useMemo will use preservedPlanRef.current (which we just set) when it recalculates
    pendingProfessionRef.current = null;
    setPendingProfessionCounter(0);
  }, [isLoadingPrices, prices, committedSkill, committedTarget, selectedVersion, includeRecipeCost, skipLimitedStock, useMarketValue, recalculateForEachLevel, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing]);

  // Update preserved recipe ref when selectedRecipeId changes (for normal operation)
  useEffect(() => {
    // Skip if there's a pending profession change (it will handle refs)
    if (pendingProfessionRef.current) return;
    
    // Update preserved recipe ref during normal operation
    if (selectedRecipeId !== null) {
      const currentRecipe = recipes.find(r => r.id === selectedRecipeId);
      if (currentRecipe) {
        preservedRecipeRef.current = currentRecipe;
        preservedRecipeProfessionRef.current = selectedProfession; // Track current profession
      }
    }
  }, [selectedRecipeId, recipes, selectedProfession]);
  
  // Auto-select topmost recipe when recipes load and no recipe is selected (initial load)
  useEffect(() => {
    // Skip if there's a pending profession change (it will handle selection)
    if (pendingProfessionRef.current) return;
    
    // Only auto-select if no recipe is currently selected and recipes are available
    if (selectedRecipeId === null && sortedAll.length > 0) {
      const topRecipe = sortedAll[0];
      setSelectedRecipeId(topRecipe.id);
      setSelectedCardKey(`${topRecipe.name}-${topRecipe.minSkill}`);
      preservedRecipeRef.current = topRecipe;
      preservedRecipeProfessionRef.current = selectedProfession; // Track current profession
    }
  }, [selectedRecipeId, sortedAll, selectedProfession]);

  // New selectors state and options
  const versions = ["Vanilla", "The Burning Crusade"];
  // realms and factions are defined earlier (around line 307) for use in initial state

  // Handle URL realm parameter
  useEffect(() => {
    if (urlRealm) {
      const normalizedRealm = realms.find(r => r.toLowerCase() === urlRealm.toLowerCase());
      if (normalizedRealm && normalizedRealm !== selectedRealm) {
        // Only update if there hasn't been a recent user-initiated change
        const timeSinceLastUserChange = Date.now() - recentUserChangeTimestampRef.current;
        const isRecentUserChange = timeSinceLastUserChange < 1000; // 1 second window
        
        if (!isRecentUserChange) {
          setSelectedRealm(normalizedRealm);
        }
      }
    }
  }, [urlRealm, selectedRealm, realms]);

  // Handle URL faction parameter
  useEffect(() => {
    if (urlFaction) {
      const normalizedFaction = factions.find(f => f.toLowerCase() === urlFaction.toLowerCase());
      if (normalizedFaction && normalizedFaction !== selectedFaction) {
        // Only update if there hasn't been a recent user-initiated change
        const timeSinceLastUserChange = Date.now() - recentUserChangeTimestampRef.current;
        const isRecentUserChange = timeSinceLastUserChange < 1000; // 1 second window
        
        if (!isRecentUserChange) {
          setSelectedFaction(normalizedFaction);
        }
      }
    }
  }, [urlFaction, selectedFaction, factions]);

  // Load prices when realm or faction changes
  useEffect(() => {
    async function loadPrices() {
      // Increment request ID for this new request
      const requestId = ++priceLoadRequestIdRef.current;
      setIsLoadingPrices(true);
      console.log(`Loading prices for ${selectedRealm} ${selectedFaction}...`);
      try {
        const priceRows = await loadPriceData(selectedRealm, selectedFaction);
        
        // Only update prices if this is still the latest request
        if (requestId === priceLoadRequestIdRef.current) {
          console.log(`Loaded ${priceRows.length} price rows for ${selectedRealm} ${selectedFaction}`);
          const priceMap = toPriceMap(
            priceRows,
            Object.entries(materialInfo).reduce<Record<string, { vendorPrice?: number; limitedStock?: boolean }>>((acc, [id, val]) => {
              acc[String(id)] = {
                vendorPrice: val.vendorPrice,
                limitedStock: val.limitedStock
              };
              return acc;
            }, {})
          );
          setPrices(priceMap);
        } else {
          console.log(`Ignoring outdated price data for ${selectedRealm} ${selectedFaction} (request ${requestId}, current ${priceLoadRequestIdRef.current})`);
        }
      } catch (error) {
        console.error('Failed to load prices:', error);
        // Only update prices if this is still the latest request
        if (requestId === priceLoadRequestIdRef.current) {
          // Set empty prices as fallback
          setPrices({});
        }
      } finally {
        // Only update loading state if this is still the latest request
        if (requestId === priceLoadRequestIdRef.current) {
          setIsLoadingPrices(false);
        }
      }
    }

    loadPrices();
  }, [selectedRealm, selectedFaction]);

  // Load region data for soldPerDay sanity-check when realm changes
  useEffect(() => {
    const regionId = getRegionIdForRealm(selectedRealm);
    loadRegionData(regionId).then(setRegionSoldPerDay);
  }, [selectedRealm]);

  // Reset skill and target when version changes to ensure they're within valid range
  useEffect(() => {
    const currentMaxSkill = getMaxSkill(selectedVersion);
    const previousMaxSkill = previousMaxSkillRef.current;
    
    // Only run if version actually changed (max skill changed)
    if (currentMaxSkill === previousMaxSkill) {
      // Update ref even if no change needed
      previousMaxSkillRef.current = currentMaxSkill;
      return;
    }
    
    // Use refs to get current values without adding them as dependencies
    const currentSkill = committedSkillRef.current;
    const currentTarget = committedTargetRef.current;
    
    // Always reset skill to 1 when version changes
    let newSkill = 1;
    let newTarget = currentTarget;
    
    // Check if we're switching to a version with a higher max (e.g., Vanilla -> TBC)
    const isSwitchingToHigherMax = currentMaxSkill > previousMaxSkill;
    
    // If switching to a higher max version, set target to the new max
    if (isSwitchingToHigherMax) {
      newTarget = currentMaxSkill;
    } else {
      // Clamp target to valid range when switching to lower max
      if (currentTarget > currentMaxSkill) {
        newTarget = currentMaxSkill;
      }
    }
    
    // Ensure target is at least skill + 1
    if (newTarget <= newSkill) {
      // If target would be <= skill, try to set target to skill + 1
      if (newSkill + 1 <= currentMaxSkill) {
        newTarget = newSkill + 1;
      } else {
        // If skill is already at max, reduce skill to make room for target
        newSkill = Math.max(1, currentMaxSkill - 1);
        newTarget = currentMaxSkill;
      }
    }
    
    // Only update if values changed
    if (newSkill !== currentSkill) {
      setSkill(newSkill);
      setCommittedSkill(newSkill);
      lastSkillValue.current = newSkill;
    }
    if (newTarget !== currentTarget) {
      setTarget(newTarget);
      setCommittedTarget(newTarget);
      // Update URL after state has been set to reflect the new target
      // Use setTimeout to ensure state updates have been applied
      setTimeout(() => {
        const finalSkill = newSkill !== currentSkill ? newSkill : currentSkill;
        const finalTarget = newTarget;
        const newUrl = buildUrlWithParams(
          selectedProfession, 
          finalSkill, 
          finalTarget, 
          selectedVersion, 
          selectedRealm, 
          selectedFaction
        );
        router.push(newUrl, { scroll: false });
      }, 0);
    }
    
    // Update the ref to track the current max for next comparison
    previousMaxSkillRef.current = currentMaxSkill;
  }, [selectedVersion, selectedProfession, selectedRealm, selectedFaction, router]); // Only depend on selectedVersion, not on committedSkill/committedTarget

  // Add effect to reset realm if version changes and current realm is not available
  useEffect(() => {
    if (!realms.includes(selectedRealm)) {
      setSelectedRealm(realms[0] || "");
    }
  }, [selectedVersion, realms, selectedRealm]);

  const [showMaterials, setShowMaterials] = useState(false);

  // Optimize step candidates calculation to reduce expensive recalculations during sliding
  const stepCandidates = useMemo(() => {
    return plan.steps.map((s, i) => {
      if ('upgradeName' in s) return null;
      
      const start = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
      const end = s.endSkill;
      const best = s.recipe;
      
      const candidates = recipes
        .filter(r =>
          getEffectiveMinSkill(r) <= start &&
          (r.difficulty.gray ?? Infinity) >= end &&
          r.id !== best.id &&
          !blacklistedSpellIds.has(r.id) &&
          (!skipLimitedStock || !(
            r.source?.type === 'item' &&
            r.source.recipeItemId &&
            materialInfo[r.source.recipeItemId]?.limitedStock &&
            materialInfo[r.source.recipeItemId]?.bop
          )) &&
          // In auction-house mode: exclude low soldPerDay (illiquid) from alternatives too; only when we have region data for the item
          !(priceSourcing === 'auction-house' && r.produces?.id && regionSoldPerDay && (() => { const spd = regionSoldPerDay.get(r.produces!.id); return spd !== undefined && spd < getMinSoldPerDayForProfession(selectedProfession); })())
        )
        .map(r => {
          const crafts = expectedCraftsBetween(start, end, r.difficulty);
          const baseCost = calculateCraftCost(r, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
          const recipeCost = includeRecipeCost && r.source ? calculateCraftCost(r, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) : 0;
          const cost = (baseCost * crafts) + recipeCost;  // Total cost for comparison
          return {
            recipe: r,
            crafts,
            cost,
            cpu: cost / (end - start),
          };
        })
        .sort((a, b) => a.cpu - b.cpu)
        .slice(0, 2);
      
      return { step: s, candidates, start, end, best };
    });
  }, [plan.steps, committedSkill, recipes, prices, materialInfo, includeRecipeCost, skipLimitedStock, blacklistedSpellIds, useMarketValue, currentProfessionRecipeIds, optimizeSubCrafting, priceSourcing, selectedProfession, regionSoldPerDay]);

  // Calculate materials and total cost based on displayed craft counts (using start/end ranges)
  // instead of planner's batch-based craft counts
  const { displayedMaterialTotals, displayedTotalCost } = useMemo(() => {
    const materialTotals: Record<number, number> = {};
    let totalCost = 0;
    
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      if ('recipe' in s) {
        const start = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
        const end = s.endSkill;
        const displayedCrafts = expectedCraftsBetween(start, end, s.recipe.difficulty);
        
        // Calculate cost for this step based on displayed crafts
        const materialCostPerCraft = calculateCraftCost(s.recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
        const displayedMaterialCost = materialCostPerCraft * displayedCrafts;
        const displayedRecipeCost = includeRecipeCost && s.recipe.source ?
          calculateCraftCost(s.recipe, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) : 0;
        totalCost += displayedMaterialCost + displayedRecipeCost;
        
        // Calculate materials needed (exclude rod products for rod recipes - made in previous step)
        for (const [itemId, quantity] of Object.entries(s.recipe.materials)) {
          const numItemId = Number(itemId);
          if (ENCHANTING_ROD_SPELL_IDS.has(s.recipe.id) && ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(numItemId)) continue;
          materialTotals[numItemId] = (materialTotals[numItemId] || 0) + quantity * displayedCrafts;
        }
      }
    }
    
    return {
      displayedMaterialTotals: Object.entries(materialTotals).map(([itemId, quantity]) => ({
        itemId: Number(itemId),
        quantity,
        name: materialInfo[Number(itemId)]?.name
      })).sort((a, b) => a.itemId - b.itemId),
      displayedTotalCost: totalCost
    };
  }, [plan.steps, committedSkill, materialInfo, prices, includeRecipeCost, useMarketValue, currentProfessionRecipeIds, optimizeSubCrafting, priceSourcing, selectedProfession]);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 overflow-hidden">  

      {/* Panels */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Aside */}
        <aside className={`w-150 lg:w-150 flex flex-col bg-neutral-950 text-[16px] ${isAdvancedSettingsOpen ? 'relative z-[60]' : ''}`}>
          {/* Slider + Tabs */}
          <div className="flex-none bg-neutral-900 px-3 pt-6 pb-2">
            {/* Logo and name 
            <div className="flex items-center gap-2 mb-4">
              <img src="/icons/WoWCraft.png" alt="WoWCraft Logo" className="w-16 h-16 mb-2 ml-2" />
              <span className="text-[32px] font-bold text-white"><span className="text-[#e3b056]">WoW</span>Craft.io</span>
            </div>
            */}
            {/* End logo and name */}
            <div className="flex gap-2 mb-4">
              {/* Version Selector */}
              <Listbox value={selectedVersion} onChange={handleVersionChange}>
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
              <Listbox value={selectedRealm} onChange={handleRealmChange}>
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
              <Listbox value={selectedFaction} onChange={handleFactionChange}>
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
            <div className="w-full mb-5 flex gap-2">
              <div className="flex-1">
                <Listbox value={selectedProfession} onChange={handleProfessionChange}>
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
                        {availableProfessions.map((prof) => (
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
            </div>
            <div className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs">
                  Skill Range <span className={`font-semibold ${selectedVersion === 'The Burning Crusade' ? 'text-emerald-500' : 'text-yellow-300'}`}>{skill}</span> → <span className={`font-semibold ${selectedVersion === 'The Burning Crusade' ? 'text-emerald-500' : 'text-yellow-300'}`}>{target}</span>
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
                        className="absolute left-full top-0 ml-2 w-64 bg-neutral-800 rounded shadow-lg border border-neutral-700 z-[60] origin-left"
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
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-neutral-400">Recalculate for Each Level</label>
                            <button 
                              onClick={() => setRecalculateForEachLevel(!recalculateForEachLevel)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-yellow-400/50 ${
                                recalculateForEachLevel ? 'bg-yellow-400' : 'bg-neutral-700'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out ${
                                  recalculateForEachLevel ? 'translate-x-5' : 'translate-x-1'
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
              
              {/* Double-sided range slider */}
              <div className="mb-4 w-full">
                <Range
                  values={[skill, target]}
                  step={1}
                  min={1}
                  max={maxSkill}
                  onChange={([low, high]) => {
                    // Only update the skill value during dragging, target updates immediately
                    handleSliderChange(low);
                    setTarget(high);
                  }}
                  onFinalChange={([low, high]) => {
                    // Commit both values when slider is released
                    handleSliderEnd();
                  }}
                  renderTrack={({ props, children }) => {
                    const { key, style, ...rest } = props as any;
                    return (
                      <div
                        key={key}
                        {...rest}
                        style={{
                          ...style,
                          height: '6px',
                          width: '100%',
                          minWidth: '100%',
                          borderRadius: '3px',
                          background: getTrackBackground({
                            values: [skill, target],
                            colors: ['#4b5563', selectedVersion === 'The Burning Crusade' ? '#10b981' : '#eab308', '#4b5563'],
                            min: 1,
                            max: maxSkill
                          }),
                          pointerEvents: 'auto'
                        }}
                        onMouseDown={handleSliderStart}
                        onTouchStart={handleSliderStart}
                      >
                        {children}
                      </div>
                    );
                  }}
                  renderThumb={({ props, index }) => {
                    const { key, style, ...rest } = props;
                    const thumbColor = selectedVersion === 'The Burning Crusade' 
                      ? '#059669' // emerald-600 for both thumbs in TBC
                      : (index === 0 ? '#eab308' : '#f59e0b'); // yellow for Vanilla
                    return (
                      <div
                        key={key}
                        {...rest}
                        style={{
                          ...style,
                          height: '16px',
                          width: '16px',
                          borderRadius: '8px',
                          backgroundColor: thumbColor,
                          boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                          pointerEvents: 'auto'
                        }}
                      />
                    );
                  }}
                />
              </div>

              {/* Skill inputs */}
              <div className="flex items-center space-x-2">
                {/* Current skill input */}
                <div className="flex flex-col items-center bg-neutral-900 flex-1">
                  <span className="text-xs text-neutral-400 mb-1">Current</span>
                  <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => handleDirectSkillChange(skill - 1)}
                    >−</button>
                    
                    <input
                      type="number"
                      value={skill}
                      min={1}
                      max={target - 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) {
                          handleDirectSkillChange(val);
                        }
                      }}
                      className={`text-lg text-center w-12 bg-transparent outline-none appearance-none ${selectedVersion === 'The Burning Crusade' ? 'text-emerald-500' : 'text-yellow-300'}
                                [&::-webkit-inner-spin-button]:appearance-none 
                                [&::-webkit-outer-spin-button]:appearance-none`}
                    />
                    
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => handleDirectSkillChange(skill + 1)}
                    >+</button>
                  </div>
                </div>

                {/* Target skill input */}
                <div className="flex flex-col items-center bg-neutral-900 flex-1">
                  <span className="text-xs text-neutral-400 mb-1">Target</span>
                  <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => {
                        const newTarget = Math.max(skill + 1, target - 1);
                        setTarget(newTarget);
                        setCommittedTarget(newTarget);
                      }}
                    >−</button>
                    
                    <input
                      type="number"
                      value={target}
                      min={skill + 1}
                      max={maxSkill}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) {
                          const boundedVal = Math.max(skill + 1, Math.min(maxSkill, val));
                          setTarget(boundedVal);
                          setCommittedTarget(boundedVal);
                        }
                      }}
                      className={`text-lg text-center w-12 bg-transparent outline-none appearance-none ${selectedVersion === 'The Burning Crusade' ? 'text-emerald-500' : 'text-yellow-300'}
                                [&::-webkit-inner-spin-button]:appearance-none 
                                [&::-webkit-outer-spin-button]:appearance-none`}
                    />
                    
                    <button
                      className="text-lg text-white bg-neutral-800 hover:bg-neutral-500 rounded transition w-8 h-8"
                      onClick={() => {
                        const newTarget = target + 1;
                        setTarget(newTarget);
                        setCommittedTarget(newTarget);
                      }}
                    >+</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="mb-4">
              {/* Price Sourcing Selector */}
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-neutral-400 font-medium">Price Sourcing Strategy</label>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setPriceSourcing('cost')}
                  className={`px-2 py-1 text-xs rounded transition-all duration-200 border relative group flex-1 ${
                    priceSourcing === 'cost'
                      ? `${selectedVersion === 'The Burning Crusade' ? 'bg-emerald-500 border-emerald-500' : 'bg-yellow-400 border-yellow-400'} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Raw material cost"
                >
                  <span className="font-medium">Cost</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Raw material cost
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
                <button
                  onClick={() => setPriceSourcing('cost-vendor')}
                  className={`px-2 py-1 text-xs rounded transition-all duration-200 border relative group flex-1 ${
                    priceSourcing === 'cost-vendor'
                      ? `${selectedVersion === 'The Burning Crusade' ? 'bg-emerald-500 border-emerald-500' : 'bg-yellow-400 border-yellow-400'} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Subtract vendor value"
                >
                  <span className="font-medium">Vendor</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Subtract vendor value
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
                <button
                  onClick={() => setPriceSourcing('disenchant')}
                  className={`px-2 py-1 text-xs rounded transition-all duration-200 border relative group flex-1 ${
                    priceSourcing === 'disenchant'
                      ? `${selectedVersion === 'The Burning Crusade' ? 'bg-emerald-500 border-emerald-500' : 'bg-yellow-400 border-yellow-400'} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Subtract disenchant value"
                >
                  <span className="font-medium">Disenchanting</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Subtract disenchant value
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
                <button
                  onClick={() => setPriceSourcing('auction-house')}
                  className={`px-2 py-1 text-xs rounded transition-all duration-200 border relative group flex-1 ${
                    priceSourcing === 'auction-house'
                      ? `${selectedVersion === 'The Burning Crusade' ? 'bg-emerald-500 border-emerald-500' : 'bg-yellow-400 border-yellow-400'} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Sell crafted items"
                >
                  <span className="font-medium">Auction House</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Sell crafted items
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
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
                  {tab === 'route' ? 'Leveling Guide' : 'All Recipes'}
                  {view === tab && (
                    <motion.div
                      layoutId="tab-underline"
                      className={`absolute bottom-0 left-0 right-0 h-0.5 ${selectedVersion === 'The Burning Crusade' ? 'bg-emerald-500' : 'bg-yellow-400'}`}
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
                hover:scrollbar-thumb-neutral-600/60
                will-change-scroll-position"
              style={{
                transform: 'translateZ(0)', // Force hardware acceleration
                backfaceVisibility: 'hidden'
              }}
            >
              {/* Blur overlay - moved outside AnimatePresence to persist across content changes */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ 
                  opacity: shouldBlur && !isDirectChange ? 1 : 0 
                }}
                transition={{ 
                  duration: 0.4,
                  ease: "easeInOut"
                }}
                className="absolute inset-0 z-20 pointer-events-none"
                style={{
                  backdropFilter: 'blur(2px)',
                  backgroundColor: 'rgba(0, 0, 0, 0.1)',
                  WebkitBackdropFilter: 'blur(2px)'
                }}
              />
              
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${view}-${selectedProfession}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, ease: "easeInOut" }}
                  className="relative will-change-transform"
                  style={{
                    transformOrigin: 'top center',
                    backfaceVisibility: 'hidden',
                    perspective: 1000
                  }}
                >
                  {/* Content */}
                  <div className="relative z-0">
                    {view === 'route' ? (
                      <div className="flex flex-col">
                        {plan.steps.map((s, i) => {
                          if ('upgradeName' in s) {
                            return (
                              <motion.div
                                key={`upgrade-${s.upgradeName}-${s.endSkill}-${committedSkill}`}
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 5 }}
                                transition={{ 
                                  duration: 0.3,
                                  ease: "easeOut"
                                }}
                                className="relative flex items-center justify-center gap-1 bg-neutral-900 rounded-none px-2 py-1 w-full h-[60px] font-bold text-yellow-400 will-change-transform"
                              >
                                ⚔️ {s.note ?? `Upgrade to ${s.upgradeName}`}
                              </motion.div>
                            );
                          }

                          const stepData = stepCandidates[i];
                          if (!stepData) return null;
                          
                          const { candidates, start, end, best } = stepData;
                          
                          // Calculate crafts needed for the displayed range (start to end)
                          // This ensures consistency with the Level-up Calculator
                          const displayedCrafts = expectedCraftsBetween(start, end, best.difficulty);
                          
                          // Recalculate cost based on displayed crafts instead of planner's s.crafts
                          const materialCostPerCraft = calculateCraftCost(best, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
                          const displayedMaterialCost = materialCostPerCraft * displayedCrafts;
                          const displayedRecipeCost = includeRecipeCost && best.source ?
                            calculateCraftCost(best, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) : 0;
                          const displayedTotalCost = displayedMaterialCost + displayedRecipeCost;
                          
                          return (
                            <motion.div
                              key={`card-${best.name}-${end}-${committedSkill}`}
                              initial={shouldAnimate(best.name, end) ? { opacity: 0, y: -5 } : { opacity: 1, y: 0 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 5 }}
                              transition={{ 
                                duration: 0.4,
                                ease: "easeOut"
                              }}
                              className="relative will-change-transform"
                              style={{
                                backfaceVisibility: 'hidden'
                              }}
                            >
                              <div className="flex flex-col w-full">
                                {/* Primary card content */}
                                <div
                                  id={`craft-${best.id}-${end}`}
                                  onClick={() => handleCardClick(best.name, end, start, end, false, best.id)}
                                  className={`relative flex items-center gap-1 px-2 py-1 w-full h-[60px] cursor-pointer
                                    transition-all duration-100 ease-out will-change-transform
                                    hover:bg-neutral-700 active:bg-neutral-700 active:scale-[0.99]
                                    ${isSelected(best.name, end) ? 'bg-neutral-600' : 'bg-neutral-900'}`}
                                >
                                  <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                                    diffColor(committedSkill, best.difficulty)
                                  }`} />
                                  <span className="text-[16px] flex items-center justify-center w-8">
                                    {displayedCrafts}×
                                  </span>
                                  <img src={iconSrc(best.id, getRecipeProfession(best.id, selectedProfession))} alt="" className="w-7 h-7 rounded object-cover" />
                                  <span 
                                    className="truncate whitespace-nowrap flex-1 text-[16px]"
                                    style={{ color: qualityColors[s.recipe.quality] }}>
                                    {best.name.length <= 35 ? best.name : `${best.name.slice(0, 33)}…`}
                                  </span>
                                  <span className="text-[16px]">
                                    <SignedCost copper={displayedTotalCost} />
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
                                        duration: 0.4,
                                        ease: "easeInOut"
                                      },
                                      opacity: {
                                        duration: 0.3
                                      }
                                    }}
                                  >
                                    <motion.div
                                      initial={shouldAnimate(best.name, end) ? { opacity: 0, y: -10 } : { opacity: 1, y: 0 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -10 }}
                                      transition={{
                                        duration: 0.4,
                                        ease: "easeOut"
                                      }}
                                    >
                                    {candidates.map((alt: { recipe: Recipe; crafts: number; cost: number }, index) => (
                                      <motion.div
                                        key={`alt-${alt.recipe.name}-${end}-${committedSkill}`}
                                        initial={shouldAnimate(best.name, end) ? { opacity: 0, y: -5 } : { opacity: 1, y: 0 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        transition={{ 
                                          duration: 0.3,
                                          ease: "easeOut"
                                        }}
                                        onClick={() => handleCardClick(alt.recipe.name, end, start, end, true, alt.recipe.id)}
                                        className={`relative flex items-center gap-1 rounded-none pl-2 pr-2 py-0.5 w-11/12 ml-auto cursor-pointer h-[60px] 
                                          transition-all duration-100 ease-out will-change-transform
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
                                          src={iconSrc(alt.recipe.id, getRecipeProfession(alt.recipe.id, selectedProfession))}
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
                                          <SignedCost copper={alt.cost} />
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
                                src={iconSrc(r.id, getRecipeProfession(r.id, selectedProfession))}
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
                  </div>
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
                        <SignedCost copper={displayedTotalCost} />
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
              className="absolute left-[37.5rem] top-0 w-[330px] h-full bg-neutral-900/95 backdrop-blur-sm rounded shadow-lg border border-neutral-800 z-50 origin-left"
            >
              <div className="p-3 h-full flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                  <h3 className="text-lg font-semibold text-neutral-200">Required Materials</h3>
                  <button
                    onClick={() => setShowMaterials(false)}
                    className="text-neutral-400 hover:text-neutral-200 transition-colors duration-200"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-2 flex-1 min-h-0 overflow-y-scroll pr-[10px]
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
                  {displayedMaterialTotals.map((material: MaterialRequirement) => (
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
                  src={iconSrc(selected.id, getRecipeProfession(selected.id, selectedProfession))}
                  alt={`${selected.name} icon`}
                  className="w-16 h-16 rounded mr-2 flex-shrink-0"
                />
                <a
                  href={selected.url || `https://www.wowhead.com/${selectedVersion === 'The Burning Crusade' ? 'tbc' : 'classic'}/spell=${selected.id}`}
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
                    <FormatMoney copper={calculateCraftCost(selected, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession)} />
                  </span>
                </div>
                {selected && selected.source?.type === 'item' && selected.source.recipeItemId ? (
                  (() => {
                    const recipeInfo = materialInfo[selected.source.recipeItemId];
                    const recipeCostData = getRecipeCost(selected, prices, materialInfo, useMarketValue);
                    
                    // BoP with no price at all = truly unavailable; BoP with vendorPrice 0 = free (from drops)
                    if (recipeInfo?.bop && recipeCostData.vendorPrice === null && recipeCostData.ahPrice === null) {
                      return (
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                          <span className="text-neutral-400 mb-2">Recipe Cost</span>
                          <span className="text-red-400 text-base">Not Available (BoP)</span>
                        </div>
                      );
                    }

                    // Show vendor/AH cost, or "Free" when vendorPrice is 0 (BoP from drops)
                    return (
                      <>
                        {(recipeCostData.vendorPrice !== null && recipeCostData.vendorPrice >= 0) && (
                          <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <span className="text-neutral-400 mb-2">
                              {recipeCostData.vendorPrice === 0 ? 'Recipe Cost' : 'Vendor Recipe Cost'}
                            </span>
                            <div className="flex flex-col items-center gap-1">
                              {recipeInfo?.limitedStock && (
                                <div className="text-base text-yellow-400 flex items-center gap-1">
                                  <span>⚠️ Limited Stock</span>
                                </div>
                              )}
                              <span className="text-xl font-semibold">
                                <FormatMoney copper={recipeCostData.vendorPrice} />
                              </span>
                            </div>
                          </div>
                        )}
                        {recipeCostData.ahPrice !== null && recipeCostData.ahPrice > 0 && (
                          <div className="flex-1 flex flex-col items-center justify-center p-4">
                            <span className="text-neutral-400 mb-2">AH Recipe Cost</span>
                            <span className="text-xl font-semibold">
                              <FormatMoney copper={recipeCostData.ahPrice} />
                            </span>
                          </div>
                        )}
                        {recipeCostData.vendorPrice === null && recipeCostData.ahPrice === null && (
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
                    <SafeMoney
                      value={selected ? (() => {
                        const totalMaterialCost = Object.values(materialTotals).reduce((s, m) => s + m.craftCost, 0);
                        const recipeCost = includeRecipeCost && selected.source ?
                          calculateCraftCost(selected, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) : 0;
                        const materialCostForCrafts = calculateCraftCost(selected, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) * expCrafts;
                        return totalLevelUps > 0 ? (materialCostForCrafts + recipeCost) / totalLevelUps : 0;
                      })() : 0}
                      fallback="—"
                    />
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
              <div className="flex flex-col divide-y divide-neutral-700">
                {selected?.produces ? (() => {
                  const outputItemId = selected.produces.id;
                  const outputQty = selected.produces.quantity ?? 1;
                  const totalOutput = outputQty * expCrafts;
                  const info = materialInfo[outputItemId];
                  const sellPrice = info?.sellPrice ?? 0;
                  const vendorReturn = sellPrice * totalOutput;
                  const quality = selected.quality ?? info?.quality ?? 1;
                  const itemLevel = info?.itemLevel ?? 70;
                  const isWeapon = info?.class === '2';
                  const outcomes = getDisenchantOutcomes(itemLevel, quality, isWeapon, info?.class, info?.slot, outputItemId);
                  const deTotal = getExpectedDisenchantValue(itemLevel, quality, isWeapon, prices, materialInfo, useMarketValue, info?.class, info?.slot, outputItemId);
                  const ahMinBuyout = (prices[outputItemId]?.minBuyout ?? 0) * totalOutput;
                  const ahMarketValue = (prices[outputItemId]?.marketValue ?? 0) * totalOutput;
                  return (
                    <>
                      <div className="flex justify-between items-stretch bg-neutral-800 divide-x divide-neutral-800 overflow-hidden text-neutral-100 text-[16px] min-h-[4rem]">
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                          <span className="text-neutral-400 mb-1 text-sm">Vendor Price Return</span>
                          <span className="text-lg font-semibold">
                            <FormatMoney copper={vendorReturn} />
                          </span>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                          <span className="text-neutral-400 mb-1 text-sm">AH Returns (min buyout)</span>
                          <span className="text-lg font-semibold">
                            <FormatMoney copper={ahMinBuyout} />
                          </span>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center p-4">
                          <span className="text-neutral-400 mb-1 text-sm">AH Returns (market avg)</span>
                          <span className="text-lg font-semibold">
                            <FormatMoney copper={ahMarketValue} />
                          </span>
                        </div>
                      </div>
                      {outcomes.length > 0 && (
                        <div className="flex flex-col items-stretch bg-neutral-800/80 p-4">
                          <span className="text-neutral-400 mb-2 text-sm font-medium">Expected Disenchant Materials</span>
                          <ul className="space-y-2 text-sm">
                            {outcomes.map((o, idx) => {
                              const avgQty = (o.minQty + o.maxQty) / 2;
                              const expectedQty = o.chance * avgQty * totalOutput;
                              const price = useMarketValue
                                ? (prices[o.itemId]?.marketValue ?? prices[o.itemId]?.minBuyout ?? 0)
                                : (prices[o.itemId]?.minBuyout ?? prices[o.itemId]?.marketValue ?? 0);
                              const value = expectedQty * price;
                              const matName = materialInfo[o.itemId]?.name ?? `Item #${o.itemId}`;
                              const matQuality = materialInfo[o.itemId]?.quality ?? 1;
                              const qtyRange = o.minQty === o.maxQty ? `${o.minQty}` : `${o.minQty}–${o.maxQty}`;
                              const pct = (o.chance * 100).toFixed(0);
                              const iconUrl = `/icons/materials/${o.itemId}.jpg`;
                              return (
                                <li key={`${o.itemId}-${idx}`} className="text-neutral-200 flex items-center gap-3">
                                  <img
                                    src={iconUrl}
                                    alt=""
                                    className="w-7 h-7 rounded object-cover border border-neutral-600 flex-shrink-0"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium" style={{ color: qualityColors[matQuality] }}>{matName}</span>
                                    <span className="text-neutral-400 ml-1.5">
                                      {pct}% ({qtyRange})
                                    </span>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <span className="text-neutral-400">
                                      ~{expectedQty.toFixed(1)} × <FormatMoney copper={price} />
                                    </span>
                                    <span className="text-white font-medium ml-2">
                                      = <FormatMoney copper={value} />
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          <div className="mt-2 pt-2 border-t border-neutral-600 flex justify-between items-center">
                            <span className="text-neutral-400 text-sm">Total expected value</span>
                            <span className="text-white font-semibold"><FormatMoney copper={deTotal * totalOutput} /></span>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })() : (
                  <div className="flex items-center justify-center p-8 text-neutral-500 text-sm">
                    Select a recipe to see profit calculations
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </main>
      </div>
    </div>
  );
}