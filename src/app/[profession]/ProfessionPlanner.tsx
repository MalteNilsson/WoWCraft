'use client';

import { Fragment, useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from 'react';
import { AdSlot, AD_SLOT_SKYSCRAPER } from '@/components/AdSlot';
import { createPortal } from 'react-dom';
// Vanilla recipes
import vanillaAlchemy from '@/data/recipes/vanilla/alchemy.json';
import vanillaBlacksmithing from '@/data/recipes/vanilla/blacksmithing.json';
import vanillaCooking from '@/data/recipes/vanilla/cooking.json';
import vanillaEnchanting from '@/data/recipes/vanilla/enchanting.json';
import vanillaEngineering from '@/data/recipes/vanilla/engineering.json';
import vanillaLeatherworking from '@/data/recipes/vanilla/leatherworking.json';
import vanillaTailoring from '@/data/recipes/vanilla/tailoring.json';
// TBC recipes
import tbcAlchemy from '@/data/recipes/tbc/alchemy.json';
import tbcBlacksmithing from '@/data/recipes/tbc/blacksmithing.json';
import tbcCooking from '@/data/recipes/tbc/cooking.json';
import tbcEnchanting from '@/data/recipes/tbc/enchanting.json';
import tbcEngineering from '@/data/recipes/tbc/engineering.json';
import tbcJewelcrafting from '@/data/recipes/tbc/jewelcrafting.json';
import tbcLeatherworking from '@/data/recipes/tbc/leatherworking.json';
import tbcTailoring from '@/data/recipes/tbc/tailoring.json';
// Forever recipes
import foreverAlchemy from '@/data/recipes/forever/alchemy.json';
import foreverBlacksmithing from '@/data/recipes/forever/blacksmithing.json';
import foreverCooking from '@/data/recipes/forever/cooking.json';
import foreverEnchanting from '@/data/recipes/forever/enchanting.json';
import foreverEngineering from '@/data/recipes/forever/engineering.json';
import foreverLeatherworking from '@/data/recipes/forever/leatherworking.json';
import foreverTailoring from '@/data/recipes/forever/tailoring.json';
import foreverSodSpellIds from '@/data/sod/forever-excluded-spell-ids.json';
import type { Recipe, MaterialInfo, MaterialTreeNode, PriceMap } from '@/lib/types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceArea, ReferenceLine, Customized  } from "recharts";
import { makeDynamicPlan, makeSegmentedPlan, blacklistedSpellIds, isSkillCooldownRecipe, isTransmuteRecipe, isSeasonalRecipe, MaterialRequirement, isBelowMinSaleRate, skillUpChanceFloor, type SkillGapReason, type RecipePreference } from '@/lib/planner';
import { auctionatorListName, auctionatorShoppingList, copyText, tsmShoppingList, type GuideStep, type ShoppingListItem } from '@/lib/shoppingList';
import { getEffectiveMinSkill, isRecipeObtainable, isBopMobDropRecipe, isBopRecipeItem, isCurrencyRecipe, isWrongFactionRecipe, currencyCostLabel } from '@/lib/recipeCalc';
import { getRegionIdForRealm, buildRegionSaleRateMap } from '@/lib/regionDataLoader';
import { ENCHANTING_ROD_SPELL_IDS, ENCHANTING_ROD_PRODUCT_ITEM_IDS, ENGINEERING_TOOL_SPELL_IDS, ENGINEERING_TOOL_PRODUCT_ITEM_IDS } from '@/lib/rodConstants';
import { expectedSkillUps, craftCost as calculateCraftCost, getItemCost, buildMaterialTree, expectedCraftsBetween, normalizeSuccessMargin, getRecipeCost, materialBuySource, materialUnitCost, purchasedLeaves, recipePurchase, type PriceSourcing } from '@/lib/recipeCalc';
import { toPriceMap }      from '@/lib/pricing';
import { Range, getTrackBackground } from 'react-range';
import Fuse from 'fuse.js';
import { Listbox } from '@headlessui/react';
import { materialInfoMap } from '@/lib/materialsLoader';
import { FormatMoney } from '@/lib/utils';
import { disenchantMaterialValue, getDisenchantOutcomes, getExpectedDisenchantValue, resolveDisenchantItem } from '@/lib/disenchant';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from 'use-debounce';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CachedIcon } from '@/components/CachedIcon';
import { PriceAgeNotice } from '@/components/PriceAgeNotice';
import { FactionIcon, factionRingClass, factionTextClass } from '@/components/FactionMark';
import { FOREVER_REALMS, RealmName, canonicalForeverRealm, foreverRealmKind, realmRingClass } from '@/components/RealmName';
import { LevelUpCostChart } from '@/components/LevelUpCostChart';
import { PlannerCommandBar } from '@/components/PlannerCommandBar';
import { preloadIconZips } from '@/lib/iconStore';

/** Wowhead base path for links (classic, tbc, or forever) */
function getWowheadBase(version: string): string {
  if (version === 'The Burning Crusade') return 'tbc';
  if (version === 'Forever') return 'forever';
  return 'classic';
}

function parsePlannerVersion(value: string | null): string | null {
  const normalized = value?.toLowerCase();
  if (normalized === 'forever') return 'Forever';
  if (normalized === 'tbc' || normalized === 'the burning crusade' || normalized === 'vanilla') return 'The Burning Crusade';
  return null;
}

const ANNIVERSARY_REALMS = ['Thunderstrike', 'Spineshatter', 'Dreamscythe', 'Nightslayer'];
const MIN_SALE_RATE_COOKIE = 'wowcraft-min-sale-rate';
const MIN_SKILL_CHANCE_COOKIE = 'wowcraft-min-skill-chance';
const CRAFT_REAGENTS_COOKIE = 'wowcraft-craft-reagents';
const EXTRA_PROFESSIONS_COOKIE = 'wowcraft-extra-professions';
const HIDE_BOP_RECIPES_COOKIE = 'wowcraft-hide-bop-recipes';
const WORKING_OVERTIME_COOKIE = 'wowcraft-working-overtime';
const SUCCESS_MARGIN_COOKIE = 'wowcraft-success-margin';
const REALM_COOKIE = 'wowcraft-realm';
const FACTION_COOKIE = 'wowcraft-faction';
const PRICE_SOURCE_COOKIE = 'wowcraft-price-sourcing';
const RECIPE_PREFERENCE_COOKIE = 'wowcraft-recipe-preference';
const RECIPE_PREFERENCE_MS = 60 * 60 * 1000;
const PRICE_MODES = ['cost', 'cost-vendor', 'disenchant', 'auction-house'] as const;
type PriceMode = (typeof PRICE_MODES)[number];
const DEFAULT_MIN_SALE_RATE_PERCENT = 10;
const DEFAULT_MIN_SKILL_CHANCE_PERCENT = 10;

function readHideBopRecipes(): boolean {
  if (typeof document === 'undefined') return true;
  const match = document.cookie.match(new RegExp(`(?:^|; )${HIDE_BOP_RECIPES_COOKIE}=([^;]*)`));
  if (!match) return true;
  return match[1] === '1';
}

function writeHideBopRecipes(hide: boolean) {
  document.cookie = `${HIDE_BOP_RECIPES_COOKIE}=${hide ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readWorkingOvertime(): number {
  if (typeof document === 'undefined') return 0;
  const match = document.cookie.match(new RegExp(`(?:^|; )${WORKING_OVERTIME_COOKIE}=([^;]*)`));
  const value = match ? Number(match[1]) : 0;
  if (!Number.isInteger(value) || value < 0 || value > 5) return 0;
  return value;
}

function writeWorkingOvertime(rank: number) {
  document.cookie = `${WORKING_OVERTIME_COOKIE}=${rank}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readSuccessMarginPercent() {
  if (typeof document === 'undefined') return 0;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SUCCESS_MARGIN_COOKIE}=([^;]*)`));
  return normalizeSuccessMargin(Number(match?.[1]));
}

function writeSuccessMarginPercent(percent: number) {
  document.cookie = `${SUCCESS_MARGIN_COOKIE}=${normalizeSuccessMargin(percent)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readMinSaleRatePercent(): number {
  if (typeof document === 'undefined') return DEFAULT_MIN_SALE_RATE_PERCENT;
  const match = document.cookie.match(new RegExp(`(?:^|; )${MIN_SALE_RATE_COOKIE}=([^;]*)`));
  const value = match ? Number(match[1]) : DEFAULT_MIN_SALE_RATE_PERCENT;
  if (!Number.isInteger(value) || value < 0 || value > 100) return DEFAULT_MIN_SALE_RATE_PERCENT;
  return value;
}

function writeMinSaleRatePercent(percent: number) {
  document.cookie = `${MIN_SALE_RATE_COOKIE}=${percent}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readMinSkillChancePercent() {
  if (typeof document === 'undefined') return DEFAULT_MIN_SKILL_CHANCE_PERCENT;
  const match = document.cookie.match(new RegExp(`(?:^|; )${MIN_SKILL_CHANCE_COOKIE}=([^;]*)`));
  if (!match) return DEFAULT_MIN_SKILL_CHANCE_PERCENT;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 0 || value > 100) return DEFAULT_MIN_SKILL_CHANCE_PERCENT;
  return value;
}

function writeMinSkillChancePercent(percent: number) {
  document.cookie = `${MIN_SKILL_CHANCE_COOKIE}=${percent}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readCraftReagents() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((part) => part === `${CRAFT_REAGENTS_COOKIE}=1`);
}

function writeCraftReagents(enabled: boolean) {
  document.cookie = `${CRAFT_REAGENTS_COOKIE}=${enabled ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readExtraProfessions() {
  if (typeof document === 'undefined') return [] as string[];
  const match = document.cookie.match(new RegExp(`(?:^|; )${EXTRA_PROFESSIONS_COOKIE}=([^;]*)`));
  if (!match) return [] as string[];
  const allowed = new Set([...professions, 'Mining']);
  const names = decodeURIComponent(match[1]).split(',').map((name) => name.trim()).filter((name) => allowed.has(name));
  return [...new Set(names)];
}

function writeExtraProfessions(names: string[]) {
  document.cookie = `${EXTRA_PROFESSIONS_COOKIE}=${encodeURIComponent(names.join(','))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function writeCookieValue(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

type StoredRecipePreference = RecipePreference & { profession: string; version: string };

function readRecipePreferences(): { savedAt: number; pairs: StoredRecipePreference[] } {
  const empty = { savedAt: 0, pairs: [] as StoredRecipePreference[] };
  const raw = readCookieValue(RECIPE_PREFERENCE_COOKIE);
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: number; pairs?: StoredRecipePreference[] };
    if (typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.pairs)) return empty;
    if (Date.now() - parsed.savedAt >= RECIPE_PREFERENCE_MS) return empty;
    const pairs = parsed.pairs.filter((pair) =>
      pair &&
      typeof pair.profession === 'string' &&
      typeof pair.version === 'string' &&
      Number.isInteger(pair.prefer) &&
      Number.isInteger(pair.over) &&
      pair.prefer !== pair.over
    );
    return { savedAt: parsed.savedAt, pairs };
  } catch {
    return empty;
  }
}

function writeRecipePreferences(savedAt: number, pairs: StoredRecipePreference[]) {
  const maxAge = Math.max(1, Math.ceil(RECIPE_PREFERENCE_MS / 1000));
  document.cookie = `${RECIPE_PREFERENCE_COOKIE}=${encodeURIComponent(JSON.stringify({ savedAt, pairs }))}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function readRealmCookie(version: string): string | null {
  const value = readCookieValue(REALM_COOKIE);
  return value ? realmFromUrl(version, value) : null;
}

function readFactionCookie(): 'Alliance' | 'Horde' | null {
  const value = readCookieValue(FACTION_COOKIE)?.toLowerCase();
  if (value === 'alliance') return 'Alliance';
  if (value === 'horde') return 'Horde';
  return null;
}

function parsePriceMode(value: string | null): PriceMode | null {
  return PRICE_MODES.find((mode) => mode === value) ?? null;
}

function readPriceCookie(): PriceMode | null {
  return parsePriceMode(readCookieValue(PRICE_SOURCE_COOKIE));
}

function SettingsSection({ title, accentClass, children }: { title: string; accentClass: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-white/10 pt-3 first:border-t-0 first:pt-0">
      <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${accentClass}`}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SettingsToggle({
  label,
  hint,
  enabled,
  onChange,
  accentOn,
  featured = false,
}: {
  label: string;
  hint: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  accentOn: boolean;
  featured?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${featured ? `rounded-md border px-2.5 py-2 ${accentOn ? 'border-[#1fb5f7]/45 bg-[#1fb5f7]/10' : 'border-yellow-400/45 bg-yellow-400/10'}` : ''}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {featured && (
            <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${accentOn ? 'text-[#1fb5f7]' : 'text-yellow-400'}`}>
              <path fill="currentColor" d="M8 1.15l1.72 3.72 4.05.5-3.02 2.78.82 3.98L8 10.16 4.43 12.13l.82-3.98L2.23 5.37l4.05-.5L8 1.15z" />
            </svg>
          )}
          <div className="text-xs font-medium text-neutral-100">{label}</div>
        </div>
        <p className="mt-0.5 text-xs leading-snug text-neutral-300">{hint}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        aria-pressed={enabled}
        aria-label={label}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 ${accentOn ? 'focus:ring-[#1fb5f7]/50' : 'focus:ring-yellow-400/50'} ${
          enabled ? (accentOn ? 'bg-[#1fb5f7]' : 'bg-yellow-400') : 'bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-lg transition-transform duration-200 ease-in-out ${
            enabled ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

function WorkingOvertimeSlider({
  rank,
  onChange,
  accent,
}: {
  rank: number;
  onChange: (rank: number) => void;
  accent: string;
}) {
  const bonus = rank * 4;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-100">Working Overtime</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: accent }}>{rank}/5</span>
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={rank}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer"
        style={{ accentColor: accent }}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={rank}
        aria-label="Working Overtime rank"
      />
      <p className="mt-1 text-xs leading-snug text-neutral-300">
        {rank === 0
          ? 'Off. Each rank multiplies skill-up chance by 4%, up to 20% at rank 5. Chance cannot exceed 100%.'
          : `Rank ${rank} multiplies skill-up chance by ${bonus}%, up to 100%. A craft still grants at most 1 skill point.`}
      </p>
    </div>
  );
}

function SuccessMarginSlider({
  percent,
  onChange,
  accent,
}: {
  percent: number;
  onChange: (percent: number) => void;
  accent: string;
}) {
  const step = percent / 10;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-100">Margin of Success</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: accent }}>{percent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={3}
        step={1}
        value={step}
        onChange={(event) => onChange(Number(event.target.value) * 10)}
        className="h-1.5 w-full cursor-pointer"
        style={{ accentColor: accent }}
        aria-valuemin={0}
        aria-valuemax={30}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        aria-label="Margin of success"
      />
      <p className="mt-1 text-xs leading-snug text-neutral-300">
        {percent === 0
          ? 'Off. A higher step adds extra crafts where a skill-up is not guaranteed, rounded up.'
          : `Adds ${percent}% more crafts where a skill-up is not guaranteed, rounded up. A 100% chance stays at one craft.`}
      </p>
    </div>
  );
}

function ExtraProfessionsPicker({
  options,
  selected,
  onChange,
  accent,
}: {
  options: string[];
  selected: string[];
  onChange: (names: string[]) => void;
  accent: string;
}) {
  const chosen = new Set(selected);
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <div className="text-xs font-medium text-neutral-100">Professions you have</div>
      <p className="mt-0.5 text-xs leading-snug text-neutral-300">
        Smelting and other crafts from these professions can supply materials.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5">
        {options.map((name) => (
          <label key={name} className="flex min-w-0 items-center gap-2 text-xs text-neutral-200">
            <input
              type="checkbox"
              checked={chosen.has(name)}
              onChange={() => {
                const next = chosen.has(name) ? selected.filter((item) => item !== name) : [...selected, name];
                onChange(next);
              }}
              className="h-3.5 w-3.5 shrink-0"
              style={{ accentColor: accent }}
            />
            <span className="truncate">{name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AdvancedSettingsControls({
  accentOn,
  accent,
  includeRecipeCost,
  onIncludeRecipeCost,
  useMarketValue,
  onUseMarketValue,
  craftReagents,
  onCraftReagents,
  extraProfessions,
  extraProfessionOptions,
  onExtraProfessions,
  includeCurrencyRecipes,
  onIncludeCurrencyRecipes,
  hideBopRecipeItems,
  onHideBopRecipeItems,
  workingOvertime,
  onWorkingOvertime,
  minSaleRatePercent,
  onMinSaleRate,
  minSkillChancePercent,
  onMinSkillChance,
  successMarginPercent,
  onSuccessMargin,
  onWideChange,
  onReset,
}: {
  accentOn: boolean;
  accent: string;
  includeRecipeCost: boolean;
  onIncludeRecipeCost: (enabled: boolean) => void;
  useMarketValue: boolean;
  onUseMarketValue: (enabled: boolean) => void;
  craftReagents: boolean;
  onCraftReagents: (enabled: boolean) => void;
  extraProfessions: string[];
  extraProfessionOptions: string[];
  onExtraProfessions: (names: string[]) => void;
  includeCurrencyRecipes: boolean;
  onIncludeCurrencyRecipes: (enabled: boolean) => void;
  hideBopRecipeItems: boolean;
  onHideBopRecipeItems: (enabled: boolean) => void;
  workingOvertime: number;
  onWorkingOvertime: (rank: number) => void;
  minSaleRatePercent: number;
  onMinSaleRate: (percent: number) => void;
  minSkillChancePercent: number;
  onMinSkillChance: (percent: number) => void;
  successMarginPercent: number;
  onSuccessMargin: (percent: number) => void;
  onWideChange: (wide: boolean) => void;
  onReset: () => void;
}) {
  const accentClass = accentOn ? 'text-[#1fb5f7]' : 'text-yellow-400';
  const measureRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [splitAfter, setSplitAfter] = useState(1);

  const renderSections = () => [
    <div key="craft" className="space-y-3">
      <SettingsToggle
        label="Craft Your Reagents"
        hint="Create materials such as bolts of cloth from sub-materials self-contained in the relevant profession."
        enabled={craftReagents}
        onChange={onCraftReagents}
        accentOn={accentOn}
        featured
      />
      {craftReagents && (
        <ExtraProfessionsPicker
          options={extraProfessionOptions}
          selected={extraProfessions}
          onChange={onExtraProfessions}
          accent={accent}
        />
      )}
    </div>,
    <SettingsSection key="costs" title="Costs" accentClass={accentClass}>
      <SettingsToggle
        label="Include Recipe Cost"
        hint="Add the price of learning each recipe to the route."
        enabled={includeRecipeCost}
        onChange={onIncludeRecipeCost}
        accentOn={accentOn}
      />
      <SettingsToggle
        label="Use 14-day Rolling Average"
        hint="Price items with the 14-day average instead of the cheapest current listing."
        enabled={useMarketValue}
        onChange={onUseMarketValue}
        accentOn={accentOn}
      />
      <SuccessMarginSlider percent={successMarginPercent} onChange={onSuccessMargin} accent={accent} />
    </SettingsSection>,
    <SettingsSection key="route" title="Route" accentClass={accentClass}>
      <SettingsToggle
        label="Include Currency Recipes"
        hint="Allow recipes that cost a token or other currency."
        enabled={includeCurrencyRecipes}
        onChange={onIncludeCurrencyRecipes}
        accentOn={accentOn}
      />
      <SettingsToggle
        label="Hide BoP Recipe Items"
        hint="Skip crafts learned from a Bind on Pickup recipe item."
        enabled={hideBopRecipeItems}
        onChange={onHideBopRecipeItems}
        accentOn={accentOn}
      />
    </SettingsSection>,
    <SettingsSection key="skill" title="Skill-ups" accentClass={accentClass}>
      {accentOn && (
        <WorkingOvertimeSlider rank={workingOvertime} onChange={onWorkingOvertime} accent={accent} />
      )}
      <MinimumSkillChanceSlider
        percent={minSkillChancePercent}
        onChange={onMinSkillChance}
        accent={accent}
        countsOvertime={accentOn}
      />
    </SettingsSection>,
    <SettingsSection key="auction" title="Auction House" accentClass={accentClass}>
      <MinimumSaleRateSlider percent={minSaleRatePercent} onChange={onMinSaleRate} accent={accent} />
    </SettingsSection>,
  ];

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const measure = () => {
      if (root.getClientRects().length === 0) return;
      const top = root.getBoundingClientRect().top;
      const available = window.innerHeight - top - 20;
      const children = Array.from(root.children) as HTMLElement[];
      const heights = children.map((child) => {
        const style = getComputedStyle(child);
        return child.offsetHeight + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0');
      });
      const total = heights.reduce((sum, height) => sum + height, 0);
      const columnWidth = root.offsetWidth;
      const wideWidth = columnWidth * 2 + 16 + 24;
      const needsWide = total > available && wideWidth <= window.innerWidth - 16 && heights.length > 1;
      let used = 0;
      let nextSplit = 1;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let index = 0; index < heights.length - 1; index += 1) {
        used += heights[index] ?? 0;
        const diff = Math.abs(used - (total - used));
        if (diff < bestDiff) {
          bestDiff = diff;
          nextSplit = index + 1;
        }
      }
      setWide(needsWide);
      onWideChange(needsWide);
      setSplitAfter(nextSplit);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [accentOn, craftReagents, extraProfessionOptions, hideBopRecipeItems, minSaleRatePercent, minSkillChancePercent, onWideChange, successMarginPercent, workingOvertime]);

  const sections = renderSections();
  const left = wide ? sections.slice(0, splitAfter) : sections;
  const right = wide ? sections.slice(splitAfter) : [];

  return (
    <div className="relative">
      <div ref={measureRef} inert aria-hidden className="invisible pointer-events-none absolute left-0 top-0 -z-10 w-[18.5rem] space-y-3">
        {renderSections()}
      </div>
      <div className={wide ? 'flex items-start' : ''}>
        <div className="w-[18.5rem] shrink-0 space-y-3">{left}</div>
        {wide && (
          <div className="ml-4 w-[18.5rem] shrink-0 space-y-3 border-l border-white/10 pl-4">{right}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 w-full rounded-md border border-red-500/70 bg-red-600/25 px-3 py-2 text-sm font-semibold text-red-100 transition-colors hover:border-red-400 hover:bg-red-600/40 hover:text-white"
      >
        Reset to defaults
      </button>
    </div>
  );
}

function MinimumSkillChanceSlider({
  percent,
  onChange,
  accent,
  countsOvertime,
}: {
  percent: number;
  onChange: (percent: number) => void;
  accent: string;
  countsOvertime: boolean;
}) {
  const floorNote = percent > 0 && percent < 10
    ? ' Vendor, Disenchanting, and Auction House still skip anything under 10%.'
    : '';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-100">Minimum Skill-up Chance</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: accent }}>{percent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer"
        style={{ accentColor: accent }}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Minimum skill-up chance"
      />
      <p className="mt-1 text-xs leading-snug text-neutral-300">
        {percent === 0
          ? 'Off for material cost. Vendor, Disenchanting, and Auction House still skip crafts under 10%.'
          : `Skip a craft once its chance of a skill point falls below ${percent}%.${countsOvertime ? ' Working Overtime counts.' : ''}${floorNote}`}
      </p>
    </div>
  );
}

function MinimumSaleRateSlider({
  percent,
  onChange,
  accent,
}: {
  percent: number;
  onChange: (percent: number) => void;
  accent: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-100">Minimum Sale Rate</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: accent }}>{percent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer"
        style={{ accentColor: accent }}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Minimum sale rate"
      />
      <p className="mt-1 text-xs leading-snug text-neutral-300">Auction House mode skips crafts below this chance of selling.</p>
    </div>
  );
}

function realmsForVersion(version: string): string[] {
  return version === 'Forever' ? [...FOREVER_REALMS] : ANNIVERSARY_REALMS;
}

function defaultRealmForVersion(version: string): string {
  return version === 'Forever' ? 'Forever PvE US' : 'Thunderstrike';
}

function realmFromUrl(version: string, urlRealm: string): string | null {
  const available = realmsForVersion(version);
  if (version === 'Forever') {
    const forever = canonicalForeverRealm(urlRealm);
    if (forever && available.includes(forever)) return forever;
  }
  return available.find((realm) => realm.toLowerCase() === urlRealm.toLowerCase()) ?? null;
}

// map WoW quality IDs to standard hex colors
const qualityColors: Record<number,string> = {
  0: '#9d9d9d', // poor (gray)
  1: '#ffffff', // common (white)
  2: '#1eff00', // uncommon (green)
  3: '#0070dd', // rare (blue)
  4: '#a335ee', // epic (purple)
  5: '#ff8000', // legendary (orange)
  6: '#e6cc80', // artifact
  7: '#00ccff', // heirloom
  };

const professions = [
  'Alchemy',
  'Blacksmithing',
  'Cooking',
  'Enchanting',
  'Engineering',
  'Jewelcrafting',
  'Leatherworking',
  'Tailoring',
];

// Max skill level per version
const MAX_SKILL_VANILLA = 300;
const MAX_SKILL_TBC = 375;
const MAX_SKILL_FOREVER = 300;

function getMaxSkill(version: string): number {
  if (version === 'The Burning Crusade') return MAX_SKILL_TBC;
  if (version === 'Forever') return MAX_SKILL_FOREVER;
  return MAX_SKILL_VANILLA;
}

function versionTextClass(version: string): string {
  if (version === 'The Burning Crusade') return 'text-emerald-500';
  if (version === 'Forever') return 'text-[#1fb5f7]';
  return 'text-yellow-300';
}

function versionSelectedClass(version: string): string {
  if (version === 'The Burning Crusade') return 'bg-emerald-500 border-emerald-500';
  if (version === 'Forever') return 'bg-[#1fb5f7] border-[#1fb5f7]';
  return 'bg-yellow-400 border-yellow-400';
}

function versionBarClass(version: string): string {
  if (version === 'The Burning Crusade') return 'bg-emerald-500';
  if (version === 'Forever') return 'bg-[#1fb5f7]';
  return 'bg-yellow-400';
}

function versionRingClass(version: string): string {
  if (version === 'The Burning Crusade') return 'shadow-[inset_0_0_0_1px_rgba(16,185,129,0.55)]';
  if (version === 'Forever') return 'shadow-[inset_0_0_0_1px_rgba(31,181,247,0.55)]';
  return '';
}

function advancedButtonClass(version: string, open: boolean): string {
  if (version === 'The Burning Crusade') {
    return open
      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
      : 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20';
  }
  if (version === 'Forever') {
    return open
      ? 'border-[#1fb5f7] bg-[#1fb5f7]/20 text-[#d7f3ff]'
      : 'border-[#1fb5f7]/65 bg-[#1fb5f7]/10 text-[#8ad9fb] hover:bg-[#1fb5f7]/20';
  }
  return open
    ? 'border-yellow-300 bg-yellow-400/20 text-yellow-100'
    : 'border-yellow-400/60 bg-yellow-400/10 text-yellow-200 hover:bg-yellow-400/20';
}

const FOREVER_SOD_SPELL_IDS = new Set<number>(foreverSodSpellIds);

function withoutForeverSodRecipes<T extends { id: number }>(recipes: T[]): T[] {
  return recipes.filter((recipe) => !FOREVER_SOD_SPELL_IDS.has(recipe.id));
}

function withoutHardGoldRecipes<T extends { name?: string }>(recipes: T[]): T[] {
  return recipes.filter((recipe) => !recipe.name?.startsWith('Hard Gold'));
}

// Version-keyed recipe data (vanilla/ and tbc/ directories)
const rawDataMap: Record<string, Record<string, any[]>> = {
  Vanilla: {
    Alchemy: vanillaAlchemy as any[],
    Blacksmithing: vanillaBlacksmithing as any[],
    Cooking: vanillaCooking as any[],
    Enchanting: vanillaEnchanting as any[],
    Engineering: vanillaEngineering as any[],
    Leatherworking: vanillaLeatherworking as any[],
    Tailoring: vanillaTailoring as any[],
  },
  'The Burning Crusade': {
    Alchemy: tbcAlchemy as any[],
    Blacksmithing: tbcBlacksmithing as any[],
    Cooking: tbcCooking as any[],
    Enchanting: tbcEnchanting as any[],
    Engineering: tbcEngineering as any[],
    Jewelcrafting: tbcJewelcrafting as any[],
    Leatherworking: tbcLeatherworking as any[],
    Tailoring: tbcTailoring as any[],
  },
  Forever: {
    Alchemy: withoutForeverSodRecipes(foreverAlchemy as any[]),
    Blacksmithing: withoutHardGoldRecipes(withoutForeverSodRecipes(foreverBlacksmithing as any[])),
    Cooking: withoutForeverSodRecipes(foreverCooking as any[]),
    Enchanting: withoutForeverSodRecipes(foreverEnchanting as any[]),
    Engineering: withoutForeverSodRecipes(foreverEngineering as any[]),
    Leatherworking: withoutForeverSodRecipes(foreverLeatherworking as any[]),
    Tailoring: withoutForeverSodRecipes(foreverTailoring as any[]),
  },
};

// Function to dynamically load price data
const FOREVER_PRICE_FILES: Record<string, string> = {
  'Forever PvE US_horde': 'ForeverNormal_horde.json',
  'Forever PvE US_alliance': 'ForeverNormal_alliance.json',
  'Forever PvP US_horde': 'ForeverPvP_horde.json',
  'Forever PvP US_alliance': 'ForeverPvP_alliance.json',
  'Forever PvE EU_horde': 'ForeverPvE_EU_horde.json',
  'Forever PvE EU_alliance': 'ForeverPvE_EU_alliance.json',
  'Forever PvP EU_horde': 'ForeverPvP_EU_horde.json',
  'Forever PvP EU_alliance': 'ForeverPvP_EU_alliance.json',
  'Forever RP US_horde': 'ForeverRP_US_horde.json',
  'Forever RP US_alliance': 'ForeverRP_US_alliance.json',
  'Forever RP-PvP US_horde': 'ForeverRPPvP_US_horde.json',
  'Forever RP-PvP US_alliance': 'ForeverRPPvP_US_alliance.json',
  'Forever RP EU_horde': 'ForeverRP_EU_horde.json',
  'Forever RP EU_alliance': 'ForeverRP_EU_alliance.json',
  'Forever RP-PvP EU_horde': 'ForeverRPPvP_EU_horde.json',
  'Forever RP-PvP EU_alliance': 'ForeverRPPvP_EU_alliance.json',
};

async function loadPriceData(realm: string, faction: string): Promise<any[]> {
  try {
    const key = `${realm}_${faction.toLowerCase()}`;
    const filename = FOREVER_PRICE_FILES[key] ?? `${key}.json`;
    
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

// Sale rates from the TSM region file for the selected game and region.
async function loadRegionData(version: string, realm: string): Promise<Map<number, number>> {
  const region = getRegionIdForRealm(realm) === 2 ? 'eu' : 'us';
  const game = version === 'Forever' ? 'forever' : 'classic';
  try {
    const data = await import(`@/data/prices/region_${game}_${region}.json`);
    const rows = (data.default ?? data) as { itemId: number; saleRate?: number }[];
    return buildRegionSaleRateMap(Array.isArray(rows) ? rows : []);
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
function MobDropWarning() {
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded border border-orange-400 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-orange-400 desktop-layout:text-xs">
      [Warning: Recipe is a BoP drop]
    </span>
  );
}

function MobDropCostHint() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ top: rect.top - 8, left: rect.left + rect.width / 2 });
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs desktop-layout:text-xl font-semibold text-[#e3b056]">
      Free
      <span
        ref={anchorRef}
        className="inline-flex cursor-help text-orange-400"
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
        tabIndex={0}
        aria-label="[Warning: Recipe is a BoP drop]"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 desktop-layout:h-5 desktop-layout:w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinejoin="round" d="M12 3.5 21.5 20.5H2.5L12 3.5z" />
          <path strokeLinecap="round" d="M12 9.5v5" />
          <circle cx="12" cy="17.2" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      </span>
      {tip && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-orange-400 bg-neutral-900 px-1.5 py-1 text-[10px] font-semibold leading-none text-orange-400 shadow-lg desktop-layout:text-xs"
          style={{ top: tip.top, left: tip.left }}
        >
          [Warning: Recipe is a BoP drop]
        </span>,
        document.body
      )}
    </span>
  );
}

function chanceColor(chance: number): string {
  const clamped = Math.min(1, Math.max(0, chance));
  return `hsl(${Math.round(clamped * 120)} 72% 58%)`;
}

function CompactMoney({ copper, trim = false }: { copper: number; trim?: boolean }) {
  void trim;
  const rounded = Math.round(Math.abs(copper));
  const gold = Math.floor(rounded / 10000);
  const silver = Math.floor((rounded % 10000) / 100);
  const copperCoins = rounded % 100;
  const showGold = gold > 0;
  const showSilver = showGold || silver > 0;
  const showCopper = true;
  if (!showGold && !showSilver) {
    return <span className="text-orange-400">{copperCoins}c</span>;
  }
  return (
    <span className="inline-flex items-baseline gap-0.5">
      {showGold && <span className="text-yellow-400">{gold}g</span>}
      {showSilver && <span className="text-gray-300">{showGold ? String(silver).padStart(2, '0') : silver}s</span>}
      {showCopper && <span className="text-orange-400">{showGold || showSilver ? String(copperCoins).padStart(2, '0') : copperCoins}c</span>}
    </span>
  );
}

function CostBox({ copper, className = '', trim = false }: { copper: number; className?: string; trim?: boolean }) {
  if (!Number.isFinite(copper)) {
    return (
      <span className={`inline-flex items-center justify-center whitespace-nowrap rounded border border-red-400/25 bg-red-400/5 px-1.5 py-0.5 font-semibold text-red-300/80 ${className}`}>
        —
      </span>
    );
  }
  const gain = copper < 0;
  const spend = copper > 0;
  const tone = gain
    ? 'border-emerald-400/25 bg-emerald-400/5'
    : spend
      ? 'border-red-400/25 bg-red-400/5'
      : 'border-neutral-700 bg-neutral-800/60';
  return (
    <span className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded border px-1.5 py-1 font-semibold leading-none ${tone} ${className}`}>
      {gain && <span className="text-emerald-300/70">+</span>}
      {spend && <span className="text-red-300/70">−</span>}
      <CompactMoney copper={copper} trim={trim} />
    </span>
  );
}

function RecipePrice({
  recipe,
  prices,
  materialInfo,
  useMarketValue,
  trim = false,
}: {
  recipe: Recipe;
  prices: PriceMap;
  materialInfo: Record<number, MaterialInfo>;
  useMarketValue: boolean;
  trim?: boolean;
}) {
  if (!recipe.source || recipe.source.type === 'free') return <CostBox copper={0} trim={trim} className="text-xs desktop-layout:text-sm" />;
  if (recipe.source.type === 'trainer') return <CostBox copper={recipe.source.cost ?? 0} trim={trim} className="text-xs desktop-layout:text-sm" />;
  if (recipe.source.type !== 'item' || !recipe.source.recipeItemId) return <CostBox copper={0} trim={trim} className="text-xs desktop-layout:text-sm" />;

  const recipeInfo = materialInfo[recipe.source.recipeItemId];
  const recipeCostData = getRecipeCost(recipe, prices, materialInfo, useMarketValue);
  const currencyLabel = currencyCostLabel(recipe, materialInfo);
  if (currencyLabel) return <span className="text-xs font-semibold desktop-layout:text-sm">{currencyLabel}</span>;
  if (recipeInfo?.mobDrop && recipeInfo?.bop) return <MobDropCostHint />;
  if (recipeInfo?.bop && recipeCostData.vendorPrice === null && recipeCostData.ahPrice === null) {
    return <span className="text-xs font-semibold text-red-400">Not available</span>;
  }
  if (recipeCostData.vendorPrice === null && recipeCostData.ahPrice === null) {
    return <span className="text-xs font-semibold text-red-400">No price</span>;
  }

  const showVendor = recipeCostData.vendorPrice !== null && recipeCostData.vendorPrice >= 0;
  const showAuction = recipeCostData.ahPrice !== null && recipeCostData.ahPrice > 0;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {showVendor && (
        <span className="inline-flex items-center gap-1.5">
          {showAuction && <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Vendor</span>}
          {recipeInfo?.limitedStock && <span className="text-[10px] font-semibold text-yellow-400">Limited</span>}
          <CostBox copper={recipeCostData.vendorPrice ?? 0} trim={trim} className="text-xs desktop-layout:text-sm" />
        </span>
      )}
      {showAuction && (
        <span className="inline-flex items-center gap-1.5">
          {showVendor && <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Auction</span>}
          <CostBox copper={recipeCostData.ahPrice ?? 0} trim={trim} className="text-xs desktop-layout:text-sm" />
        </span>
      )}
    </span>
  );
}

function CraftValuePanel({
  recipe,
  prices,
  materialInfo,
  useMarketValue,
  optimizeSubCrafting,
  currentProfessionRecipeIds,
  priceSourcing,
  profession,
  includeRecipeCost,
  expCrafts,
  version,
}: {
  recipe: Recipe;
  prices: PriceMap;
  materialInfo: Record<number, MaterialInfo>;
  useMarketValue: boolean;
  optimizeSubCrafting: boolean;
  currentProfessionRecipeIds?: Set<number>;
  priceSourcing: PriceSourcing;
  profession: string;
  includeRecipeCost: boolean;
  expCrafts: number;
  version: string;
}) {
  const materialPerCraft = calculateCraftCost(recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, 'cost', profession);
  const materialRange = materialPerCraft * expCrafts;
  const recipeCost = includeRecipeCost && recipe.source
    ? calculateCraftCost(recipe, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, profession)
    : 0;
  const rangeSpend = materialRange + (Number.isFinite(recipeCost) ? recipeCost : 0);

  const output = recipe.produces;
  const outputQty = output?.quantity ?? 1;
  const outputInfo = output ? materialInfo[output.id] : undefined;
  const sellPerItem = outputInfo?.sellPrice ?? 0;
  const vendorPerCraft = output ? sellPerItem * outputQty : 0;
  const auctionPrice = output
    ? (useMarketValue
      ? (prices[output.id]?.marketValue ?? prices[output.id]?.minBuyout ?? 0)
      : (prices[output.id]?.minBuyout ?? prices[output.id]?.marketValue ?? 0))
    : 0;
  const auctionPerCraft = auctionPrice * outputQty;

  let disenchantPerCraft = 0;
  let disenchantOutcomes: ReturnType<typeof getDisenchantOutcomes> = [];
  if (output) {
    const disenchantItem = resolveDisenchantItem(output.id, materialInfo);
    const quality = recipe.quality ?? outputInfo?.quality ?? 1;
    const isWeapon = disenchantItem.itemClass === '2';
    disenchantOutcomes = getDisenchantOutcomes(
      disenchantItem.itemLevel,
      quality,
      isWeapon,
      disenchantItem.itemClass,
      disenchantItem.slot,
      output.id,
      materialInfo,
    );
    const perItem = getExpectedDisenchantValue(
      disenchantItem.itemLevel,
      quality,
      isWeapon,
      prices,
      materialInfo,
      useMarketValue,
      disenchantItem.itemClass,
      disenchantItem.slot,
      output.id,
    );
    disenchantPerCraft = perItem * outputQty;
  }

  const money = (copper: number) => <CostBox copper={copper} trim className="text-xs desktop-layout:text-sm" />;
  const ranked = output ? [
    { key: 'vendor', label: 'Vendor', perCraft: vendorPerCraft },
    { key: 'listing', label: useMarketValue ? '14-day average' : 'Auction listing', perCraft: auctionPerCraft },
    ...(disenchantOutcomes.length > 0 ? [{ key: 'disenchant', label: 'Disenchant', perCraft: disenchantPerCraft }] : []),
  ].sort((a, b) => b.perCraft - a.perCraft) : [];
  const bestKey = ranked[0]?.key;

  return (
    <>
      <div className="flex items-center justify-between border-y border-[#e3b056]/20 bg-gradient-to-r from-[#e3b056]/12 to-transparent px-4 py-4 desktop-layout:px-6 desktop-layout:py-5">
        <h3 className="text-sm font-medium leading-6 tracking-tight text-white desktop-layout:text-lg">Cost and returns</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-xs desktop-layout:text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.14em] text-[#e3b056]">
              <th className="px-4 py-2 text-left font-medium desktop-layout:px-6" />
              <th className="px-3 py-2 text-right font-medium">One craft</th>
              <th className="px-3 py-2 text-right font-medium">This range</th>
              <th className="px-4 py-2 text-right font-medium desktop-layout:px-6">After costs</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th colSpan={4} className="bg-white/[0.03] px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e3b056] desktop-layout:px-6">Spent</th>
            </tr>
            <tr className="border-t border-white/[0.06]">
              <th className="px-4 py-2.5 text-left font-medium text-neutral-200 desktop-layout:px-6">Materials</th>
              <td className="px-3 py-2.5 text-right">{money(materialPerCraft)}</td>
              <td className="px-3 py-2.5 text-right">{money(materialRange)}</td>
              <td className="px-4 py-2.5 desktop-layout:px-6" />
            </tr>
            <tr className="border-t border-white/[0.06]">
              <th className="px-4 py-2.5 text-left font-medium text-neutral-200 desktop-layout:px-6">
                Recipe
                <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-neutral-500">Paid once</span>
              </th>
              <td className="px-3 py-2.5 text-right"><RecipePrice recipe={recipe} prices={prices} materialInfo={materialInfo} useMarketValue={useMarketValue} trim /></td>
              <td className="px-3 py-2.5 text-right"><RecipePrice recipe={recipe} prices={prices} materialInfo={materialInfo} useMarketValue={useMarketValue} trim /></td>
              <td className="px-4 py-2.5 desktop-layout:px-6" />
            </tr>
            <tr>
              <th colSpan={4} className="bg-white/[0.03] px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e3b056] desktop-layout:px-6">Returned</th>
            </tr>
            {output ? ranked.map((outlet) => (
              <Fragment key={outlet.key}>
                <tr className="border-t border-white/[0.06]">
                  <th className="px-4 py-2.5 text-left font-medium text-neutral-200 desktop-layout:px-6">
                    {outlet.label}
                    {outlet.key === bestKey && <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Best</span>}
                  </th>
                  <td className="px-3 py-2.5 text-right">{money(-outlet.perCraft)}</td>
                  <td className="px-3 py-2.5 text-right">{money(-outlet.perCraft * expCrafts)}</td>
                  <td className="px-4 py-2.5 text-right desktop-layout:px-6">{money(rangeSpend - outlet.perCraft * expCrafts)}</td>
                </tr>
                {outlet.key === 'disenchant' && (
                  <tr>
                    <td colSpan={4} className="px-4 pb-3 desktop-layout:px-6">
                      <div className="overflow-hidden rounded-md border border-white/[0.06]">
                      <table className="w-full border-collapse text-xs desktop-layout:text-sm">
                        <thead>
                          <tr className="bg-white/[0.03] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e3b056]">
                            <th className="px-3 py-1.5 text-left font-semibold">This range</th>
                            <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">Chance</th>
                            <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">Amount</th>
                            <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">Expected</th>
                            <th className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {disenchantOutcomes.map((outcome, index) => {
                            const averageQty = (outcome.minQty + outcome.maxQty) / 2;
                            const expectedQty = outcome.chance * averageQty * outputQty * expCrafts;
                            const price = disenchantMaterialValue(outcome.itemId, prices, useMarketValue);
                            const matName = materialInfo[outcome.itemId]?.name ?? `Item ${outcome.itemId}`;
                            const matQuality = materialInfo[outcome.itemId]?.quality ?? 1;
                            const qtyRange = outcome.minQty === outcome.maxQty ? `${outcome.minQty}` : `${outcome.minQty}–${outcome.maxQty}`;
                            return (
                              <tr key={`${outcome.itemId}-${index}`} className="border-t border-white/[0.06]">
                                <td className="px-3 py-2">
                                  <a
                                    href={`https://www.wowhead.com/${getWowheadBase(version)}/item=${outcome.itemId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex min-w-0 items-center gap-2 hover:underline"
                                  >
                                    <CachedIcon category="materials" id={outcome.itemId} className="h-5 w-5 shrink-0 rounded border border-neutral-600 object-cover desktop-layout:h-6 desktop-layout:w-6" />
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium" style={{ color: qualityColors[matQuality] }}>{matName}</span>
                                      <span className="text-[11px] text-[#e3b056]"><CompactMoney copper={price} trim /> each</span>
                                    </span>
                                  </a>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-semibold" style={{ color: chanceColor(outcome.chance) }}>{Math.round(outcome.chance * 100)}%</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right align-middle text-neutral-100">{qtyRange}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right align-middle text-neutral-100">{expectedQty.toFixed(2)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-semibold text-neutral-100"><CompactMoney copper={expectedQty * price} trim /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )) : (
              <tr className="border-t border-white/[0.06]">
                <td colSpan={4} className="px-4 py-3 text-neutral-400 desktop-layout:px-6">This craft does not create an item to sell or disenchant.</td>
              </tr>
            )}
            {output && disenchantOutcomes.length === 0 && (
              <tr className="border-t border-white/[0.06]">
                <th className="px-4 py-2.5 text-left font-medium text-neutral-200 desktop-layout:px-6">Disenchant</th>
                <td colSpan={3} className="px-4 py-2.5 text-right text-neutral-500 desktop-layout:px-6">Cannot be disenchanted</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SkillBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded border border-neutral-700 bg-neutral-800/60 px-1.5 py-1 text-[12px] font-semibold leading-none desktop-layout:text-[15px] ${className}`}>
      {children}
    </span>
  );
}

function MaterialSourceBadge({ source, className = '' }: { source?: 'vendor' | 'auction' | null; className?: string }) {
  if (!source) return null;
  const vendor = source === 'vendor';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] desktop-layout:text-xs font-semibold leading-none ${
        vendor ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[#1fb5f7]/15 text-[#7dd3fc]'
      } ${className}`}
      title={vendor ? 'Bought from a vendor' : 'Bought on the auction house'}
    >
      {vendor ? 'Vendor' : 'Auction House'}
    </span>
  );
}

/** Temporary. The manual-copy menu is shown whenever a string exists, so the fallback can be checked before it is limited to clipboard failures. */
const ALWAYS_SHOW_MANUAL_COPY = true;

function ShoppingListImport({
  profession,
  skill,
  target,
  items,
  steps,
  successMarginPercent,
  realm,
  faction,
}: {
  profession: string;
  skill: number;
  target: number;
  items: ShoppingListItem[];
  steps: GuideStep[];
  successMarginPercent: number;
  realm: string;
  faction: string;
}) {
  const [copied, setCopied] = useState<'auctionator' | 'tsm' | 'weakaura' | 'weakaura-failed' | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [manualCopy, setManualCopy] = useState<{ kind: 'auctionator' | 'tsm' | 'weakaura'; text: string } | null>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [helpBox, setHelpBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const listName = auctionatorListName(profession, skill, target, realm);
  const empty = items.length === 0;

  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!manualCopy) return;
    const area = manualCopyRef.current;
    if (area) {
      area.focus();
      area.select();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setManualCopy(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualCopy]);

  useEffect(() => {
    if (!helpOpen) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(rect.width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setHelpBox({ top: rect.top - 8, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [helpOpen]);

  const markCopied = (kind: 'auctionator' | 'tsm' | 'weakaura' | 'weakaura-failed') => {
    setCopied(kind);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setCopied(null);
    }, 2000);
  };

  const offerManualCopy = (kind: 'auctionator' | 'tsm' | 'weakaura', text: string, copiedOk: boolean) => {
    if (copiedOk && !ALWAYS_SHOW_MANUAL_COPY) {
      setManualCopy(null);
      return;
    }
    setManualCopy({ kind, text });
  };

  const copy = async (kind: 'auctionator' | 'tsm' | 'weakaura') => {
    if (kind === 'weakaura') {
      setEncoding(true);
      setManualCopy(null);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      let text = '';
      try {
        const { weakAuraShoppingList } = await import('@/lib/weakaura/encode');
        text = await weakAuraShoppingList(profession, skill, target, items, profession === 'Enchanting' ? [] : steps, realm, faction, successMarginPercent);
      } catch {
        markCopied('weakaura-failed');
        setEncoding(false);
        return;
      }
      if (!text) {
        markCopied('weakaura-failed');
        setEncoding(false);
        return;
      }
      const copiedOk = await copyText(text);
      markCopied(copiedOk ? 'weakaura' : 'weakaura-failed');
      offerManualCopy('weakaura', text, copiedOk);
      setEncoding(false);
      return;
    }
    const text = kind === 'auctionator'
      ? auctionatorShoppingList(profession, skill, target, items, realm)
      : tsmShoppingList(items);
    if (!text) return;
    const copiedOk = await copyText(text);
    if (copiedOk) markCopied(kind);
    offerManualCopy(kind, text, copiedOk);
  };

  return (
    <div ref={rootRef} className="flex-shrink-0 border-t border-neutral-800 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Shopping list</div>
          <div className="truncate text-sm font-semibold text-neutral-100" title={listName}>{listName}</div>
        </div>
        <button
          type="button"
          aria-expanded={helpOpen}
          aria-label="How to import this shopping list"
          onClick={() => setHelpOpen((open) => !open)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-600 bg-neutral-800 text-sm font-semibold text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
        >
          ?
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={empty || encoding}
          onClick={() => copy('weakaura')}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-[#6b3fa0] bg-[#2a1840] px-2 py-2 text-xs font-semibold text-[#d7b3ff] transition-colors hover:bg-[#3a2258] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {encoding || copied === 'weakaura' || copied === 'weakaura-failed' ? null : (
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-[#e3b056]" fill="currentColor" aria-hidden="true">
              <path d="M10 1.6 12.4 6.5l5.4.8-3.9 3.8.9 5.4L10 14.1l-4.8 2.4.9-5.4L2.2 7.3l5.4-.8L10 1.6z" />
            </svg>
          )}
          {encoding ? 'Copying' : copied === 'weakaura' ? 'Copied' : copied === 'weakaura-failed' ? 'Failed - Manual Import Required' : 'Recommended - Weakaura Profession Helper'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={empty}
            onClick={() => copy('auctionator')}
            className="rounded border border-[#8a6a2f] bg-[#3a2c12] px-2 py-2 text-xs font-semibold text-[#f6d98a] transition-colors hover:bg-[#4a3918] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied === 'auctionator' ? 'Copied' : 'Auctionator'}
          </button>
          <button
            type="button"
            disabled={empty}
            onClick={() => copy('tsm')}
            className="rounded border border-[#1f7a68] bg-[#102e2a] px-2 py-2 text-xs font-semibold text-[#9cf0e0] transition-colors hover:bg-[#164038] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied === 'tsm' ? 'Copied' : 'TSM'}
          </button>
        </div>
        {manualCopy && (
          <div className="rounded border border-neutral-700 bg-neutral-950 p-2 shadow-lg">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-neutral-300">
                {manualCopy.kind === 'weakaura' ? 'Copy the WeakAura string' : manualCopy.kind === 'auctionator' ? 'Copy the Auctionator string' : 'Copy the TSM string'}
              </span>
              <button
                type="button"
                aria-label="Close manual copy"
                onClick={() => setManualCopy(null)}
                className="text-neutral-400 transition-colors hover:text-neutral-200"
              >
                ✕
              </button>
            </div>
            <textarea
              ref={manualCopyRef}
              readOnly
              value={manualCopy.text}
              aria-label="Import string"
              onFocus={(event) => event.currentTarget.select()}
              className="h-24 w-full resize-none rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-[10px] leading-snug text-neutral-100 outline-none [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-600/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:transition-colors [&::-webkit-scrollbar-thumb]:duration-300 hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600/60 motion-safe:transition-[scrollbar-color] motion-safe:duration-300 scrollbar-thin scrollbar-thumb-neutral-600/40 hover:scrollbar-thumb-neutral-600/60"
            />
          </div>
        )}
      </div>
      {helpOpen && helpBox && createPortal(
        <div className="fixed inset-0 z-[80]" onMouseDown={() => setHelpOpen(false)}>
          <div
            role="dialog"
            aria-label="How to import this shopping list"
            className="fixed -translate-y-full rounded border border-neutral-700 bg-neutral-900 p-3 text-xs leading-relaxed text-neutral-300 shadow-lg"
            style={{ top: helpBox.top, left: helpBox.left, width: helpBox.width }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-2 font-semibold text-neutral-100">How to import</div>
            <div className="mb-1 font-semibold text-[#f6d98a]">Auctionator</div>
            <p className="mb-2">
              Open the auction house, go to the Shopping tab, and click Import. Paste the copied text.
              The list is saved as {listName}. Search that list. The number at the end of each line is how many to buy.
            </p>
            <div className="mb-1 font-semibold text-[#9cf0e0]">TSM</div>
            <p className="mb-2">
              Open the auction house and paste the copied text into the TSM Shopping search box.
              Each <span className="text-neutral-100">i:2447/x84</span> term is one item, and the number after /x is how many to buy before that item drops out of the results.
            </p>
            <div className="mb-1 font-semibold text-[#d7b3ff]">WeakAura</div>
            <p>
              Open WeakAuras and click Import. Paste the copied text. The aura is named {listName} and sits at the top left. Each row starts with the material, then Vendor in green or AH in blue. Red is how many you still need, yellow is how many you have bought and not yet picked up, and green is how many are in your bags. Yellow goes down as those items enter your bags, and it resets if you import this list again. Opening the professions window also shows a separate guide frame. The current craft sits at the top with its icon and the reagents it still needs. Each reagent shows how many are in your bags against how many that craft needs, green when you have enough and red when you do not. Craft makes one of the current recipe and Craft All makes the rest of that step, after selecting it in the professions window. If you have not learned the recipe, those buttons are replaced by its source. It uses your profession skill, so a 1 to 300 guide opened at skill 50 starts on the step that covers 50. The warning in the middle of the screen appears each time you import it. If your skill is already above the guide&apos;s starting skill, it explains the skip. If the guide starts above your skill, it warns that the crafts are too high for you. Accept skip drops those steps and removes their materials from the shopping list. Keep the full guide to leave every step and every material in place. The later crafts are listed underneath, each with an icon. The guide hides when the professions window closes. Import again after you change the guide.
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function RecipeSourceMark({ recipe, materialInfo }: { recipe: Recipe; materialInfo: Record<number, MaterialInfo> }) {
  const source = recipe.source;
  if (!source) return null;
  if (source.type === 'free') {
    return (
      <span
        className="inline-flex w-fit items-center rounded bg-[#e3b056]/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#e3b056] desktop-layout:text-xs"
        title="Learned for free"
      >
        Free
      </span>
    );
  }
  if (source.type === 'trainer') {
    return (
      <span
        className="inline-flex w-fit items-center rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-neutral-200 desktop-layout:text-xs"
        title="Learned from a trainer"
      >
        Trainer
      </span>
    );
  }
  const name = source.recipeItemName || (source.recipeItemId ? `Item ${source.recipeItemId}` : 'Recipe item');
  const quality = source.recipeItemId ? materialInfo[source.recipeItemId]?.quality ?? 1 : 1;
  return (
    <span
      className="block truncate text-[10px] font-medium leading-tight desktop-layout:text-xs"
      style={{ color: qualityColors[quality] }}
      title={name}
    >
      {name}
    </span>
  );
}

function SelectedCraftSource({
  recipe,
  materialInfo,
  wowheadBase,
}: {
  recipe: Recipe;
  materialInfo: Record<number, MaterialInfo>;
  wowheadBase: string;
}) {
  const source = recipe.source;
  if (!source) return null;

  const row = (detail: ReactNode) => (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-sm desktop-layout:text-base">
      <span className="shrink-0 text-neutral-400">Source</span>
      {detail}
    </div>
  );

  if (source.type === 'free') {
    return row(<span className="font-semibold text-[#e3b056]">Free</span>);
  }
  if (source.type === 'trainer') {
    const trainers = (source.trainers ?? []).map((trainer) => trainer.name).filter(Boolean);
    return row(
      <span className="font-semibold text-neutral-100">
        {trainers.length ? `Trainer: ${trainers.join(', ')}` : 'Trainer'}
      </span>
    );
  }
  const recipeItem = source.recipeItemId ? materialInfo[source.recipeItemId] : undefined;
  const recipeItemName = source.recipeItemName || recipeItem?.name || (source.recipeItemId ? `Item ${source.recipeItemId}` : 'Recipe item');
  const name = (
    <span className="truncate font-semibold" style={{ color: qualityColors[recipeItem?.quality ?? 1] }}>
      {recipeItemName}
    </span>
  );
  if (!source.recipeItemId) return row(name);
  return row(
    <a
      href={`https://www.wowhead.com/${wowheadBase}/item=${source.recipeItemId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-w-0 items-center gap-2 hover:underline"
    >
      <CachedIcon
        category="materials"
        id={source.recipeItemId}
        alt={recipeItemName}
        className="h-5 w-5 desktop-layout:h-6 desktop-layout:w-6 rounded border border-neutral-700 object-cover flex-shrink-0"
      />
      {name}
    </a>
  );
}

function RecipeDetailsSection({
  recipe,
  wowheadBase,
  materialInfo,
  prices,
  useMarketValue,
}: {
  recipe: Recipe;
  wowheadBase: string;
  materialInfo: Record<number, MaterialInfo>;
  prices: PriceMap;
  useMarketValue: boolean;
}) {
  const source = recipe.source;
  if (!source) return null;

  const label = source.type === 'free' ? 'Free' : source.type === 'trainer' ? 'Trainer' : 'Recipe';
  const recipeItem = source.type === 'item' ? materialInfo[source.recipeItemId ?? -1] : undefined;
  const recipeItemName = source.recipeItemName || recipeItem?.name || (source.recipeItemId ? `Item ${source.recipeItemId}` : 'Recipe item');
  const priceData = source.recipeItemId ? prices[source.recipeItemId] : undefined;
  const vendorPrice = recipeItem?.buyPrice != null && recipeItem.buyPrice > 0 ? recipeItem.buyPrice : null;
  const marketValue = priceData?.marketValue ?? 0;
  const minBuyout = priceData?.minBuyout ?? 0;
  const ahPrice = useMarketValue
    ? (marketValue > 0 ? marketValue : (minBuyout > 0 ? minBuyout : null))
    : (minBuyout > 0 ? minBuyout : (marketValue > 0 ? marketValue : null));
  const sentence = source.type === 'free'
    ? 'This recipe is given for free when learning the Profession.'
    : 'This recipe is learned at your profession trainer.';
  const price = source.type === 'trainer'
    ? (source.cost ?? 0)
    : source.type === 'item'
      ? (vendorPrice ?? ahPrice)
      : null;
  const currencyLabel = currencyCostLabel(recipe, materialInfo);

  return (
    <>
      <div className="flex items-center justify-between border-y border-[#e3b056]/20 bg-gradient-to-r from-[#e3b056]/12 to-transparent px-4 py-4 desktop-layout:py-5 sm:px-6">
        <h3 className="text-sm desktop-layout:text-lg font-medium leading-6 tracking-tight text-white">Recipe</h3>
      </div>
      <div className="flex items-center gap-3 px-4 py-4 text-sm desktop-layout:px-6 desktop-layout:py-5 desktop-layout:text-base">
        <span
          className={`inline-flex shrink-0 items-center rounded px-2 py-1 text-xs desktop-layout:text-sm font-semibold leading-none ${
            source.type === 'free'
              ? 'bg-[#e3b056]/15 text-[#e3b056]'
              : 'bg-neutral-700 text-neutral-200'
          }`}
        >
          {label}
        </span>
        {source.type === 'item' ? (
          source.recipeItemId ? (
            <a
              href={`https://www.wowhead.com/${wowheadBase}/item=${source.recipeItemId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
            >
              <CachedIcon
                category="materials"
                id={source.recipeItemId}
                alt={recipeItemName}
                className="h-6 w-6 desktop-layout:h-8 desktop-layout:w-8 rounded border border-neutral-700 object-cover flex-shrink-0"
              />
              <span
                className="truncate font-medium"
                style={{ color: qualityColors[recipeItem?.quality ?? 1] }}
              >
                {recipeItemName}
              </span>
            </a>
          ) : (
            <span className="min-w-0 flex-1 truncate font-medium text-neutral-200">{recipeItemName}</span>
          )
        ) : (
          <span className="min-w-0 flex-1 text-neutral-300">{sentence}</span>
        )}
        {currencyLabel ? (
          <span className="shrink-0 font-semibold text-neutral-100">{currencyLabel}</span>
        ) : isBopMobDropRecipe(recipe, materialInfo) ? (
          <MobDropWarning />
        ) : price != null && (
          <span className="shrink-0 font-semibold text-neutral-100" title={recipeItem?.limitedStock ? 'Limited stock' : undefined}>
            <FormatMoney copper={price} />
          </span>
        )}
      </div>
    </>
  );
}

function MaterialPriceLines({
  ahCost,
  vendorCost,
  recommended,
}: {
  ahCost?: number | null;
  vendorCost?: number | null;
  recommended?: 'vendor' | 'auction' | null;
}) {
  const lines = [
    ahCost != null && Number.isFinite(ahCost) && ahCost > 0 ? { label: 'Auction House', value: ahCost, className: 'text-[#7dd3fc]', source: 'auction' as const } : null,
    vendorCost != null && Number.isFinite(vendorCost) && vendorCost > 0 ? { label: 'Vendor', value: vendorCost, className: 'text-emerald-300', source: 'vendor' as const } : null,
  ].filter((line): line is { label: string; value: number; className: string; source: 'vendor' | 'auction' } => line != null);
  if (!lines.length) return null;
  const marked = lines.length > 1 && recommended && lines.some((line) => line.source === recommended)
    ? recommended
    : null;
  return (
    <div className="grid grid-cols-[auto_auto_auto] items-baseline justify-end gap-x-2 gap-y-0.5">
      {lines.map((line) => (
        <span key={line.label} className="contents">
          <span className="text-right">
            {line.source === marked && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#e3b056] desktop-layout:text-xs">
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                  <path d="M10 1.6 12.4 6.5l5.4.8-3.9 3.8.9 5.4L10 14.1l-4.8 2.4.9-5.4L2.2 7.3l5.4-.8L10 1.6z" />
                </svg>
                Recommended
              </span>
            )}
          </span>
          <span className={`text-right text-[10px] font-semibold desktop-layout:text-xs ${line.className}`}>{line.label}</span>
          <span className="text-right text-sm desktop-layout:text-base">
            <SafeMoney value={line.value} />
          </span>
        </span>
      ))}
    </div>
  );
}

function MaterialCard({
  node,
  depth = 0,
  materialInfo,
  position = 'only',
  expCrafts,
  wowheadBase,
}: {
  node: MaterialTreeNode;
  depth?: number;
  materialInfo: Record<number, MaterialInfo>;
  position?: 'top' | 'middle' | 'bottom' | 'only';
  expCrafts: number;
  wowheadBase: string;
}) {
  const roundedClass = {
    only: 'rounded-lg',
    top: 'rounded-lg',
    middle: 'rounded-lg',
    bottom: 'rounded-lg',
  }[position];
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 64;
  const info = materialInfo[node.id];

  const isParent = node.children && node.children.length > 0;
  const canCraftCheaper = node.craftCost < node.buyCost;

  const displayChildren = canCraftCheaper && isParent;

  // Calculate per-craft quantity by dividing total quantity by number of crafts
  const perCraftQuantity = node.quantity / expCrafts;
  const usedCost = Number.isFinite(node.totalCost) ? node.totalCost : node.buyCost;
  const eachCost = node.quantity > 0 && Number.isFinite(usedCost) ? usedCost / node.quantity : null;

  return (
    <div style={{ marginLeft: `${indent}px` }}>
      <div
        onClick={() => displayChildren && setExpanded(prev => !prev)}
        className={`mb-2 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 transition-colors duration-150 desktop-layout:px-4 desktop-layout:py-3 ${
          displayChildren ? 'cursor-pointer hover:bg-white/[0.06]' : ''
        } ${roundedClass}`}
      >
        <div className="flex items-center gap-2 desktop-layout:gap-3">
          <span className="text-sm desktop-layout:text-base">{node.quantity}</span>
          <a
            href={`https://www.wowhead.com/${wowheadBase}/item=${node.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 desktop-layout:gap-3 min-w-0 hover:underline"
          >
            {info && (
              <CachedIcon
                category="materials"
                id={node.id}
                alt={info?.name ?? 'Item'}
                className="h-6 w-6 flex-shrink-0 rounded-md object-cover ring-1 ring-white/15 desktop-layout:h-8 desktop-layout:w-8"
              />
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-sm desktop-layout:text-base font-medium truncate" style={{ color: qualityColors[info?.quality ?? 1] }}>
                {node.name}
              </span>
              <span className="text-xs desktop-layout:text-sm text-neutral-400">
                Per Craft: {perCraftQuantity}
                {eachCost != null && (
                  <>
                    <span className="mx-1.5 text-neutral-600">·</span>
                    Each <CompactMoney copper={eachCost} trim />
                  </>
                )}
              </span>
            </div>
          </a>
        </div>
        <div className="flex flex-col items-end text-right">
          {(node.ahCost != null && Number.isFinite(node.ahCost)) || (node.vendorCost != null && Number.isFinite(node.vendorCost)) ? (
            <MaterialPriceLines ahCost={node.ahCost} vendorCost={node.vendorCost} recommended={node.buySource} />
          ) : node.noAhPrice ? (
            <div className="flex flex-col items-end text-right text-yellow-400 font-medium text-xs desktop-layout:text-sm">
              <div>⚠️ No auction listing — crafting cost used instead</div>
              <div><SafeMoney value={node.craftCost} /></div>
              <div className="text-[10px] desktop-layout:text-xs text-neutral-400 mt-0.5 desktop-layout:mt-1">
                Per Craft: <SafeMoney value={node.craftCost / expCrafts} />
              </div>
            </div>
          ) : (
            <span className="text-red-400 text-xs font-medium">⚠️ No price available</span>
          )}

          {Number.isFinite(node.buyCost) &&
            Number.isFinite(node.craftCost) &&
            node.buyCost > node.craftCost && (
              <span className="text-green-400 text-[10px] desktop-layout:text-xs font-semibold mt-1 desktop-layout:mt-2">
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
              wowheadBase={wowheadBase}
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
  wowheadBase,
}: {
  rootNodes: MaterialTreeNode[];
  materialInfo: Record<number, MaterialInfo>;
  expCrafts: number;
  wowheadBase: string;
}) {
  return (
    <div>
      {rootNodes.map((node, i) => (
        <MaterialCard
          key={`${node.id}-${i}`}
          node={node}
          materialInfo={materialInfo}
          wowheadBase={wowheadBase}
          position={node.children?.length ? 'top' : 'only'}
          expCrafts={expCrafts}
        />
      ))}
    </div>
  );
}


// ── component ──
function lowSaleRateLabel(
  recipe: Recipe,
  priceSourcing: string,
  regionSaleRate: Map<number, number> | null,
  minSaleRate: number,
  minSaleRatePercent: number,
): string | null {
  if (priceSourcing !== 'auction-house' || !regionSaleRate || !recipe.produces?.id) return null;
  const rate = regionSaleRate.get(recipe.produces.id);
  if (!isBelowMinSaleRate(rate, minSaleRate)) return null;
  const shown = Math.round((rate ?? 0) * 100);
  return `Sale rate ${shown}% is below the ${minSaleRatePercent}% minimum, so Auction House mode skips this recipe.`;
}

function firstRecipeStep(recipe: Recipe): { low: number; high: number } {
  const start = Math.max(1, getEffectiveMinSkill(recipe));
  const gray = recipe.difficulty.gray ?? start + 1;
  const high = Math.min(gray, start + 1);
  return { low: start, high: high > start ? high : start + 1 };
}

export default function ProfessionPlanner() {
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
  const [target, setTarget] = useState(() => getMaxSkill(parsePlannerVersion(urlVersion) ?? 'Forever'));
  const [committedTarget, setCommittedTarget] = useState(() => getMaxSkill(parsePlannerVersion(urlVersion) ?? 'Forever'));
  // Profession to snap to 1 → the furthest priced skill. Null once the visitor chooses a span.
  const fitGuideRangeRef = useRef<string | null>(null);
  const guideSearchGenRef = useRef(0);
  const guideLimitGenRef = useRef(0);
  const [view, setView] = useState<'route'|'all'>('route');
  const [saleRateTip, setSaleRateTip] = useState<{ top: number; left: number; text: string } | null>(null);
  const [swapTip, setSwapTip] = useState<{ top: number; left: number; text: string } | null>(null);
  const [recipeSort, setRecipeSort] = useState<{ key: 'name' | 'profit' | 'skill'; dir: 'asc' | 'desc' }>({ key: 'skill', dir: 'asc' });
  // Proof of concept. Classic layout is the previous header; compact is the tighter one.
  const [compactHeader, setCompactHeader] = useState(true);
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
      const initialVersion = parsePlannerVersion(urlVersion) ?? 'Forever';
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
  const [selectedVersion, setSelectedVersion] = useState(() => parsePlannerVersion(urlVersion) ?? 'Forever');
  const realms = useMemo(() => realmsForVersion(selectedVersion), [selectedVersion]);
  const factions = useMemo(() => ["Alliance", "Horde"], []);

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
    const version = parsePlannerVersion(urlVersion) ?? 'Forever';
    const available = realmsForVersion(version);
    if (urlRealm) {
      const normalizedRealm = realmFromUrl(version, urlRealm);
      if (normalizedRealm) return normalizedRealm;
      }
    return defaultRealmForVersion(version);
  });
  const [selectedFaction, setSelectedFaction] = useState(() => {
    if (urlFaction) {
      const normalizedFaction = factions.find(f => f.toLowerCase() === urlFaction.toLowerCase());
      if (normalizedFaction) return normalizedFaction;
      }
    return (parsePlannerVersion(urlVersion) ?? 'Forever') === 'Forever' ? 'Horde' : 'Alliance';
  });
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [costChartOpen, setCostChartOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerDragX, setDrawerDragX] = useState<number | null>(null);
  const drawerDragStartRef = useRef<{ x: number; startOpen: boolean } | null>(null);
  const drawerDragXRef = useRef<number>(0);
  const [useMarketValue, setUseMarketValue] = useState(false);
  const [craftReagents, setCraftReagents] = useState(false);
  const [extraProfessions, setExtraProfessions] = useState<string[]>([]);
  const optimizeSubCrafting = craftReagents;
  const [priceSourcing, setPriceSourcing] = useState<PriceMode>(() => parsePriceMode(searchParams.get('price')) ?? 'cost');
  const [showAuctionHouseDisclaimer, setShowAuctionHouseDisclaimer] = useState(false);
  const [auctionHouseDisclaimerAcked, setAuctionHouseDisclaimerAcked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const acked = localStorage.getItem('wowcraft-auction-house-disclaimer-acknowledged') === 'true';
    setAuctionHouseDisclaimerAcked(acked);
  }, []);

  const handleAuctionHouseClick = useCallback(() => {
    if (auctionHouseDisclaimerAcked) {
      recentUserChangeTimestampRef.current = Date.now();
      setPriceSourcing('auction-house');
    } else {
      setShowAuctionHouseDisclaimer(true);
    }
  }, [auctionHouseDisclaimerAcked]);

  const acknowledgeAuctionHouseDisclaimer = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('wowcraft-auction-house-disclaimer-acknowledged', 'true');
    }
    setAuctionHouseDisclaimerAcked(true);
    setShowAuctionHouseDisclaimer(false);
    recentUserChangeTimestampRef.current = Date.now();
    setPriceSourcing('auction-house');
  }, []);

  // Add isSliding state to track active slider interaction
  const [isSliding, setIsSliding] = useState(false);
  const [isReleased, setIsReleased] = useState(false);
  const [isDirectChange, setIsDirectChange] = useState(false);
  const [includeRecipeCost, setIncludeRecipeCost] = useState(true);
  const [includeCurrencyRecipes, setIncludeCurrencyRecipes] = useState(false);
  const [hideBopRecipeItems, setHideBopRecipeItems] = useState(true);
  const [recipePreferences, setRecipePreferences] = useState<StoredRecipePreference[]>([]);
  const preferenceExpiryRef = useRef<number | null>(null);
  const [workingOvertime, setWorkingOvertime] = useState(0);
  const skipLimitedStock = true; // Always skip limited-stock BoP recipes
  const [minSaleRatePercent, setMinSaleRatePercent] = useState(DEFAULT_MIN_SALE_RATE_PERCENT);
  const [minSkillChancePercent, setMinSkillChancePercent] = useState(DEFAULT_MIN_SKILL_CHANCE_PERCENT);
  const [successMarginPercent, setSuccessMarginPercent] = useState(0);
  const minSaleRate = minSaleRatePercent / 100;
  const minSkillUpChance = minSkillChancePercent / 100;
  const saleRateAccent = selectedVersion === 'Forever' ? '#1fb5f7' : '#eab308';
  const workingOvertimeRank = selectedVersion === 'Forever' ? workingOvertime : 0;

  useEffect(() => {
    setMinSaleRatePercent(readMinSaleRatePercent());
    const savedSkillChance = readMinSkillChancePercent();
    setMinSkillChancePercent(savedSkillChance);
    if (!document.cookie.split('; ').some((part) => part.startsWith(`${MIN_SKILL_CHANCE_COOKIE}=`))) {
      writeMinSkillChancePercent(savedSkillChance);
    }
    setCraftReagents(readCraftReagents());
    setExtraProfessions(readExtraProfessions());
    setHideBopRecipeItems(readHideBopRecipes());
    setWorkingOvertime(readWorkingOvertime());
    setSuccessMarginPercent(readSuccessMarginPercent());
    const storedPreferences = readRecipePreferences();
    setRecipePreferences(storedPreferences.pairs);
    if (storedPreferences.pairs.length > 0) {
      const remaining = storedPreferences.savedAt + RECIPE_PREFERENCE_MS - Date.now();
      preferenceExpiryRef.current = window.setTimeout(() => setRecipePreferences([]), Math.max(0, remaining));
    }
    return () => {
      if (preferenceExpiryRef.current != null) window.clearTimeout(preferenceExpiryRef.current);
    };
  }, []);

  useEffect(() => {
    const version = parsePlannerVersion(urlVersion) ?? 'Forever';
    if (!urlRealm) {
      const savedRealm = readRealmCookie(version);
      if (savedRealm) setSelectedRealm(savedRealm);
    }
    if (!urlFaction) {
      const savedFaction = readFactionCookie();
      if (savedFaction) setSelectedFaction(savedFaction);
    }
    if (!searchParams.get('price')) {
      const savedPrice = readPriceCookie();
      if (savedPrice) setPriceSourcing(savedPrice);
    }
  }, []);

  const updateHideBopRecipes = useCallback((hide: boolean) => {
    setHideBopRecipeItems(hide);
    writeHideBopRecipes(hide);
  }, []);

  const preferencesFor = useCallback((profession: string) => {
    return recipePreferences
      .filter((pair) => pair.profession === profession && pair.version === selectedVersion)
      .map(({ prefer, over }) => ({ prefer, over }));
  }, [recipePreferences, selectedVersion]);

  const swapInRecipe = useCallback((prefer: number, over: number) => {
    if (prefer === over) return;
    const next = recipePreferences.filter((pair) => !(
      pair.profession === selectedProfession &&
      pair.version === selectedVersion &&
      (pair.over === over || (pair.prefer === over && pair.over === prefer))
    ));
    next.push({ profession: selectedProfession, version: selectedVersion, prefer, over });
    const savedAt = Date.now();
    writeRecipePreferences(savedAt, next);
    setRecipePreferences(next);
    if (preferenceExpiryRef.current != null) window.clearTimeout(preferenceExpiryRef.current);
    preferenceExpiryRef.current = window.setTimeout(() => setRecipePreferences([]), RECIPE_PREFERENCE_MS);
  }, [recipePreferences, selectedProfession, selectedVersion]);

  const updateWorkingOvertime = useCallback((rank: number) => {
    const next = Math.min(5, Math.max(0, Math.round(rank)));
    setWorkingOvertime(next);
    writeWorkingOvertime(next);
  }, []);

  const updateMinSaleRate = useCallback((percent: number) => {
    const next = Math.min(100, Math.max(0, Math.round(percent)));
    setMinSaleRatePercent(next);
    writeMinSaleRatePercent(next);
  }, []);

  const updateCraftReagents = useCallback((enabled: boolean) => {
    setCraftReagents(enabled);
    writeCraftReagents(enabled);
  }, []);

  const updateExtraProfessions = useCallback((names: string[]) => {
    setExtraProfessions(names);
    writeExtraProfessions(names);
  }, []);

  const extraProfessionOptions = useMemo(
    () => ['Mining', ...availableProfessions.filter((profession) => profession !== selectedProfession)],
    [availableProfessions, selectedProfession]
  );

  const updateMinSkillChance = useCallback((percent: number) => {
    const next = Math.min(100, Math.max(0, Math.round(percent)));
    setMinSkillChancePercent(next);
    writeMinSkillChancePercent(next);
  }, []);

  const updateSuccessMargin = useCallback((percent: number) => {
    const next = normalizeSuccessMargin(percent);
    setSuccessMarginPercent(next);
    writeSuccessMarginPercent(next);
  }, []);

  const resetAdvancedSettings = useCallback(() => {
    setIncludeRecipeCost(true);
    setUseMarketValue(false);
    updateCraftReagents(false);
    updateExtraProfessions([]);
    setIncludeCurrencyRecipes(false);
    updateHideBopRecipes(true);
    updateWorkingOvertime(0);
    updateMinSkillChance(DEFAULT_MIN_SKILL_CHANCE_PERCENT);
    updateSuccessMargin(0);
    updateMinSaleRate(DEFAULT_MIN_SALE_RATE_PERCENT);
  }, [updateCraftReagents, updateExtraProfessions, updateHideBopRecipes, updateWorkingOvertime, updateMinSkillChance, updateSuccessMargin, updateMinSaleRate]);
  const [shouldBlur, setShouldBlur] = useState(false);
  const [isBlurComplete, setIsBlurComplete] = useState(true);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Add state for prices
  const [prices, setPrices] = useState<any>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const [pricesSettled, setPricesSettled] = useState(false);
  // TSM region sale rates used to skip slow sellers in auction-house mode
  const [regionSaleRate, setRegionSaleRate] = useState<Map<number, number> | null>(null);
  // Track the current price loading request to ignore outdated ones
  const priceLoadRequestIdRef = useRef(0);
  const advancedSettingsAnchorRef = useRef<HTMLDivElement>(null);
  const [advancedSettingsPosition, setAdvancedSettingsPosition] = useState<{ top: number; left: number } | null>(null);
  const [settingsWide, setSettingsWide] = useState(false);

  useEffect(() => {
    if (!isAdvancedSettingsOpen || typeof window === 'undefined') return;
    const updatePosition = () => {
      const el = advancedSettingsAnchorRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const panelWidth = settingsWide ? 649 : 320;
        const left = Math.max(12, Math.min(rect.right + 8, window.innerWidth - panelWidth - 12));
        setAdvancedSettingsPosition({ top: rect.top, left });
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isAdvancedSettingsOpen, settingsWide]);
  
  const lastSkillChange = useRef<number>(Date.now());
  const lastSkillValue = useRef<number>(skill);

  const [sliderValue, setSliderValue] = useState([committedSkill, committedTarget]);

  // When committedSkill/committedTarget change, update the sliderValue
  useEffect(() => {
    setSliderValue([committedSkill, committedTarget]);
  }, [committedSkill, committedTarget]);

  // Preload icon zips on mount and when profession changes (materials + current profession)
  useEffect(() => {
    preloadIconZips(['materials', selectedProfession.toLowerCase()]);
  }, [selectedProfession]);

  // A profession page with no skill span opens at the longest priced range.
  useEffect(() => {
    if (!urlSkill && !urlTarget) fitGuideRangeRef.current = selectedProfession;
    // Only the first visit. Later query changes are the visitor's own span.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle URL profession parameter changes (when URL changes after initial load)
  useEffect(() => {
    if (urlProfession) {
      const normalizedProfession = urlProfession.charAt(0).toUpperCase() + urlProfession.slice(1).toLowerCase();
      if (availableProfessions.includes(normalizedProfession)) {
        // Only update if it's different from current to prevent unnecessary updates
        if (normalizedProfession !== selectedProfession) {
          setSelectedProfession(normalizedProfession);
          setSkill(1);
          setCommittedSkill(1);
          lastSkillValue.current = 1;
          fitGuideRangeRef.current = normalizedProfession;
          recentUserChangeTimestampRef.current = Date.now();
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

  // Redirect away from Jewelcrafting outside The Burning Crusade
  useEffect(() => {
    if (selectedVersion !== 'The Burning Crusade' && selectedProfession === 'Jewelcrafting') {
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
        const timeSinceLastUserChange = Date.now() - recentUserChangeTimestampRef.current;
        const isRecentUserChange = timeSinceLastUserChange < 1000;
        if (!isRecentUserChange) {
          setSkill(skillLevel);
          setCommittedSkill(skillLevel);
          lastSkillValue.current = skillLevel;
        }
      }
    }
  }, [urlSkill]);

  // Handle URL target parameter - only sync when URL actually changes (not when we change state from buttons/slider)
  useEffect(() => {
    const previousMaxFromUrl = urlMaxSkillRef.current;
    if (urlTarget) {
      const targetLevel = parseInt(urlTarget);
      if (!isNaN(targetLevel) && targetLevel >= 1 && targetLevel <= maxSkill) {
        const isPreviousMaxSkillFromUrl = targetLevel === previousMaxFromUrl;
        const timeSinceLastUserChange = Date.now() - recentUserChangeTimestampRef.current;
        const isRecentUserChange = timeSinceLastUserChange < 1000;
        if (!isPreviousMaxSkillFromUrl && !isRecentUserChange) {
          setTarget(targetLevel);
          setCommittedTarget(targetLevel);
        }
      }
    }
    urlMaxSkillRef.current = maxSkill;
  }, [urlTarget, maxSkill]);

  // Handle URL version parameter
  useEffect(() => {
    if (urlVersion) {
      const parsed = parsePlannerVersion(urlVersion);
      if (parsed) {
        setSelectedVersion(parsed);
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
        writeCookieValue(FACTION_COOKIE, normalizedFaction);
        setSelectedFaction(normalizedFaction);
      }
    }
  }, [urlFaction]);

  // Helper function to build URL with all parameters
  const buildUrlWithParams = (profession: string, skill: number, target: number, version: string, realm: string, faction: string, price: PriceMode = priceSourcing) => {
    const params = new URLSearchParams();
    if (skill > 1) params.set('skill', skill.toString());
    const maxSkillForVersion = getMaxSkill(version);
    if (target < maxSkillForVersion) params.set('target', target.toString());
    if (version !== 'Forever') params.set('version', version);
    // Always include realm parameter
    params.set('realm', realm);
    // Always include faction parameter
    params.set('faction', faction);
    params.set('price', price);
    
    const queryString = params.toString();
    return `/${profession.toLowerCase()}${queryString ? `?${queryString}` : ''}`;
  };

  // Update URL when any selector changes
  const updateUrl = useCallback((overrides?: { realm?: string; faction?: string; version?: string; skill?: number; target?: number; price?: PriceMode }) => {
    const realm = overrides?.realm ?? selectedRealm;
    const faction = overrides?.faction ?? selectedFaction;
    const version = overrides?.version ?? selectedVersion;
    const skill = overrides?.skill ?? committedSkill;
    const target = overrides?.target ?? committedTarget;
    const price = overrides?.price ?? priceSourcing;
    const newUrl = buildUrlWithParams(selectedProfession, skill, target, version, realm, faction, price);
    router.push(newUrl, { scroll: false });
  }, [selectedProfession, committedSkill, committedTarget, selectedRealm, selectedFaction, selectedVersion, priceSourcing, router]);
  
  // Track recent user-initiated changes to prevent URL effects from overwriting them
  // We track the timestamp of any recent change, not the specific value
  const recentUserChangeTimestampRef = useRef<number>(0);
  // Track previous max skill to detect version changes
  const previousMaxSkillRef = useRef(getMaxSkill(selectedVersion));
  const previousVersionRef = useRef(selectedVersion);
  // Track the max skill that was in the URL before version change (for URL handler)
  const urlMaxSkillRef = useRef(getMaxSkill(selectedVersion));
  // Refs to access current values in useEffect without adding them as dependencies
  const committedSkillRef = useRef(committedSkill);
  const committedTargetRef = useRef(committedTarget);
  const skillRef = useRef(skill);
  const targetRef = useRef(target);
  const maxSkillRef = useRef(maxSkill);
  skillRef.current = skill;
  targetRef.current = target;
  maxSkillRef.current = maxSkill;

  // Debounce timers for skill inputs (1 second)
  const skillDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rngLowDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rngHighDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const COMMIT_DEBOUNCE_MS = 1000;

  const clearSkillDebounce = () => {
    if (skillDebounceRef.current) {
      clearTimeout(skillDebounceRef.current);
      skillDebounceRef.current = null;
    }
  };
  const clearTargetDebounce = () => {
    if (targetDebounceRef.current) {
      clearTimeout(targetDebounceRef.current);
      targetDebounceRef.current = null;
    }
  };
  const clearRngLowDebounce = () => {
    if (rngLowDebounceRef.current) {
      clearTimeout(rngLowDebounceRef.current);
      rngLowDebounceRef.current = null;
    }
  };
  const clearRngHighDebounce = () => {
    if (rngHighDebounceRef.current) {
      clearTimeout(rngHighDebounceRef.current);
      rngHighDebounceRef.current = null;
    }
  };

  useEffect(() => () => {
    clearSkillDebounce();
    clearTargetDebounce();
    clearRngLowDebounce();
    clearRngHighDebounce();
  }, []);

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
    
    // A new profession opens at its own longest priced range, not the span left on the previous one.
    setSkill(1);
    setCommittedSkill(1);
    lastSkillValue.current = 1;
    fitGuideRangeRef.current = newProfession;
    recentUserChangeTimestampRef.current = Date.now();
    const newUrl = buildUrlWithParams(newProfession, 1, getMaxSkill(selectedVersion), selectedVersion, selectedRealm, selectedFaction);
    router.push(newUrl, { scroll: false }); // Prevent scroll jump during navigation
    
    // Increment counter to trigger useMemo recalculation (but selectedProfession stays unchanged)
    setPendingProfessionCounter(c => c + 1);
  };

  // Handle version change - URL will be updated by the version change effect
  const handleVersionChange = (newVersion: string) => {
    const nextRealms = realmsForVersion(newVersion);
    const nextRealm = nextRealms.includes(selectedRealm) ? selectedRealm : defaultRealmForVersion(newVersion);
    setSelectedVersion(newVersion);
    if (nextRealm !== selectedRealm) {
      setSelectedRealm(nextRealm);
      writeCookieValue(REALM_COOKIE, nextRealm);
    }
  };

  // Handle realm change and update URL
  const handleRealmChange = (newRealm: string) => {
    // Track timestamp of user-initiated change
    recentUserChangeTimestampRef.current = Date.now();
    setSelectedRealm(newRealm);
    writeCookieValue(REALM_COOKIE, newRealm);
    updateUrl({ realm: newRealm });
  };

  // Handle faction change and update URL
  const handleFactionChange = (newFaction: string) => {
    // Track timestamp of user-initiated change
    recentUserChangeTimestampRef.current = Date.now();
    setSelectedFaction(newFaction);
    writeCookieValue(FACTION_COOKIE, newFaction);
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
      // Don't call updateUrl here - handleSliderEnd already did it when slider was released
    }
  }, [debouncedSkill, isReleased, isSliding, skill]);

  const handleSliderStart = () => {
    fitGuideRangeRef.current = null;
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

  const handleSliderEnd = (low = skillRef.current, high = targetRef.current) => {
    const nextSkill = Math.max(1, Math.min(low, maxSkillRef.current - 1));
    const nextTarget = Math.max(nextSkill + 1, Math.min(high, maxSkillRef.current));
    setIsReleased(true);
    setIsSliding(false);
    // Remove the delay: fade out blur immediately in parallel with content
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    setShouldBlur(false);
    blurTimeoutRef.current = null;
    setSkill(nextSkill);
    setTarget(nextTarget);
    setCommittedSkill(nextSkill);
    setCommittedTarget(nextTarget);
    lastSkillValue.current = nextSkill;
    setIsBlurComplete(true);
    recentUserChangeTimestampRef.current = Date.now();
    updateUrl({ skill: nextSkill, target: nextTarget });
  };

  const handleSliderChange = (value: number) => {
    setSkill(value);
    lastSkillChange.current = Date.now();
  };

  const handleDirectSkillChange = (newValue: number) => {
    fitGuideRangeRef.current = null;
    const maxCurrent = Math.max(1, target - 1);
    const boundedValue = Math.min(maxCurrent, Math.max(1, newValue));
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
    
    let nextTarget = targetRef.current;
    if (nextTarget <= boundedValue) {
      nextTarget = Math.min(maxSkillRef.current, boundedValue + 1);
      setTarget(nextTarget);
      setCommittedTarget(nextTarget);
    }
    
    recentUserChangeTimestampRef.current = Date.now();
    updateUrl({ skill: boundedValue, target: nextTarget });
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

  // Spell ids this character can craft: the open profession, plus any others they checked.
  const currentProfessionRecipeIds = useMemo(() => {
    const ids = new Set(recipes.map(r => r.id));
    if (!craftReagents) return ids;
    const versionRecipes = rawDataMap[selectedVersion] ?? {};
    for (const profession of extraProfessions) {
      if (profession === selectedProfession) continue;
      if (profession === 'Mining') {
        for (const info of Object.values(materialInfo)) {
          const created = info.createdBy;
          if (created?.spellId && created.spellName?.startsWith('Smelt')) ids.add(created.spellId);
        }
        continue;
      }
      for (const recipe of versionRecipes[profession] ?? []) {
        if (typeof recipe?.id === 'number') ids.add(recipe.id);
      }
    }
    return ids;
  }, [recipes, craftReagents, extraProfessions, selectedProfession, selectedVersion, materialInfo]);

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
    
    const newPlan = makeSegmentedPlan(
      committedSkill,
        committedTarget,
        recipes,
        prices,
        materialInfo,
      activeProfession,
        includeRecipeCost,
      skipLimitedStock,
      useMarketValue,
      false,
      optimizeSubCrafting,
      currentProfessionRecipeIds,
      priceSourcing,
      priceSourcing === 'auction-house' ? (regionSaleRate ?? undefined) : undefined,
      includeCurrencyRecipes,
      selectedFaction,
      minSaleRate,
      hideBopRecipeItems,
      workingOvertimeRank,
      minSkillUpChance,
      preferencesFor(activeProfession)
    );
    
    // Update preserved plan ref for next transition
    preservedPlanRef.current = newPlan;
    
    return newPlan;
  }, [committedSkill, committedTarget, recipes, prices, selectedProfession, includeRecipeCost, includeCurrencyRecipes, hideBopRecipeItems, workingOvertimeRank, selectedFaction, skipLimitedStock, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, regionSaleRate, minSaleRate, minSkillUpChance, isLoadingPrices, preferencesFor]);

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
      .filter(r => !blacklistedSpellIds.has(r.id) && !isTransmuteRecipe(r) && !isSeasonalRecipe(r) && isRecipeObtainable(r, materialInfo) && (includeCurrencyRecipes || !isCurrencyRecipe(r, materialInfo)) && !isWrongFactionRecipe(r, materialInfo, selectedFaction) && !(hideBopRecipeItems && isBopRecipeItem(r, materialInfo)))
      .sort((a, b) => getEffectiveMinSkill(a) - getEffectiveMinSkill(b)), 
    [recipes, materialInfo, includeCurrencyRecipes, hideBopRecipeItems, selectedFaction]
  );

  const recipeNetCost = useMemo(() => {
    const net = new Map<number, number>();
    if (view !== 'all') return net;
    for (const recipe of recipes) {
      net.set(recipe.id, calculateCraftCost(
        recipe,
        prices,
        materialInfo,
        false,
        false,
        useMarketValue,
        optimizeSubCrafting,
        currentProfessionRecipeIds,
        priceSourcing,
        selectedProfession,
      ));
    }
    return net;
  }, [view, recipes, prices, materialInfo, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession]);

  const filteredRecipes = useMemo(() => {
    if (view !== 'all') return [];
    const list = searchTerm
      ? fuse.search(searchTerm).map(result => result.item).filter(r => !blacklistedSpellIds.has(r.id) && !isTransmuteRecipe(r) && !isSeasonalRecipe(r) && isRecipeObtainable(r, materialInfo) && (includeCurrencyRecipes || !isCurrencyRecipe(r, materialInfo)) && !isWrongFactionRecipe(r, materialInfo, selectedFaction) && !(hideBopRecipeItems && isBopRecipeItem(r, materialInfo)))
      : sortedAll;
    const dir = recipeSort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (recipeSort.key === 'name') {
        return a.name.localeCompare(b.name) * dir || a.id - b.id;
      }
      if (recipeSort.key === 'skill') {
        return (getEffectiveMinSkill(a) - getEffectiveMinSkill(b)) * dir || a.name.localeCompare(b.name);
      }
      const aNet = recipeNetCost.get(a.id);
      const bNet = recipeNetCost.get(b.id);
      const aBad = aNet == null || !Number.isFinite(aNet);
      const bBad = bNet == null || !Number.isFinite(bNet);
      if (aBad || bBad) {
        if (aBad && bBad) return a.name.localeCompare(b.name);
        return aBad ? 1 : -1;
      }
      return (-aNet - -bNet) * dir || a.name.localeCompare(b.name);
    });
  }, [view, searchTerm, fuse, sortedAll, materialInfo, includeCurrencyRecipes, hideBopRecipeItems, selectedFaction, recipeSort, recipeNetCost]);
  
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

  const sliderMin = selected ? getEffectiveMinSkill(selected) : 1;
  const sliderMax = selected?.difficulty.gray     ?? maxSkill;

  const rngLowRef = useRef(rngLow);
  const rngHighRef = useRef(rngHigh);
  const sliderMinRef = useRef(sliderMin);
  const sliderMaxRef = useRef(sliderMax);
  rngLowRef.current = rngLow;
  rngHighRef.current = rngHigh;
  sliderMinRef.current = sliderMin;
  sliderMaxRef.current = sliderMax;

  const clampedLow  = Math.max(sliderMin, Math.min(rngLow,  sliderMax));
  const clampedHigh = Math.max(sliderMin, Math.min(rngHigh, sliderMax));

  const totalLevelUps = Math.max(0, clampedHigh - clampedLow);
  const avgSuccessRate = useMemo(() => {
    if (!selected || totalLevelUps <= 0) return 0;
    let sum = 0;
    for (let lvl = clampedLow; lvl < clampedHigh; lvl++) {
      sum += expectedSkillUps(selected, lvl, workingOvertimeRank);
    }
    return sum / totalLevelUps;
  }, [selected, clampedLow, clampedHigh, totalLevelUps, workingOvertimeRank]);

  useEffect(() => {
    if (selected && view === 'all') {
      const step = firstRecipeStep(selected);
      setRngLow(step.low);
      setRngHigh(step.high);
    }
  }, [selected, view]);

  const probData = useMemo(() => {
    if (!selected) return [];
    const start = getEffectiveMinSkill(selected);
    const end   = selected.difficulty.gray ?? start;
    const data  = [];
    for (let skill = start; skill <= end; skill++) {
      data.push({ skill, chance: expectedSkillUps(selected, skill, workingOvertimeRank) });
    }
    return data;
  }, [selected, workingOvertimeRank]);

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

    // Close mobile sidebar when selecting a step
    setSidebarOpen(false);
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
    return expectedCraftsBetween(
      clampedLow,
      clampedHigh,
      selected.difficulty,
      workingOvertimeRank,
      successMarginPercent,
    );
  }, [selected, clampedLow, clampedHigh, totalLevelUps, workingOvertimeRank, successMarginPercent]);

  useEffect(() => {
    if (!selected) {
      // If no recipe selected, update rngHigh to maxSkill when version changes
      setRngHigh(maxSkill);
      return;
    }
    const min = getEffectiveMinSkill(selected);
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
      if ((ENCHANTING_ROD_SPELL_IDS.has(selected.id) && ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(itemId)) ||
          (ENGINEERING_TOOL_SPELL_IDS.has(selected.id) && ENGINEERING_TOOL_PRODUCT_ITEM_IDS.has(itemId))) continue;
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

  const priceSourceName = priceSourcing === 'cost-vendor'
    ? 'Vendor value'
    : priceSourcing === 'disenchant'
      ? 'Disenchant value'
      : priceSourcing === 'auction-house'
        ? 'Auction House'
        : 'Raw material cost';

  const costAfterSource = useMemo(() => {
    if (!selected) return 0;
    const materialPerCraft = calculateCraftCost(selected, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, 'cost', selectedProfession);
    const recipeCost = includeRecipeCost && selected.source
      ? calculateCraftCost(selected, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession)
      : 0;
    const output = selected.produces;
    const outputQty = output?.quantity ?? 1;
    let perCraftReturn = 0;
    if (output && priceSourcing === 'cost-vendor') {
      perCraftReturn = (materialInfo[output.id]?.sellPrice ?? 0) * outputQty;
    } else if (output && priceSourcing === 'auction-house') {
      const entry = prices[output.id];
      const each = useMarketValue
        ? (entry?.marketValue ?? entry?.minBuyout ?? 0)
        : (entry?.minBuyout ?? entry?.marketValue ?? 0);
      perCraftReturn = each * outputQty;
    } else if (output && priceSourcing === 'disenchant') {
      const item = resolveDisenchantItem(output.id, materialInfo);
      const quality = selected.quality ?? materialInfo[output.id]?.quality ?? 1;
      const isWeapon = item.itemClass === '2';
      const outcomes = getDisenchantOutcomes(item.itemLevel, quality, isWeapon, item.itemClass, item.slot, output.id, materialInfo);
      if (outcomes.length > 0) {
        perCraftReturn = getExpectedDisenchantValue(item.itemLevel, quality, isWeapon, prices, materialInfo, useMarketValue, item.itemClass, item.slot, output.id) * outputQty;
      }
    }
    const spend = materialPerCraft * expCrafts + (Number.isFinite(recipeCost) ? recipeCost : 0);
    return spend - perCraftReturn * expCrafts;
  }, [selected, prices, materialInfo, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, includeRecipeCost, priceSourcing, selectedProfession, expCrafts]);

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
    ].filter((v): v is number => typeof v === 'number' && v > 0)))
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
    const pendingPlan = makeSegmentedPlan(
      committedSkill,
      committedTarget,
      pendingRecipes,
      prices,
      materialInfo,
      pendingProfession,
      includeRecipeCost,
      skipLimitedStock,
      useMarketValue,
      false,
      optimizeSubCrafting,
      currentProfessionRecipeIds,
      priceSourcing,
      priceSourcing === 'auction-house' ? (regionSaleRate ?? undefined) : undefined,
      includeCurrencyRecipes,
      selectedFaction,
      minSaleRate,
      hideBopRecipeItems,
      workingOvertimeRank,
      minSkillUpChance,
      preferencesFor(pendingProfession)
    );
    
    // Update preserved plan ref with the new plan BEFORE updating state
    // This ensures the plan useMemo uses the new plan when selectedProfession updates
    preservedPlanRef.current = pendingPlan;
    
    // Select first recipe of planner so recipe view shows it when user opens it; mobile sees planner first (sidebarOpen=true)
    const firstRecipeStep = pendingPlan.steps.find((s): s is Extract<typeof s, { recipe: Recipe }> => 'recipe' in s);
    const firstRecipe = firstRecipeStep?.recipe;
    const selectedRecipeIdToSet: number | null = firstRecipe?.id ?? null;
    const selectedCardKeyToSet: string | null = firstRecipe ? `${firstRecipe.name}-${firstRecipeStep.endSkill}` : null;
    
    if (firstRecipe) {
      preservedRecipeRef.current = firstRecipe;
      preservedRecipeProfessionRef.current = pendingProfession;
    } else {
      preservedRecipeRef.current = null;
      preservedRecipeProfessionRef.current = null;
    }
    
    // Everything is ready - batch update ALL state in one go
    // React 18+ automatically batches these updates, so this triggers only ONE re-render
    setSelectedRecipeId(selectedRecipeIdToSet);
    setSelectedCardKey(selectedCardKeyToSet);
    setVisibleCardKey(null);
    setSelectedProfession(pendingProfession);
    setSidebarOpen(true); // Show planner on mobile when switching profession
    
    // Update previous profession ref AFTER state update for animation detection
    // This will be used in the next render to detect profession change
    previousProfessionForAnimationRef.current = pendingProfession;
    
    // Clear pending profession ref and reset counter
    // The plan useMemo will use preservedPlanRef.current (which we just set) when it recalculates
    pendingProfessionRef.current = null;
    setPendingProfessionCounter(0);
  }, [isLoadingPrices, prices, committedSkill, committedTarget, selectedVersion, includeRecipeCost, includeCurrencyRecipes, hideBopRecipeItems, workingOvertimeRank, selectedFaction, skipLimitedStock, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, minSaleRate, minSkillUpChance, preferencesFor]);

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
  
  // Auto-select first recipe of planner when plan loads and no recipe is selected (initial load)
  useEffect(() => {
    // Skip if there's a pending profession change (it will handle selection)
    if (pendingProfessionRef.current) return;
    
    if (selectedRecipeId === null && plan.steps.length > 0 && plan.finalSkill >= committedTarget && Number.isFinite(plan.totalCost)) {
      const firstRecipeStep = plan.steps.find((s): s is Extract<typeof s, { recipe: Recipe }> => 'recipe' in s);
      const firstRecipe = firstRecipeStep?.recipe;
      if (firstRecipe) {
        setSelectedRecipeId(firstRecipe.id);
        setSelectedCardKey(`${firstRecipe.name}-${firstRecipeStep.endSkill}`);
        preservedRecipeRef.current = firstRecipe;
        preservedRecipeProfessionRef.current = selectedProfession;
      }
    }
  }, [selectedRecipeId, plan.steps, plan.finalSkill, plan.totalCost, committedTarget, selectedProfession]);

  // New selectors state and options
  const versions = ["Forever", "The Burning Crusade"];
  // realms and factions are defined earlier (around line 307) for use in initial state

  // Handle URL realm parameter
  useEffect(() => {
    if (urlRealm) {
      const normalizedRealm = realmFromUrl(selectedVersion, urlRealm);
      if (normalizedRealm) {
        // Only update if there hasn't been a recent user-initiated change
        const timeSinceLastUserChange = Date.now() - recentUserChangeTimestampRef.current;
        const isRecentUserChange = timeSinceLastUserChange < 1000; // 1 second window
        
        if (!isRecentUserChange) {
          writeCookieValue(REALM_COOKIE, normalizedRealm);
          if (normalizedRealm !== selectedRealm) setSelectedRealm(normalizedRealm);
        }
      }
    }
  }, [urlRealm, selectedRealm, selectedVersion]);

  // Handle URL faction parameter
  useEffect(() => {
    if (urlFaction) {
      const normalizedFaction = factions.find(f => f.toLowerCase() === urlFaction.toLowerCase());
      if (normalizedFaction && normalizedFaction !== selectedFaction) {
        // Only update if there hasn't been a recent user-initiated change
        const timeSinceLastUserChange = Date.now() - recentUserChangeTimestampRef.current;
        const isRecentUserChange = timeSinceLastUserChange < 1000; // 1 second window
        
        if (!isRecentUserChange) {
          writeCookieValue(FACTION_COOKIE, normalizedFaction);
          setSelectedFaction(normalizedFaction);
        }
      }
    }
  }, [urlFaction, selectedFaction, factions]);

  const urlPrice = searchParams.get('price');
  const priceChangeReady = useRef(false);
  useEffect(() => {
    const fromUrl = parsePriceMode(urlPrice);
    if (fromUrl) {
      const recent = Date.now() - recentUserChangeTimestampRef.current < 1000;
      if (!recent) {
        writeCookieValue(PRICE_SOURCE_COOKIE, fromUrl);
        if (fromUrl !== priceSourcing) setPriceSourcing(fromUrl);
      }
    }
  }, [urlPrice, priceSourcing]);

  useEffect(() => {
    if (!priceChangeReady.current) {
      priceChangeReady.current = true;
      return;
    }
    writeCookieValue(PRICE_SOURCE_COOKIE, priceSourcing);
    if (urlPrice === priceSourcing) return;
    const recent = Date.now() - recentUserChangeTimestampRef.current < 1000;
    if (recent) updateUrl({ price: priceSourcing });
  }, [priceSourcing]);

  // Load prices when realm or faction changes
  useEffect(() => {
    async function loadPrices() {
      // Increment request ID for this new request
      const requestId = ++priceLoadRequestIdRef.current;
      setIsLoadingPrices(true);
      setPricesSettled(false);
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
          setPricesSettled(true);
        }
      }
    }

    loadPrices();
  }, [selectedRealm, selectedFaction, selectedVersion]);

  // Load TSM sale rates when the realm or game version changes
  useEffect(() => {
    loadRegionData(selectedVersion, selectedRealm).then(setRegionSaleRate);
  }, [selectedRealm, selectedVersion]);

  // Reset skill and target when version changes to ensure they're within valid range
  useEffect(() => {
    const currentMaxSkill = getMaxSkill(selectedVersion);
    const previousMaxSkill = previousMaxSkillRef.current;
    
    const versionChanged = previousVersionRef.current !== selectedVersion;
    if (!versionChanged) {
      previousMaxSkillRef.current = currentMaxSkill;
      return;
    }
    previousVersionRef.current = selectedVersion;
    
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
      setSelectedRealm(defaultRealmForVersion(selectedVersion));
    }
  }, [selectedVersion, realms, selectedRealm]);

  const [showMaterials, setShowMaterials] = useState(false);

  // Desktop (landscape): smaller thumb hit area; mobile (portrait): larger for touch targets
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const updateLayout = () => setIsDesktop(window.innerWidth >= window.innerHeight);
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  // Optimize step candidates calculation to reduce expensive recalculations during sliding
  const stepCandidates = useMemo(() => {
    return plan.steps.map((s, i) => {
      if ('upgradeName' in s || 'gap' in s) return null;
      
      const start = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
      const end = s.endSkill;
      const best = s.recipe;
      
      const ranked = recipes
        .filter(r =>
          getEffectiveMinSkill(r) <= start &&
          (r.difficulty.gray ?? Infinity) >= end &&
          r.id !== best.id &&
          !blacklistedSpellIds.has(r.id) &&
          !isTransmuteRecipe(r) &&
          !isSkillCooldownRecipe(r) &&
          !isSeasonalRecipe(r) &&
          isRecipeObtainable(r, materialInfo) &&
          (includeCurrencyRecipes || !isCurrencyRecipe(r, materialInfo)) &&
          !isWrongFactionRecipe(r, materialInfo, selectedFaction) &&
          !(hideBopRecipeItems && isBopRecipeItem(r, materialInfo)) &&
          (!skipLimitedStock || !(
            r.source?.type === 'item' &&
            r.source.recipeItemId &&
            materialInfo[r.source.recipeItemId]?.limitedStock &&
            materialInfo[r.source.recipeItemId]?.bop
          )) &&
          // In auction-house mode, hide alternatives TSM says rarely sell
          !(priceSourcing === 'auction-house' && r.produces?.id && regionSaleRate && isBelowMinSaleRate(regionSaleRate.get(r.produces.id), minSaleRate)) &&
          (() => {
            const chance = expectedSkillUps(r, Math.max(start, end - 1), workingOvertimeRank);
            return chance > 0 && chance >= skillUpChanceFloor(priceSourcing, minSkillUpChance);
          })()
        )
        .map(r => {
          const expectedCrafts = expectedCraftsBetween(start, end, r.difficulty, workingOvertimeRank);
          const crafts = expectedCraftsBetween(start, end, r.difficulty, workingOvertimeRank, successMarginPercent);
          const baseCost = calculateCraftCost(r, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
          const recipeCost = includeRecipeCost && r.source ? calculateCraftCost(r, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) : 0;
          const cost = (baseCost * crafts) + recipeCost;
          return {
            recipe: r,
            crafts,
            cost,
            cpu: ((baseCost * expectedCrafts) + recipeCost) / (end - start),
          };
        })
        .sort((a, b) => a.cpu - b.cpu);
      const replacedId = preferencesFor(selectedProfession)
        .filter((pair) => pair.prefer === best.id)
        .at(-1)?.over;
      const replaced = replacedId == null ? undefined : ranked.find((candidate) => candidate.recipe.id === replacedId);
      const rest = ranked.filter((candidate) => candidate.recipe.id !== replaced?.recipe.id);
      const candidates = (replaced ? [replaced, ...rest] : rest).slice(0, 2);
      
      return { step: s, candidates, start, end, best };
    });
  }, [plan.steps, committedSkill, recipes, prices, materialInfo, includeRecipeCost, includeCurrencyRecipes, hideBopRecipeItems, workingOvertimeRank, selectedFaction, skipLimitedStock, blacklistedSpellIds, useMarketValue, currentProfessionRecipeIds, optimizeSubCrafting, priceSourcing, selectedProfession, regionSaleRate, minSaleRate, minSkillUpChance, successMarginPercent, preferencesFor]);

  // Calculate materials and total cost based on displayed craft counts (using start/end ranges)
  // instead of planner's batch-based craft counts
  const { displayedMaterialTotals, displayedTotalCost } = useMemo(() => {
    const materialTotals: Record<number, number> = {};
    const materialOrder: number[] = [];
    const purchasedRecipes = new Set<number>();
    let totalCost = 0;
    const addMaterial = (itemId: number, quantity: number) => {
      if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) return;
      if (materialTotals[itemId] == null) materialOrder.push(itemId);
      materialTotals[itemId] = (materialTotals[itemId] || 0) + quantity;
    };
    
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      if ('recipe' in s) {
        const start = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
        const end = s.endSkill;
        const displayedCrafts = expectedCraftsBetween(
          start,
          end,
          s.recipe.difficulty,
          workingOvertimeRank,
          successMarginPercent,
        );
        
        // Calculate cost for this step based on displayed crafts
        const materialCostPerCraft = calculateCraftCost(s.recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
        const displayedMaterialCost = materialCostPerCraft * displayedCrafts;
        const recipeSeenEarlier = plan.steps.slice(0, i).some(prev => 'recipe' in prev && prev.recipe.id === s.recipe.id);
        const displayedRecipeCost = includeRecipeCost && s.recipe.source && !recipeSeenEarlier ?
          calculateCraftCost(s.recipe, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession) : 0;
        totalCost += displayedMaterialCost + displayedRecipeCost;

        // Calculate materials needed (exclude rod products for rod recipes - made in previous step)
        for (const [itemId, quantity] of Object.entries(s.recipe.materials)) {
          const numItemId = Number(itemId);
          if ((ENCHANTING_ROD_SPELL_IDS.has(s.recipe.id) && ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(numItemId)) ||
              (ENGINEERING_TOOL_SPELL_IDS.has(s.recipe.id) && ENGINEERING_TOOL_PRODUCT_ITEM_IDS.has(numItemId))) continue;
          if (optimizeSubCrafting) {
            const tree = buildMaterialTree(numItemId, quantity * displayedCrafts, prices, materialInfo, false, new Set(), useMarketValue, true, currentProfessionRecipeIds);
            for (const leaf of purchasedLeaves(tree)) addMaterial(leaf.id, leaf.quantity);
          } else {
            addMaterial(numItemId, quantity * displayedCrafts);
          }
        }
        const recipeItemId = s.recipe.source?.type === 'item' ? s.recipe.source.recipeItemId : undefined;
        if (recipeItemId && !purchasedRecipes.has(recipeItemId)) {
          purchasedRecipes.add(recipeItemId);
          const purchase = recipePurchase(s.recipe);
          if (purchase) addMaterial(purchase.itemId, purchase.quantity);
        }
      } else if ('upgradeName' in s) {
        totalCost += s.cost;
      }
    }
    
    return {
      displayedMaterialTotals: materialOrder.map((id) => {
        const source = materialBuySource(id, prices, materialInfo, useMarketValue);
        return {
          itemId: id,
          quantity: materialTotals[id],
          name: materialInfo[id]?.name || `Item ${id}`,
          icon: materialInfo[id]?.icon,
          quality: materialInfo[id]?.quality ?? 1,
          source: source ?? undefined,
          copper: materialUnitCost(id, prices, materialInfo, useMarketValue),
        };
      }),
      displayedTotalCost: totalCost
    };
  }, [plan.steps, committedSkill, materialInfo, prices, includeRecipeCost, useMarketValue, currentProfessionRecipeIds, optimizeSubCrafting, priceSourcing, selectedProfession, workingOvertimeRank, successMarginPercent]);

  const pricesReady = !isLoadingPrices && pricesSettled;
  const [guideSkillLimit, setGuideSkillLimit] = useState<number | null>(null);
  const [guideLimitTip, setGuideLimitTip] = useState<{ top: number; left: number; center: boolean; kind: 'materials' | SkillGapReason; skill: number } | null>(null);

  // Highest target the priced recipes can actually reach from the current skill.
  useEffect(() => {
    if (!pricesReady || Object.keys(prices).length === 0 || recipes.length === 0) {
      setGuideSkillLimit(null);
      return;
    }
    let cancelled = false;
    const start = committedSkill;
    const cap = maxSkill;
    const activeProfession = selectedProfession;

    const reaches = (target: number) => {
      const planned = makeDynamicPlan(
        start,
        target,
        recipes,
        prices,
        materialInfo,
        activeProfession,
        includeRecipeCost,
        skipLimitedStock,
        useMarketValue,
        false,
        optimizeSubCrafting,
        currentProfessionRecipeIds,
        priceSourcing,
        priceSourcing === 'auction-house' ? (regionSaleRate ?? undefined) : undefined,
        includeCurrencyRecipes,
        selectedFaction,
        minSaleRate,
        hideBopRecipeItems,
        workingOvertimeRank,
        minSkillUpChance,
        preferencesFor(activeProfession)
      );
      return planned.steps.some((step) => 'recipe' in step) && planned.finalSkill >= target && Number.isFinite(planned.totalCost);
    };

    const generation = ++guideSearchGenRef.current;
    const search = async () => {
      let low = start;
      let high = cap;
      while (low < high) {
        if (cancelled) return;
        const mid = Math.ceil((low + high) / 2);
        if (reaches(mid)) low = mid;
        else high = mid - 1;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (!cancelled) {
        guideLimitGenRef.current = generation;
        setGuideSkillLimit(low);
      }
    };

    setGuideSkillLimit(null);
    void search();
    return () => {
      cancelled = true;
    };
  }, [pricesReady, prices, recipes, materialInfo, committedSkill, maxSkill, selectedProfession, includeRecipeCost, includeCurrencyRecipes, hideBopRecipeItems, workingOvertimeRank, selectedFaction, skipLimitedStock, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, regionSaleRate, minSaleRate, minSkillUpChance, preferencesFor]);

  // Open a profession at 1 → the furthest skill that still has a priced guide.
  useEffect(() => {
    if (guideSkillLimit == null || guideSkillLimit <= 1) return;
    if (fitGuideRangeRef.current !== selectedProfession) return;
    if (guideLimitGenRef.current !== guideSearchGenRef.current) return;
    if (committedSkill !== 1) return;
    fitGuideRangeRef.current = null;
    if (committedTarget === guideSkillLimit) return;
    recentUserChangeTimestampRef.current = Date.now();
    setTarget(guideSkillLimit);
    setCommittedTarget(guideSkillLimit);
    router.push(
      buildUrlWithParams(selectedProfession, 1, guideSkillLimit, selectedVersion, selectedRealm, selectedFaction),
      { scroll: false }
    );
  }, [guideSkillLimit, selectedProfession, committedSkill, committedTarget, selectedVersion, selectedRealm, selectedFaction, router]);

  const routeIsFinite = !pricesReady || plan.steps.length > 0;

  useEffect(() => {
    if (view === 'route' && pricesReady && !routeIsFinite) {
      setSelectedRecipeId(null);
      setSelectedCardKey(null);
    }
  }, [view, pricesReady, routeIsFinite]);

  const guideSteps = useMemo(() => {
    const money = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    const guideMaterials = (recipe: Recipe) => {
      const materials: GuideStep['materials'] = [];
      for (const [itemId, quantity] of Object.entries(recipe.materials)) {
        const id = Number(itemId);
        if (!Number.isFinite(id) || !Number.isFinite(quantity) || quantity <= 0) continue;
        if ((ENCHANTING_ROD_SPELL_IDS.has(recipe.id) && ENCHANTING_ROD_PRODUCT_ITEM_IDS.has(id)) ||
            (ENGINEERING_TOOL_SPELL_IDS.has(recipe.id) && ENGINEERING_TOOL_PRODUCT_ITEM_IDS.has(id))) continue;
        materials.push({
          id,
          name: materialInfo[id]?.name || `Item ${id}`,
          icon: materialInfo[id]?.icon || '',
          each: quantity,
        });
      }
      return materials;
    };
    const outputPrice = (itemId: number) => {
      const priceData = prices[itemId];
      return useMarketValue
        ? (priceData?.marketValue ?? priceData?.minBuyout ?? 0)
        : (priceData?.minBuyout ?? priceData?.marketValue ?? 0);
    };
    const guideReturns = (recipe: Recipe): GuideStep['returns'] => {
      const outputId = recipe.produces?.id;
      if (!outputId) return undefined;
      const outputQty = recipe.produces?.quantity ?? 1;
      const sellEach = (materialInfo[outputId]?.sellPrice ?? 0) * outputQty;
      if (priceSourcing === 'cost-vendor') {
        if (selectedProfession === 'Enchanting' || sellEach <= 0) return undefined;
        return { kind: 'vendor', copper: money(sellEach) };
      }
      if (priceSourcing === 'auction-house') {
        const total = outputPrice(outputId) * outputQty;
        if (total <= 0) return undefined;
        return { kind: 'auction', copper: money(total) };
      }
      if (priceSourcing !== 'disenchant' || selectedProfession === 'Enchanting') return undefined;
      const disenchantItem = resolveDisenchantItem(outputId, materialInfo);
      const quality = recipe.quality ?? materialInfo[outputId]?.quality ?? 1;
      const outcomes = getDisenchantOutcomes(
        disenchantItem.itemLevel,
        quality,
        disenchantItem.itemClass === '2',
        disenchantItem.itemClass,
        disenchantItem.slot,
        outputId,
        materialInfo,
      );
      if (outcomes.length === 0) {
        if (sellEach <= 0) return undefined;
        return { kind: 'vendor', copper: money(sellEach) };
      }
      const items = outcomes.flatMap((outcome) => {
        const expected = outcome.chance * ((outcome.minQty + outcome.maxQty) / 2) * outputQty;
        if (!Number.isFinite(expected) || expected <= 0) return [];
        const unit = disenchantMaterialValue(outcome.itemId, prices, useMarketValue);
        return [{
          id: outcome.itemId,
          name: materialInfo[outcome.itemId]?.name || `Item ${outcome.itemId}`,
          icon: materialInfo[outcome.itemId]?.icon || '',
          quality: materialInfo[outcome.itemId]?.quality ?? 1,
          each: Math.round(expected * 100) / 100,
          copper: money(expected * unit),
        }];
      });
      if (items.length === 0) return undefined;
      return { kind: 'disenchant', copper: items.reduce((sum, item) => sum + item.copper, 0), items };
    };
    const guideOption = (recipe: Recipe, start: number, end: number) => {
      const optionCrafts = expectedCraftsBetween(
        start,
        end,
        recipe.difficulty,
        workingOvertimeRank,
        successMarginPercent,
      );
      const eachCost = calculateCraftCost(recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
      const eachSpend = calculateCraftCost(recipe, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, 'cost', selectedProfession);
      const recipeCost = includeRecipeCost && recipe.source
        ? calculateCraftCost(recipe, prices, materialInfo, true, true, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession)
        : 0;
      const source = recipe.source;
      let sourceKind = '';
      let sourceName = '';
      let sourceIcon = '';
      let sourceQuality = 1;
      if (source?.type === 'free') {
        sourceKind = 'free';
        sourceName = 'Free';
        sourceIcon = 'inv_misc_note_01';
      } else if (source?.type === 'trainer') {
        sourceKind = 'trainer';
        const trainer = source.trainers?.find((entry) => entry.name)?.name;
        sourceName = trainer ? `Trainer: ${trainer}` : 'Trainer';
        sourceIcon = 'inv_misc_book_09';
      } else if (source?.type === 'item') {
        sourceKind = 'item';
        const recipeItem = source.recipeItemId ? materialInfo[source.recipeItemId] : undefined;
        sourceName = source.recipeItemName || recipeItem?.name || 'Recipe';
        sourceIcon = recipeItem?.icon || 'inv_scroll_03';
        sourceQuality = typeof recipeItem?.quality === 'number' ? recipeItem.quality : 1;
      }
      return {
        name: recipe.name,
        icon: recipe.icon || '',
        crafts: Number.isFinite(optionCrafts) ? optionCrafts : 0,
        yellow: recipe.difficulty.yellow ?? 0,
        gray: recipe.difficulty.gray ?? end,
        green: recipe.difficulty.green ?? 0,
        quality: typeof recipe.quality === 'number' ? recipe.quality : 1,
        spell: recipe.id,
        eachCost: money(eachCost),
        eachSpend: Number.isFinite(eachSpend) ? Math.max(0, Math.round(eachSpend)) : 0,
        recipeCost: money(recipeCost),
        bop: isBopMobDropRecipe(recipe, materialInfo),
        source: sourceKind,
        sourceName,
        sourceIcon,
        sourceQuality,
        returns: guideReturns(recipe),
        materials: guideMaterials(recipe),
      };
    };
    const steps: GuideStep[] = [];
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!('recipe' in step)) continue;
      const start = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
      const end = step.endSkill;
      const option = guideOption(step.recipe, start, end);
      const purchase = recipePurchase(step.recipe);
      const recipeItemInfo = purchase ? materialInfo[purchase.itemId] : undefined;
      const recipeItemName = recipeItemInfo?.name
        || (purchase && step.recipe.source?.type === 'item' && purchase.itemId === step.recipe.source.recipeItemId
          ? step.recipe.source.recipeItemName
          : '');
      const alts = (stepCandidates[i]?.candidates ?? [])
        .filter((alt) => alt.recipe.id !== step.recipe.id)
        .slice(0, 2)
        .map((alt) => guideOption(alt.recipe, start, end));
      steps.push({
        ...option,
        from: start,
        to: end,
        alts,
        recipeItem: purchase && recipeItemName
          ? { id: purchase.itemId, name: recipeItemName, icon: recipeItemInfo?.icon || '', quantity: purchase.quantity }
          : undefined,
      });
    }
    return steps;
  }, [plan.steps, committedSkill, materialInfo, stepCandidates, prices, includeRecipeCost, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession, workingOvertimeRank, successMarginPercent]);

  const EDGE_DRAWER_FRACTION = 0.15;
  const handleDrawerDragStart = useCallback((clientX: number) => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 0;
    const startX = sidebarOpen ? 0 : -width;
    drawerDragStartRef.current = { x: clientX, startOpen: sidebarOpen };
    drawerDragXRef.current = startX;
    setDrawerDragX(startX);
  }, [sidebarOpen]);
  const handleDrawerDragMove = useCallback((clientX: number) => {
    const start = drawerDragStartRef.current;
    if (!start || typeof window === 'undefined') return;
    const delta = clientX - start.x;
    const width = window.innerWidth;
    let newX: number;
    if (start.startOpen) {
      newX = Math.min(0, delta);
    } else {
      newX = Math.max(-width, Math.min(0, -width + delta));
    }
    drawerDragXRef.current = newX;
    setDrawerDragX(newX);
  }, []);
  const handleDrawerDragEnd = useCallback(() => {
    const start = drawerDragStartRef.current;
    if (!start || typeof window === 'undefined') return;
    const width = window.innerWidth;
    const threshold = width * 0.25;
    const currentX = drawerDragXRef.current;
    setDrawerDragX(null);
    drawerDragStartRef.current = null;
    if (start.startOpen) {
      setSidebarOpen(currentX > -threshold);
    } else {
      setSidebarOpen(currentX > -width + threshold);
    }
  }, []);

  const drawerTouchHandlers = useMemo(() => ({
    onTouchStart: (e: React.TouchEvent) => {
      const x = e.touches[0].clientX;
      const edgePx = typeof window !== 'undefined' ? window.innerWidth * EDGE_DRAWER_FRACTION : 0;
      if (x <= edgePx) {
        handleDrawerDragStart(x);
        const moveHandler = (ev: TouchEvent) => {
          if (drawerDragStartRef.current && ev.touches.length > 0) handleDrawerDragMove(ev.touches[0].clientX);
        };
        const cleanup = () => {
          document.removeEventListener('touchmove', moveHandler);
          document.removeEventListener('touchend', cleanup);
          document.removeEventListener('touchcancel', cleanup);
          if (drawerDragStartRef.current) handleDrawerDragEnd();
        };
        document.addEventListener('touchmove', moveHandler, { passive: true });
        document.addEventListener('touchend', cleanup);
        document.addEventListener('touchcancel', cleanup);
      }
    },
  }), [handleDrawerDragStart, handleDrawerDragMove, handleDrawerDragEnd]);

  const drawerRightEdgeTouchHandlers = useMemo(() => ({
    onTouchStart: (e: React.TouchEvent) => {
      const x = e.touches[0].clientX;
      const rightEdge = typeof window !== 'undefined' ? window.innerWidth * (1 - EDGE_DRAWER_FRACTION) : 0;
      if (x >= rightEdge) {
        handleDrawerDragStart(x);
        const moveHandler = (ev: TouchEvent) => {
          if (drawerDragStartRef.current && ev.touches.length > 0) handleDrawerDragMove(ev.touches[0].clientX);
        };
        const cleanup = () => {
          document.removeEventListener('touchmove', moveHandler);
          document.removeEventListener('touchend', cleanup);
          document.removeEventListener('touchcancel', cleanup);
          if (drawerDragStartRef.current) handleDrawerDragEnd();
        };
        document.addEventListener('touchmove', moveHandler, { passive: true });
        document.addEventListener('touchend', cleanup);
        document.addEventListener('touchcancel', cleanup);
      }
    },
  }), [handleDrawerDragStart, handleDrawerDragMove, handleDrawerDragEnd]);

  const drawerPointerHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const x = e.clientX;
      const edgePx = typeof window !== 'undefined' ? window.innerWidth * EDGE_DRAWER_FRACTION : 0;
      if (x <= edgePx) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        handleDrawerDragStart(x);
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (drawerDragStartRef.current) handleDrawerDragMove(e.clientX);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (drawerDragStartRef.current) {
        handleDrawerDragEnd();
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      }
    },
  }), [handleDrawerDragStart, handleDrawerDragMove, handleDrawerDragEnd]);

  const drawerRightEdgePointerHandlers = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const x = e.clientX;
      const rightEdge = typeof window !== 'undefined' ? window.innerWidth * (1 - EDGE_DRAWER_FRACTION) : 0;
      if (x >= rightEdge) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        handleDrawerDragStart(x);
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (drawerDragStartRef.current) handleDrawerDragMove(e.clientX);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (drawerDragStartRef.current) {
        handleDrawerDragEnd();
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      }
    },
  }), [handleDrawerDragStart, handleDrawerDragMove, handleDrawerDragEnd]);

  const settingsMenu = (
                <div className="relative" ref={advancedSettingsAnchorRef}>
                  <button
                    type="button"
                    onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
                    aria-expanded={isAdvancedSettingsOpen}
                    className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border font-semibold transition-colors duration-150 ${compactHeader ? 'px-2 py-1 text-[11px]' : 'gap-1.5 rounded-lg px-3 py-1.5 text-xs'} ${advancedButtonClass(selectedVersion, isAdvancedSettingsOpen)}`}
                  >
                    <span>Advanced Settings</span>
                    <svg
                      className={`h-4 w-4 shrink-0 transition-transform duration-150 ${isAdvancedSettingsOpen ? 'rotate-180' : ''}`}
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
                  </button>
                  
                  <AnimatePresence>
                    {isAdvancedSettingsOpen && (
                      <>
                        {/* Mobile: inline positioning */}
                        <motion.div
                          initial={{ opacity: 0, x: -10, scaleX: 0.95 }}
                          animate={{ opacity: 1, x: 0, scaleX: 1 }}
                          exit={{ opacity: 0, x: -10, scaleX: 0.95 }}
                          transition={{ duration: 0.2 }}
                          className={`desktop-layout:hidden absolute right-0 top-0 w-max max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-white/10 bg-neutral-900 shadow-xl z-[100] origin-left`}
                        >
                        <div className="p-3 space-y-3">
                          <div className="flex items-center justify-between mb-1 desktop-layout:mb-0 desktop-layout:hidden">
                            <span className="text-xs font-medium text-neutral-300">Advanced Settings</span>
                            <button
                              onClick={() => setIsAdvancedSettingsOpen(false)}
                              className="p-1.5 -mr-1 -mt-1 text-neutral-400 hover:text-white rounded transition-colors"
                              aria-label="Close"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <AdvancedSettingsControls
                            accentOn={selectedVersion === 'Forever'}
                            accent={saleRateAccent}
                            includeRecipeCost={includeRecipeCost}
                            onIncludeRecipeCost={setIncludeRecipeCost}
                            useMarketValue={useMarketValue}
                            onUseMarketValue={setUseMarketValue}
                            craftReagents={craftReagents}
                            onCraftReagents={updateCraftReagents}
                            extraProfessions={extraProfessions}
                            extraProfessionOptions={extraProfessionOptions}
                            onExtraProfessions={updateExtraProfessions}
                            includeCurrencyRecipes={includeCurrencyRecipes}
                            onIncludeCurrencyRecipes={setIncludeCurrencyRecipes}
                            hideBopRecipeItems={hideBopRecipeItems}
                            onHideBopRecipeItems={updateHideBopRecipes}
                            workingOvertime={workingOvertime}
                            onWorkingOvertime={updateWorkingOvertime}
                            minSaleRatePercent={minSaleRatePercent}
                            onMinSaleRate={updateMinSaleRate}
                            minSkillChancePercent={minSkillChancePercent}
                            onMinSkillChance={updateMinSkillChance}
                            successMarginPercent={successMarginPercent}
                            onSuccessMargin={updateSuccessMargin}
                            onWideChange={setSettingsWide}
                            onReset={resetAdvancedSettings}
                          />
                        </div>
                      </motion.div>
                        {/* Desktop: portal to body so it's always on top */}
                        {typeof document !== 'undefined' && advancedSettingsPosition && createPortal(
                          (
                            <motion.div
                              initial={{ opacity: 0, x: -10, scaleX: 0.95 }}
                              animate={{ opacity: 1, x: 0, scaleX: 1 }}
                              exit={{ opacity: 0, x: -10, scaleX: 0.95 }}
                              transition={{ duration: 0.2 }}
                              className="hidden desktop-layout:block fixed w-max max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-white/10 bg-neutral-900 shadow-xl z-[9999] origin-left"
                              style={{ top: advancedSettingsPosition.top, left: advancedSettingsPosition.left }}
                            >
                              <div className="p-3 space-y-3">
                                <div className="flex items-center justify-between mb-1 desktop-layout:mb-0 desktop-layout:hidden">
                                  <span className="text-xs font-medium text-neutral-300">Advanced Settings</span>
                                  <button
                                    onClick={() => setIsAdvancedSettingsOpen(false)}
                                    className="p-1.5 -mr-1 -mt-1 text-neutral-400 hover:text-white rounded transition-colors"
                                    aria-label="Close"
                                  >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                                <AdvancedSettingsControls
                                  accentOn={selectedVersion === 'Forever'}
                                  accent={saleRateAccent}
                                  includeRecipeCost={includeRecipeCost}
                                  onIncludeRecipeCost={setIncludeRecipeCost}
                                  useMarketValue={useMarketValue}
                                  onUseMarketValue={setUseMarketValue}
                            craftReagents={craftReagents}
                            onCraftReagents={updateCraftReagents}
                            extraProfessions={extraProfessions}
                            extraProfessionOptions={extraProfessionOptions}
                            onExtraProfessions={updateExtraProfessions}
                                  includeCurrencyRecipes={includeCurrencyRecipes}
                                  onIncludeCurrencyRecipes={setIncludeCurrencyRecipes}
                                  hideBopRecipeItems={hideBopRecipeItems}
                                  onHideBopRecipeItems={updateHideBopRecipes}
                                  workingOvertime={workingOvertime}
                                  onWorkingOvertime={updateWorkingOvertime}
                                  minSaleRatePercent={minSaleRatePercent}
                                  onMinSaleRate={updateMinSaleRate}
                                  minSkillChancePercent={minSkillChancePercent}
                                  onMinSkillChance={updateMinSkillChance}
                                  successMarginPercent={successMarginPercent}
                                  onSuccessMargin={updateSuccessMargin}
                                  onWideChange={setSettingsWide}
                                  onReset={resetAdvancedSettings}
                                />
                              </div>
                            </motion.div>
                          ),
                          document.body
                        )}
                      </>
                    )}
                  </AnimatePresence>
                </div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent text-neutral-100">

      {/* Auction House Disclaimer Modal - first-time only */}
      <AnimatePresence>
        {showAuctionHouseDisclaimer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80"
            onClick={() => setShowAuctionHouseDisclaimer(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="max-w-md w-full bg-neutral-900 rounded-xl shadow-2xl border-2 border-amber-500/50 p-6 desktop-layout:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">⚠️</span>
                <h2 className="text-xl desktop-layout:text-2xl font-bold text-amber-400">Important Notice</h2>
              </div>
              <p className="text-neutral-300 text-sm desktop-layout:text-base leading-relaxed mb-2">
                <strong className="text-white">Auction House mode</strong> uses listing prices to estimate profit—we do <strong className="text-amber-400">not</strong> know actual sale prices.
              </p>
              <p className="text-neutral-300 text-sm desktop-layout:text-base leading-relaxed mb-4">
                Prices can be <strong className="text-amber-400">highly volatile</strong>. Items may not sell at listed prices, or may take longer to sell than expected. Use this mode for rough estimates only.
              </p>
              <p className="text-neutral-400 text-xs desktop-layout:text-sm mb-6">
                Click outside to cancel. By clicking &quot;I Understand&quot;, you acknowledge these limitations.
              </p>
              <button
                onClick={acknowledgeAuctionHouseDisclaimer}
                className="w-full py-4 px-6 text-lg font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-900 transition-colors duration-200 shadow-lg hover:shadow-amber-500/50"
              >
                I Understand
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile: floating menu button when sidebar is closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="desktop-layout:hidden absolute top-3 left-3 z-[100] p-2 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-colors shadow-lg border border-neutral-700"
          aria-label="Open planner"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Mobile: left-edge drag strip to open drawer when closed */}
      <div
        className="desktop-layout:hidden absolute left-0 top-0 bottom-0 touch-none"
        style={{ zIndex: 45, width: `${EDGE_DRAWER_FRACTION * 100}%` }}
        {...drawerTouchHandlers}
        {...drawerPointerHandlers}
      />

      {/* Panels */}
      <div className="flex flex-1 min-h-0 relative desktop-layout:pt-0">
        {/* Mobile backdrop - closes sidebar when tapped */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="desktop-layout:hidden absolute inset-0 z-40 bg-black/60"
              onClick={() => setSidebarOpen(false)}
              aria-hidden
            />
          )}
        </AnimatePresence>

        {/* Aside - full-screen on mobile, sidebar on desktop */}
        <aside
          className={`absolute desktop-layout:static inset-0 z-50 desktop-layout:z-auto w-full desktop-layout:w-150 flex flex-col border-r border-white/[0.06] bg-neutral-950/95 text-[16px] shadow-[8px_0_40px_rgba(0,0,0,0.35)] backdrop-blur-sm desktop-layout:transform-none desktop-layout:translate-x-0 ${drawerDragX !== null ? '' : 'transition-transform duration-300 ease-out'} ${drawerDragX === null ? (sidebarOpen ? 'translate-x-0' : '-translate-x-full') : ''}`}
          style={drawerDragX !== null ? { transform: `translateX(${drawerDragX}px)` } : undefined}
        >
          {/* Mobile: drag handle on left edge of drawer to close by dragging left */}
          <div
            className="desktop-layout:hidden absolute left-0 top-0 bottom-0 w-6 touch-none z-10"
            style={{ width: `${EDGE_DRAWER_FRACTION * 100}%` }}
            {...drawerTouchHandlers}
            {...drawerPointerHandlers}
          />
          {/* Mobile: drag handle on right edge of drawer to close by dragging left (show recipe view) */}
          <div
            className="desktop-layout:hidden absolute right-0 top-0 bottom-0 w-6 touch-none z-10"
            style={{ width: `${EDGE_DRAWER_FRACTION * 100}%` }}
            {...drawerRightEdgeTouchHandlers}
            {...drawerRightEdgePointerHandlers}
          />
          {/* Slider + Tabs */}
          <div className={`flex-none border-b border-[#e3b056]/15 bg-neutral-900/80 px-3 ${compactHeader ? 'pt-2 pb-1' : 'pt-4 pb-2 desktop-layout:pt-5'}`}>
            {compactHeader ? (
              <PlannerCommandBar
                version={selectedVersion}
                versions={versions}
                onVersion={handleVersionChange}
                realm={selectedRealm}
                realms={realms}
                onRealm={handleRealmChange}
                faction={selectedFaction}
                factions={factions}
                onFaction={handleFactionChange}
                profession={selectedProfession}
                professions={availableProfessions}
                onProfession={handleProfessionChange}
                chartOpen={costChartOpen}
                onToggleChart={() => setCostChartOpen((open) => !open)}
                skill={skill}
                target={target}
                maxSkill={maxSkill}
                committedSkill={committedSkill}
                committedTarget={committedTarget}
                guideSkillLimit={guideSkillLimit}
                steps={plan.steps}
                isDesktop={isDesktop}
                onSliderStart={handleSliderStart}
                onRangeChange={(low, high) => { handleSliderChange(low); setTarget(high); }}
                onRangeCommit={(low, high) => handleSliderEnd(low, high)}
                onSkillCommit={handleDirectSkillChange}
                onTargetCommit={(value) => {
                  fitGuideRangeRef.current = null;
                  clearTargetDebounce();
                  const boundedTarget = Math.max(skillRef.current + 1, Math.min(maxSkillRef.current, value));
                  setTarget(boundedTarget);
                  setCommittedTarget(boundedTarget);
                  recentUserChangeTimestampRef.current = Date.now();
                  updateUrl({ target: boundedTarget });
                }}
                priceMode={priceSourcing}
                onPriceMode={(mode) => {
                  if (mode === 'auction-house') handleAuctionHouseClick();
                  else {
                    recentUserChangeTimestampRef.current = Date.now();
                    setPriceSourcing(mode);
                  }
                }}
                minSaleRatePercent={minSaleRatePercent}
                view={view}
                onView={setView}
                settings={settingsMenu}
                onClassic={() => setCompactHeader(false)}
                guideTip={guideLimitTip}
                onGuideTip={setGuideLimitTip}
                onGuideTipLeave={() => setGuideLimitTip(null)}
                minSkillUpChance={minSkillUpChance}
              />
            ) : (
            <>
            <Link href="/" className={`${compactHeader ? 'hidden' : 'mb-3 flex'} items-baseline justify-between gap-3`}>
              <span className={`${compactHeader ? 'text-sm' : 'text-lg'} font-semibold tracking-tight text-white`}>
                <span className="text-[#e3b056]">WoW</span>Craft
              </span>
              <span className={`truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500 ${compactHeader ? 'hidden' : ''}`}>{selectedProfession}</span>
            </Link>
            <div className={compactHeader ? 'mb-2 flex flex-col gap-1.5' : ''}>
            <div className={`flex flex-row gap-1.5 desktop-layout:gap-2 ${compactHeader ? 'order-2' : 'mb-2 desktop-layout:mb-4'}`}>
              {/* Version Selector */}
              <Listbox value={selectedVersion} onChange={handleVersionChange}>
                {({ open }) => (
                  <div className="relative flex-1 min-w-0 desktop-layout:w-1/3">
                    <Listbox.Button className={`w-full rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-1.5 desktop-layout:px-3 desktop-layout:py-1.5 text-xs desktop-layout:text-sm flex items-center justify-between gap-1 transition-colors duration-150 min-w-0 ${versionRingClass(selectedVersion)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                      <span className={`font-semibold truncate ${versionTextClass(selectedVersion)}`}>{selectedVersion === 'The Burning Crusade' ? 'TBC' : selectedVersion}</span>
                      <svg className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-30 mt-1 w-full min-w-[11.5rem] overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {versions.map((ver) => (
                        <Listbox.Option key={ver} value={ver} className={({ active }) => `relative cursor-pointer select-none py-2 pl-3 pr-3 ${active ? 'bg-neutral-700' : ''}`}>
                          {({ selected }) => (
                            <span className={`block truncate font-semibold ${versionTextClass(ver)} ${selected ? '' : 'opacity-80'}`}>{ver}</span>
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
                  <div className="relative flex-1 min-w-0 desktop-layout:w-1/3">
                    <Listbox.Button className={`w-full rounded-lg border border-white/10 bg-neutral-800/80 text-white px-2 py-1.5 desktop-layout:px-3 desktop-layout:py-1.5 text-xs desktop-layout:text-sm flex items-center justify-between gap-1 transition-colors duration-150 min-w-0 ${realmRingClass(selectedRealm)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                      <span className="font-semibold truncate"><RealmName realm={selectedRealm} /></span>
                      <svg className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-30 mt-1 w-full min-w-[11.5rem] max-h-80 overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {realms.map((realm) => (
                        <Listbox.Option key={realm} value={realm} className={({ active }) => `relative cursor-pointer select-none py-2 pl-3 pr-3 ${active ? 'bg-neutral-700 text-white' : 'text-neutral-300'}`}>
                          {({ selected }) => (
                            <span className={`block truncate font-semibold ${selected && !foreverRealmKind(realm) ? 'text-white' : ''}`}><RealmName realm={realm} /></span>
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
                  <div className="relative flex-1 min-w-0 desktop-layout:w-1/3">
                    <Listbox.Button className={`w-full rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-1.5 desktop-layout:px-3 desktop-layout:py-1.5 text-xs desktop-layout:text-sm flex items-center justify-between gap-1 transition-colors duration-150 min-w-0 ${factionRingClass(selectedFaction)} ${open ? 'bg-neutral-700' : 'hover:bg-neutral-700/70'}`}>
                      <span className={`flex items-center gap-1 min-w-0 font-semibold ${factionTextClass(selectedFaction)}`}>
                        <FactionIcon faction={selectedFaction} className="h-5 w-5 shrink-0" />
                        <span className="truncate">{selectedFaction}</span>
                      </span>
                      <svg className={`h-4 w-4 text-neutral-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </Listbox.Button>
                    <Listbox.Options className="absolute z-30 mt-1 w-full min-w-[8.5rem] overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                      {factions.map((fac) => (
                        <Listbox.Option key={fac} value={fac} className={({ active }) => `relative cursor-pointer select-none py-2 pl-3 pr-3 ${active ? 'bg-neutral-700' : ''}`}>
                          {({ selected }) => (
                            <span className={`flex items-center gap-2 truncate font-semibold ${factionTextClass(fac)} ${selected ? '' : 'opacity-80'}`}>
                              <FactionIcon faction={fac} className="h-5 w-5 shrink-0" />
                              {fac}
                            </span>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
            <div className={`flex w-full items-stretch gap-2 ${compactHeader ? 'order-1' : 'mb-3 desktop-layout:mb-5'}`}>
              {compactHeader && (
                <Link href="/" className="flex shrink-0 items-center px-0.5 text-sm font-semibold tracking-tight text-white" aria-label="WoWCraft home">
                  <span className="text-[#e3b056]">WoW</span>
                </Link>
              )}
              <div className="min-w-0 flex-1">
                <Listbox value={selectedProfession} onChange={handleProfessionChange}>
                  {({ open }) => (
                    <div className="relative w-full">
                      <Listbox.Button className={`flex w-full items-center justify-between rounded-lg border border-white/10 bg-neutral-800/80 px-2 text-white transition-colors duration-150 ${compactHeader ? 'py-1 text-sm' : 'py-1.5 text-base desktop-layout:px-3 desktop-layout:py-1.5 desktop-layout:text-lg'} ${open ? 'bg-neutral-700' : 'hover:border-[#e3b056]/35 hover:bg-neutral-700/70'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <img src={`/icons/${selectedProfession.toLowerCase()}.webp`} alt="" className={`flex-shrink-0 ${compactHeader ? 'h-6 w-6' : 'h-8 w-8 desktop-layout:h-10 desktop-layout:w-10'}`} />
                          <span className="font-semibold truncate">{selectedProfession}</span>
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
                      <Listbox.Options className="absolute z-40 mt-1 w-full overflow-auto rounded-md bg-neutral-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none text-lg">
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
              <button
                type="button"
                onClick={() => setCostChartOpen((open) => !open)}
                aria-expanded={costChartOpen}
                aria-label="Level-up cost history"
                className={`flex shrink-0 items-center justify-center self-center rounded-lg border transition-colors duration-150 ${compactHeader ? 'size-9' : 'size-[46px] desktop-layout:size-[54px]'} ${
                  costChartOpen
                    ? 'border-yellow-300 bg-yellow-400/25 text-yellow-100'
                    : 'border-yellow-400/50 bg-yellow-400/15 text-yellow-200 hover:border-yellow-300 hover:bg-yellow-400/25'
                }`}
              >
                <svg className="h-6 w-6" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 15.5l4.2-4.6 3 2.4L17 4.5" />
                  <path strokeLinecap="round" strokeWidth={1.75} d="M3 17h14" />
                </svg>
              </button>
            </div>
            </div>
            <div className={compactHeader ? 'mb-2 grid grid-cols-[6.75rem_minmax(0,1fr)_6.75rem] items-center gap-x-2 gap-y-1.5' : 'mb-4'}>
              <div className={`${compactHeader ? 'col-span-3 row-start-1 justify-end' : 'mb-6 justify-between'} flex items-center gap-2`}>
                <label className={`text-xs ${compactHeader ? 'sr-only' : ''}`}>
                  Skill Range <span className={`font-semibold ${versionTextClass(selectedVersion)}`}>{skill}</span> → <span className={`font-semibold ${versionTextClass(selectedVersion)}`}>{target}</span>
                </label>
                <button
                  type="button"
                  onClick={() => setCompactHeader((on) => !on)}
                  className="shrink-0 rounded-lg border border-white/10 bg-neutral-800/80 px-2 py-1 text-[11px] font-semibold text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                >
                  {compactHeader ? 'Classic' : 'Compact'}
                </button>
                {settingsMenu}
              </div>
              
              {/* Double-sided range slider */}
              <div className={`relative z-20 w-full desktop-layout:px-0 ${compactHeader ? 'col-start-2 row-start-2 px-1' : 'mb-4 px-3'}`}>
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
                    handleSliderEnd(low, high);
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
                            colors: ['#4b5563', selectedVersion === 'The Burning Crusade' ? '#10b981' : selectedVersion === 'Forever' ? '#1fb5f7' : '#eab308', '#4b5563'],
                            min: 1,
                            max: maxSkill
                          }),
                          pointerEvents: 'auto'
                        }}
                        onMouseDown={handleSliderStart}
                        onTouchStart={handleSliderStart}
                      >
                        {(() => {
                          const segments: { from: number; to: number; kind: 'materials' | SkillGapReason }[] = [];
                          let cursor = committedSkill;
                          for (const step of plan.steps) {
                            if ('gap' in step && step.endSkill > cursor) {
                              segments.push({ from: cursor, to: step.endSkill, kind: step.gap });
                            }
                            cursor = step.endSkill;
                          }
                          if (guideSkillLimit != null && guideSkillLimit >= committedTarget && guideSkillLimit < maxSkill) {
                            segments.push({ from: guideSkillLimit, to: maxSkill, kind: 'materials' });
                          }
                          if (segments.length === 0) return null;
                          const span = maxSkill - 1;
                          return segments.map((segment) => (
                            <div
                              key={`${segment.kind}-${segment.from}`}
                              className="absolute bottom-[-14px] top-[-14px] z-[1] cursor-help"
                              style={{
                                left: `${((segment.from - 1) / span) * 100}%`,
                                width: `${((segment.to - segment.from) / span) * 100}%`,
                              }}
                              onMouseEnter={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                const width = 224;
                                const gap = 12;
                                const fitsRight = rect.right + gap + width < window.innerWidth;
                                setGuideLimitTip(fitsRight
                                  ? { top: rect.top + rect.height / 2, left: rect.right + gap, center: true, kind: segment.kind, skill: segment.from }
                                  : { top: rect.bottom + gap, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), center: false, kind: segment.kind, skill: segment.from });
                              }}
                              onMouseLeave={() => setGuideLimitTip(null)}
                            >
                              <div
                                className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2"
                                style={{
                                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.72) 0 5px, rgba(255,255,255,0.14) 5px 8px)',
                                }}
                              />
                            </div>
                          ));
                        })()}
                        {children}
                      </div>
                    );
                  }}
                  renderThumb={({ props, index }) => {
                    const { key, style, ...rest } = props;
                    const thumbColor = selectedVersion === 'The Burning Crusade' 
                      ? '#059669'
                      : selectedVersion === 'Forever'
                        ? (index === 0 ? '#0273ae' : '#1fb5f7')
                        : (index === 0 ? '#eab308' : '#f59e0b');
                    const thumbSize = compactHeader ? (isDesktop ? 16 : 28) : (isDesktop ? 20 : 44);
                    return (
                      <div
                        key={key}
                        {...rest}
                        style={{
                          ...style,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: thumbSize,
                          height: thumbSize,
                          pointerEvents: 'auto',
                          zIndex: 2
                        }}
                        className="touch-manipulation"
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: thumbColor,
                            boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                            pointerEvents: 'none'
                          }}
                        />
                      </div>
                    );
                  }}
                />
                {guideLimitTip && typeof document !== 'undefined' && createPortal(
                  <div
                    role="tooltip"
                    className={`pointer-events-none fixed z-[100] w-56 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-neutral-200 shadow-lg ${guideLimitTip.center ? '-translate-y-1/2' : ''}`}
                    style={{ top: guideLimitTip.top, left: guideLimitTip.left }}
                  >
                    {guideLimitTip.kind === 'sale-rate'
                      ? `Skill ${guideLimitTip.skill} through here has no craft at a ${minSaleRatePercent}% sale rate. Everything that raises skill in this stretch sells less often than that.`
                      : guideLimitTip.kind === 'skill-chance'
                      ? `Skill ${guideLimitTip.skill} through here has no craft with at least a ${Math.round(skillUpChanceFloor(priceSourcing, minSkillUpChance) * 100)}% chance to skill up.`
                      : guideLimitTip.kind === 'no-recipe'
                      ? `No recipe raises skill through this stretch, starting at ${guideLimitTip.skill}.`
                      : guideLimitTip.kind === 'bop'
                      ? `Skill ${guideLimitTip.skill} through here only has crafts learned from Bind on Pickup recipe items.`
                      : guideLimitTip.kind === 'unpriced'
                      ? `No priced craft continues from skill ${guideLimitTip.skill}. The auction data does not cover this stretch.`
                      : selectedVersion === 'Forever'
                      ? `Not recommended past skill ${guideLimitTip.skill}. Most players are still below level 30, so higher-level materials are not on the auction house yet and a route through this stretch cannot be priced.`
                      : `Not recommended past skill ${guideLimitTip.skill}. The auction prices do not cover a complete route through this stretch.`}
                  </div>,
                  document.body
                )}
              </div>

              {/* Skill inputs */}
              <div className={compactHeader ? 'contents' : 'flex items-center space-x-2'}>
                {/* Current skill input */}
                <div className={`flex flex-col items-center bg-neutral-900 ${compactHeader ? 'col-start-1 row-start-2 min-w-0' : 'flex-1'}`}>
                  <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                    <button
                      className={`rounded bg-neutral-800 text-white transition hover:bg-neutral-500 ${compactHeader ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-lg'}`}
                      onClick={() => handleDirectSkillChange(skill - 1)}
                    >−</button>
                    
                    <input
                      type="number"
                      aria-label="Current skill"
                      min={1}
                      max={target - 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          setSkill(val);
                          clearSkillDebounce();
                          skillDebounceRef.current = setTimeout(() => {
                            skillDebounceRef.current = null;
                            handleDirectSkillChange(skillRef.current);
                          }, COMMIT_DEBOUNCE_MS);
                        }
                      }}
                      onBlur={() => {
                        clearSkillDebounce();
                        handleDirectSkillChange(skill);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          clearSkillDebounce();
                          e.currentTarget.blur();
                        }
                      }}
                      className={`w-12 appearance-none bg-transparent text-center outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${compactHeader ? 'text-sm' : 'text-lg'} ${versionTextClass(selectedVersion)}`}
                    />
                    
                    <button
                      className={`rounded bg-neutral-800 text-white transition hover:bg-neutral-500 ${compactHeader ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-lg'}`}
                      onClick={() => handleDirectSkillChange(skill + 1)}
                    >+</button>
                  </div>
                </div>

                {/* Target skill input */}
                <div className={`flex flex-col items-center bg-neutral-900 ${compactHeader ? 'col-start-3 row-start-2 min-w-0' : 'flex-1'}`}>
                  <div className="flex items-center justify-between w-full bg-neutral-700 rounded">
                    <button
                      className={`rounded bg-neutral-800 text-white transition hover:bg-neutral-500 ${compactHeader ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-lg'}`}
                      onClick={() => {
                        fitGuideRangeRef.current = null;
                        const newTarget = Math.max(skill + 1, target - 1);
                        setTarget(newTarget);
                        setCommittedTarget(newTarget);
                        recentUserChangeTimestampRef.current = Date.now();
                        updateUrl({ target: newTarget });
                      }}
                    >−</button>
                    
                    <input
                      type="number"
                      aria-label="Target skill"
                      min={skill + 1}
                      max={maxSkill}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          fitGuideRangeRef.current = null;
                          setTarget(val);
                          clearTargetDebounce();
                          targetDebounceRef.current = setTimeout(() => {
                            targetDebounceRef.current = null;
                            const boundedTarget = Math.max(skillRef.current + 1, Math.min(maxSkillRef.current, targetRef.current));
                            setTarget(boundedTarget);
                            setCommittedTarget(boundedTarget);
                            recentUserChangeTimestampRef.current = Date.now();
                            updateUrl({ target: boundedTarget });
                          }, COMMIT_DEBOUNCE_MS);
                        }
                      }}
                      onBlur={() => {
                        clearTargetDebounce();
                        const boundedTarget = Math.max(skill + 1, Math.min(maxSkill, target));
                        setTarget(boundedTarget);
                        setCommittedTarget(boundedTarget);
                        recentUserChangeTimestampRef.current = Date.now();
                        updateUrl({ target: boundedTarget });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          clearTargetDebounce();
                          e.currentTarget.blur();
                        }
                      }}
                      className={`w-12 appearance-none bg-transparent text-center outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${compactHeader ? 'text-sm' : 'text-lg'} ${versionTextClass(selectedVersion)}`}
                    />
                    
                    <button
                      className={`rounded bg-neutral-800 text-white transition hover:bg-neutral-500 ${compactHeader ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-lg'}`}
                      onClick={() => {
                        fitGuideRangeRef.current = null;
                        const newTarget = Math.min(maxSkill, target + 1);
                        setTarget(newTarget);
                        setCommittedTarget(newTarget);
                        recentUserChangeTimestampRef.current = Date.now();
                        updateUrl({ target: newTarget });
                      }}
                    >+</button>
                  </div>
                </div>
              </div>
            </div>
            <div className={compactHeader ? 'mb-1.5' : 'mb-4'}>
              {/* Price Sourcing Selector */}
              <div className={`mb-1 flex items-center justify-between desktop-layout:mb-2 ${compactHeader ? 'hidden' : ''}`}>
                <label className="text-[10px] desktop-layout:text-xs text-neutral-400 font-medium">Price Sourcing Strategy</label>
              </div>
              <div className="flex gap-0.5 desktop-layout:gap-1 flex-wrap">
                <button
                  onClick={() => { recentUserChangeTimestampRef.current = Date.now(); setPriceSourcing('cost'); }}
                  className={`px-1 py-0.5 desktop-layout:px-2 desktop-layout:py-1 text-[10px] desktop-layout:text-xs rounded transition-all duration-200 border relative group flex-1 min-w-0 ${
                    priceSourcing === 'cost'
                      ? `${versionSelectedClass(selectedVersion)} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Raw material cost"
                >
                  <span className="font-medium">Cost</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Raw material cost
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
                <button
                  onClick={() => { recentUserChangeTimestampRef.current = Date.now(); setPriceSourcing('cost-vendor'); }}
                  className={`px-1 py-0.5 desktop-layout:px-2 desktop-layout:py-1 text-[10px] desktop-layout:text-xs rounded transition-all duration-200 border relative group flex-1 min-w-0 ${
                    priceSourcing === 'cost-vendor'
                      ? `${versionSelectedClass(selectedVersion)} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Subtract vendor value"
                >
                  <span className="font-medium">Vendor</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Subtract vendor value
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
                <button
                  onClick={() => { recentUserChangeTimestampRef.current = Date.now(); setPriceSourcing('disenchant'); }}
                  className={`px-1 py-0.5 desktop-layout:px-2 desktop-layout:py-1 text-[10px] desktop-layout:text-xs rounded transition-all duration-200 border relative group flex-1 min-w-0 ${
                    priceSourcing === 'disenchant'
                      ? `${versionSelectedClass(selectedVersion)} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title="Subtract disenchant value"
                >
                  <span className="font-medium">Disenchanting</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    Subtract disenchant value
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
                <button
                  onClick={handleAuctionHouseClick}
                  className={`px-1 py-0.5 desktop-layout:px-2 desktop-layout:py-1 text-[10px] desktop-layout:text-xs rounded transition-all duration-200 border relative group flex-1 min-w-0 ${
                    priceSourcing === 'auction-house'
                      ? `${versionSelectedClass(selectedVersion)} text-neutral-900 font-semibold shadow-sm`
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border-neutral-700 hover:border-neutral-600'
                  }`}
                  title={`Skips items below a ${minSaleRatePercent}% sale rate`}
                >
                  <span className="font-medium">Auction House</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
                    {`Skips items below a ${minSaleRatePercent}% sale rate`}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                </button>
              </div>
            </div>
            <div className={compactHeader ? 'mb-1 flex flex-row-reverse items-center justify-between gap-3 border-b border-white/[0.06]' : 'contents'}>
            <div className={`flex items-center ${compactHeader ? 'justify-end gap-3 py-1 text-xs' : 'gap-2 border-b border-neutral-800 py-2'}`}>
              <Link
                href="/faq"
                className={compactHeader
                  ? 'font-medium text-neutral-400 transition-colors hover:text-white'
                  : 'flex-1 rounded bg-neutral-800 px-3 py-2 text-center text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white desktop-layout:text-base'}
              >
                FAQ
              </Link>
              <Link
                href="/promo"
                className={compactHeader
                  ? 'font-medium text-neutral-400 transition-colors hover:text-white'
                  : 'flex-1 rounded bg-neutral-800 px-3 py-2 text-center text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white desktop-layout:text-base'}
              >
                About
              </Link>
              <a
                href="https://discord.com/invite/KE4kEEyTJh"
                target="_blank"
                rel="noopener noreferrer"
                className={compactHeader
                  ? 'inline-flex items-center gap-1 font-medium text-[#c9cdf8] transition-colors hover:text-white'
                  : 'flex flex-1 items-center justify-center gap-1.5 rounded border border-[#3d4278] bg-[#2a2d52] px-3 py-2 text-sm font-medium text-[#c9cdf8] transition-colors hover:bg-[#343868] hover:text-white desktop-layout:text-base'}
              >
                <svg viewBox="0 0 24 24" className={`${compactHeader ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0`} fill="currentColor" aria-hidden="true">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                Discord
              </a>
            </div>
            <div className={`relative font-medium tracking-wide text-neutral-400 ${compactHeader ? 'flex justify-start gap-4' : 'mb-2 hidden justify-center space-x-8 border-b border-white/[0.06] desktop-layout:flex'}`}>
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setView(tab)}
                  className={`relative ${compactHeader ? 'pb-1' : 'pb-2'} ${
                    view === tab ? 'text-white' : 'hover:text-neutral-200'
                  }`}
                >
                  {tab === 'route' ? 'Leveling Guide' : 'All Recipes'}
                  {view === tab && (
                    <motion.div
                      layoutId="tab-underline"
                      className={`absolute bottom-0 left-0 right-0 h-0.5 ${versionBarClass(selectedVersion)}`}
                    />
                  )}
                </button>
              ))}
            </div>
            </div>
            </>
            )}
            <LevelUpCostChart
              open={costChartOpen}
              onClose={() => setCostChartOpen(false)}
              version={selectedVersion}
              profession={selectedProfession}
              professions={availableProfessions}
              realm={selectedRealm}
              realms={realms}
              faction={selectedFaction}
              factions={factions}
              stroke={selectedVersion === 'The Burning Crusade' ? '#10b981' : selectedVersion === 'Forever' ? '#1fb5f7' : '#facc15'}
            />
            {!(view === 'route' && !routeIsFinite) && <div className="flex items-center gap-1 px-2 py-0.5 w-full h-6 desktop-layout:h-8 text-neutral-400 border-b border-white/[0.06] font-medium text-[12px] desktop-layout:text-sm">
              <span className="w-5 desktop-layout:w-8 text-center shrink-0">#</span>
              <span className="w-5 desktop-layout:w-7 shrink-0" /> {/* icon space */}
              {view === 'all' ? (
                <>
                  {([
                    ['name', 'Recipe', 'flex-1 min-w-0 text-left'],
                    ['profit', 'Profit', 'w-[6.75rem] desktop-layout:w-[8rem] text-center shrink-0'],
                    ['skill', 'Skill', 'w-[4.75rem] desktop-layout:w-[5.75rem] text-center shrink-0'],
                  ] as const).map(([key, label, width]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRecipeSort((current) => current.key === key
                        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
                        : { key, dir: key === 'profit' ? 'desc' : 'asc' })}
                      className={`${width} inline-flex items-center gap-1 hover:text-white ${key === 'name' ? 'justify-start' : 'justify-center'} ${recipeSort.key === key ? 'text-white' : ''}`}
                      aria-sort={recipeSort.key === key ? (recipeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      {label}
                      {recipeSort.key === key && <span aria-hidden="true">{recipeSort.dir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0">Recipe</span>
                  <span className="w-[6.75rem] desktop-layout:w-[8rem] text-center shrink-0">Cost</span>
                  <span className="w-[4.75rem] desktop-layout:w-[5.75rem] text-center shrink-0">Skill</span>
                </>
              )}
            </div>}
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 flex flex-col min-h-0">
            <section 
              ref={scrollRef}
              onScroll={() => { if (saleRateTip) setSaleRateTip(null); if (swapTip) setSwapTip(null); }}
              className={`flex-1 overflow-y-scroll ${view === 'route' ? 'pb-[55px]' : 'pb-8'}
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
                will-change-scroll-position`}
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
                    {view === 'route' && !routeIsFinite ? (
                      <div className="m-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-sm leading-relaxed text-amber-100">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">No finite route</p>
                        <p className="mt-2">
                          <RealmName realm={selectedRealm} /> {selectedFaction} does not have auction prices for a complete {selectedProfession} route from {committedSkill} to {committedTarget}. The leveling guide stays hidden until this combination can be priced.
                        </p>
                      </div>
                    ) : view === 'route' ? (
                      <div className="flex flex-col">
                        {plan.steps.map((s, i) => {
                          if ('gap' in s) {
                            const gapStart = i === 0 ? committedSkill : plan.steps[i - 1].endSkill;
                            return (
                              <div
                                key={`gap-${s.gap}-${s.endSkill}-${committedSkill}`}
                                className="relative flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-2 py-2 w-full min-h-[43px] desktop-layout:min-h-[60px]"
                              >
                                <span className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" />
                                <span className="flex min-w-0 flex-1 flex-col justify-center pl-2">
                                  <span className="text-[13px] desktop-layout:text-[16px] font-medium text-amber-100">No crafts in this stretch</span>
                                  <span className="text-[11px] desktop-layout:text-[13px] leading-snug text-amber-100/80">{s.note}</span>
                                </span>
                                <SkillBox className="min-w-[4.75rem] desktop-layout:min-w-[5.75rem] text-amber-100">
                                  <span>{gapStart} → {s.endSkill}</span>
                                </SkillBox>
                              </div>
                            );
                          }
                          if ('upgradeName' in s) {
                            return (
                              <div
                                key={`upgrade-${s.upgradeName}-${s.skill}-${committedSkill}`}
                                className="relative flex items-center gap-1 border-b border-white/[0.04] bg-[#e3b056]/10 px-2 py-2 w-full min-h-[43px] desktop-layout:min-h-[60px]"
                              >
                                <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#e3b056]" />
                                <span aria-hidden="true" className="flex w-6 shrink-0 items-center justify-center text-[18px] leading-none text-[#e3b056] desktop-layout:w-8 desktop-layout:text-[22px]">★</span>
                                <span className="flex min-w-0 flex-1 items-center gap-1">
                                  <img src={`/icons/${selectedProfession.toLowerCase()}.webp`} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-white/15 desktop-layout:h-7 desktop-layout:w-7" />
                                  <span className="truncate text-[13px] font-medium desktop-layout:text-[16px]">
                                    <span className="text-neutral-100">Train </span>
                                    <span className="text-[#e3b056]">{s.upgradeName}</span>
                                  </span>
                                </span>
                                <span className="shrink-0">
                                  <CostBox copper={s.cost} trim className="min-w-[6.75rem] desktop-layout:min-w-[8rem] text-[12px] desktop-layout:text-[15px]" />
                                </span>
                                <SkillBox className={`min-w-[4.75rem] desktop-layout:min-w-[5.75rem] ${versionTextClass(selectedVersion)}`}>{s.skill}</SkillBox>
                              </div>
                            );
                          }

                          const stepData = stepCandidates[i];
                          if (!stepData) return null;
                          
                          const { candidates, start, end, best } = stepData;
                          
                          // Calculate crafts needed for the displayed range (start to end)
                          // This ensures consistency with the Level-up Calculator
                          const displayedCrafts = expectedCraftsBetween(
                            start,
                            end,
                            best.difficulty,
                            workingOvertimeRank,
                            successMarginPercent,
                          );
                          
                          // Recalculate cost based on displayed crafts instead of planner's s.crafts
                          const materialCostPerCraft = calculateCraftCost(best, prices, materialInfo, false, false, useMarketValue, optimizeSubCrafting, currentProfessionRecipeIds, priceSourcing, selectedProfession);
                          const displayedMaterialCost = materialCostPerCraft * displayedCrafts;
                          const recipeSeenEarlier = plan.steps.slice(0, i).some(prev => 'recipe' in prev && prev.recipe.id === best.id);
                          const displayedRecipeCost = includeRecipeCost && best.source && !recipeSeenEarlier ?
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
                                  className={`relative flex items-center gap-1 border-b border-white/[0.04] px-2 py-1 w-full min-h-[43px] desktop-layout:min-h-[60px] cursor-pointer
                                    transition-colors duration-100 ease-out will-change-transform active:scale-[0.99]
                                    ${isSelected(best.name, end)
                                      ? 'bg-neutral-600 hover:bg-neutral-600 active:bg-neutral-500'
                                      : 'bg-neutral-900 hover:bg-neutral-700 active:bg-neutral-600'}`}
                                >
                                  <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                                    diffColor(committedSkill, best.difficulty)
                                  }`} />
                                  <span className="text-[13px] desktop-layout:text-[16px] flex items-center justify-center w-6 desktop-layout:w-8">
                                    {displayedCrafts}×
                                  </span>
                                  <span className="flex min-w-0 flex-1 items-center gap-1">
                                    <CachedIcon category={getRecipeProfession(best.id, selectedProfession)} id={best.id} className="w-6 h-6 desktop-layout:w-7 desktop-layout:h-7 rounded-md object-cover ring-1 ring-white/15" />
                                    <span className="flex min-w-0 flex-1 flex-col justify-center">
                                    <span
                                        className="truncate whitespace-nowrap text-[13px] desktop-layout:text-[16px]"
                                      style={{ color: qualityColors[s.recipe.quality] }}
                                    >
                                      {best.name.length <= 35 ? best.name : `${best.name.slice(0, 33)}…`}
                                    </span>
                                      <RecipeSourceMark recipe={best} materialInfo={materialInfo} />
                                  </span>
                                  </span>
                                  <span className="shrink-0">
                                    <CostBox copper={displayedTotalCost} className="min-w-[6.75rem] desktop-layout:min-w-[8rem] text-[12px] desktop-layout:text-[15px]" />
                                  </span>
                                  <SkillBox className={`min-w-[4.75rem] desktop-layout:min-w-[5.75rem] ${versionTextClass(selectedVersion)}`}>
                                    <span>{start} → {end}</span>
                                  </SkillBox>
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
                                      <div key={`alt-${alt.recipe.name}-${end}-${committedSkill}`} className="flex w-full items-stretch">
                                      <button
                                        type="button"
                                        aria-label={`Swap in ${alt.recipe.name}`}
                                        className="flex w-1/12 shrink-0 items-center justify-center text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSwapTip(null);
                                          swapInRecipe(alt.recipe.id, best.id);
                                        }}
                                        onMouseEnter={(event) => {
                                          const rect = event.currentTarget.getBoundingClientRect();
                                          setSwapTip({
                                            text: `Use ${alt.recipe.name} instead of ${best.name}.`,
                                            top: rect.top + rect.height / 2,
                                            left: Math.min(rect.right + 8, window.innerWidth - 248),
                                          });
                                        }}
                                        onMouseLeave={() => setSwapTip(null)}
                                      >
                                        <svg className="h-5 w-5 desktop-layout:h-6 desktop-layout:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-2.64-6.36" />
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 3v6h-6" />
                                        </svg>
                                      </button>
                                      <motion.div
                                        initial={shouldAnimate(best.name, end) ? { opacity: 0, y: -5 } : { opacity: 1, y: 0 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        transition={{ 
                                          duration: 0.3,
                                          ease: "easeOut"
                                        }}
                                        onClick={() => handleCardClick(alt.recipe.name, end, start, end, true, alt.recipe.id)}
                                        className={`relative flex min-w-0 flex-1 items-center gap-1 rounded-none border-b border-white/[0.04] pl-2 pr-2 py-0.5 cursor-pointer min-h-[43px] desktop-layout:min-h-[60px] 
                                          transition-colors duration-100 ease-out will-change-transform active:scale-[0.99]
                                          ${isSelected(alt.recipe.name, end)
                                            ? 'bg-neutral-600 hover:bg-neutral-600 active:bg-neutral-500'
                                            : 'bg-neutral-900 hover:bg-neutral-700 active:bg-neutral-600'}`}
                                      >
                                        <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                                          diffColor(committedSkill, alt.recipe.difficulty)
                                        }`} />
                                        <SkillBox className="text-neutral-300">
                                          or {alt.crafts}×
                                        </SkillBox>
                                        <span className="flex min-w-0 flex-1 items-center gap-1 pl-1">
                                          <CachedIcon
                                            category={getRecipeProfession(alt.recipe.id, selectedProfession)}
                                            id={alt.recipe.id}
                                            className="w-6 h-6 desktop-layout:w-7 desktop-layout:h-7 rounded object-cover"
                                          />
                                          <span className="flex min-w-0 flex-1 flex-col justify-center">
                                          <span
                                              className="truncate whitespace-nowrap text-[13px] desktop-layout:text-[16px]"
                                            style={{ color: qualityColors[alt.recipe.quality] }}
                                          >
                                            {alt.recipe.name.length <= 35
                                              ? alt.recipe.name
                                              : `${alt.recipe.name.slice(0, 33)}…`}
                                          </span>
                                            <RecipeSourceMark recipe={alt.recipe} materialInfo={materialInfo} />
                                        </span>
                                        </span>
                                        <span className="shrink-0">
                                          <CostBox copper={alt.cost} className="min-w-[6.75rem] desktop-layout:min-w-[8rem] text-[12px] desktop-layout:text-[15px]" />
                                        </span>
                                      </motion.div>
                                      </div>
                                    ))}
                                    </motion.div>
                                  </motion.div>
                                )}
                                </AnimatePresence>
                              </div>
                            </motion.div>
                          );
                        })}
                        {swapTip && typeof document !== 'undefined' && createPortal(
                          <div
                            role="tooltip"
                            className="pointer-events-none fixed z-[100] w-60 -translate-y-1/2 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-neutral-200 shadow-lg"
                            style={{ top: swapTip.top, left: swapTip.left }}
                          >
                            {swapTip.text}
                          </div>,
                          document.body
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {filteredRecipes.map((r) => {
                          const saleRateReason = lowSaleRateLabel(r, priceSourcing, regionSaleRate, minSaleRate, minSaleRatePercent);
                          return (
                          <div
                            key={r.id}
                            onClick={() => {
                              const step = firstRecipeStep(r);
                              setSelectedRecipeId(r.id);
                              setRngLow(step.low);
                              setRngHigh(step.high);
                              setSidebarOpen(false);
                            }}
                            onMouseEnter={(event) => {
                              if (!saleRateReason) return;
                              const rect = event.currentTarget.getBoundingClientRect();
                              const width = 240;
                              setSaleRateTip({
                                text: saleRateReason,
                                top: rect.top + rect.height / 2,
                                left: Math.min(rect.right + 8, window.innerWidth - width - 8),
                              });
                            }}
                            onMouseLeave={() => setSaleRateTip(null)}
                            id={`recipe-${r.id}`}
                            className={`relative flex items-center gap-1 border-b border-white/[0.04] px-2 py-1 cursor-pointer transition-colors duration-100 ease-in-out active:scale-[0.99] min-h-[43px] desktop-layout:min-h-[60px]
                              ${saleRateReason ? 'opacity-40 saturate-0' : ''}
                              ${selectedRecipeId === r.id
                                ? 'bg-neutral-600 hover:bg-neutral-600 active:bg-neutral-500'
                                : 'bg-neutral-900 hover:bg-neutral-700 active:bg-neutral-600'}`}
                          >
                            <span
                              className={`absolute left-0 top-0 bottom-0 w-1 rounded-none ${
                                diffColor(committedSkill, r.difficulty)
                              }`}
                            />
                            <div className="pl-2 desktop-layout:pl-3 flex items-center gap-1 flex-1 min-w-0">
                              <CachedIcon
                                category={getRecipeProfession(r.id, selectedProfession)}
                                id={r.id}
                                className="w-6 h-6 desktop-layout:w-7 desktop-layout:h-7 rounded object-cover"
                              />
                              <span className="flex min-w-0 flex-1 flex-col justify-center">
                              <span
                                  className="truncate whitespace-nowrap text-[13px] desktop-layout:text-[16px]"
                                style={{ color: qualityColors[r.quality ?? 1] }}
                              >
                                {r.name.length <= 40 ? r.name : `${r.name.slice(0,37)}…`}
                              </span>
                                <RecipeSourceMark recipe={r} materialInfo={materialInfo} />
                            </span>
                            </div>
                            <span className="shrink-0">
                              <CostBox copper={recipeNetCost.get(r.id) ?? Infinity} className="min-w-[6.75rem] desktop-layout:min-w-[8rem] text-[12px] desktop-layout:text-[15px]" />
                            </span>
                            <SkillBox className={`min-w-[4.75rem] desktop-layout:min-w-[5.75rem] ${selectedVersion === 'Forever' ? 'text-[#a1ddfc]' : 'text-yellow-200'}`}>
                              {getEffectiveMinSkill(r)}
                            </SkillBox>
                          </div>
                          );
                        })}
                        {saleRateTip && typeof document !== 'undefined' && createPortal(
                          <div
                            role="tooltip"
                            className="pointer-events-none fixed z-[100] w-60 -translate-y-1/2 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-neutral-200 shadow-lg"
                            style={{ top: saleRateTip.top, left: saleRateTip.left }}
                          >
                            {saleRateTip.text}
                          </div>,
                          document.body
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </section>

            {/* Footer */}
            <div className="relative">
              <AnimatePresence mode="wait">
                {view === 'route' && routeIsFinite && (
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 20, opacity: 0 }}
                    transition={{ 
                      y: { duration: 0.2 },
                      opacity: { duration: 0.2 },
                      ease: "easeOut"
                    }}
                    className="absolute inset-x-0 bottom-0 bg-neutral-950/90 backdrop-blur-md 
                              border-t border-[#e3b056]/30 py-2 px-4 desktop-layout:py-2.5 desktop-layout:px-10"
                  >
                    <div className="text-sm desktop-layout:text-xl font-semibold flex items-center justify-between gap-1 min-w-0">
                      <div className="flex items-center justify-start gap-2 min-w-0 overflow-hidden pl-[55px] desktop-layout:pl-[75px]">
                        <span className="text-neutral-400 shrink-0">Total</span>
                        <CostBox copper={displayedTotalCost} className="min-w-0 text-[13px] desktop-layout:text-lg" />
                      </div>
                      <button
                        onClick={() => setShowMaterials(!showMaterials)}
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 py-1 text-xs desktop-layout:px-2 desktop-layout:py-1.5 desktop-layout:text-sm font-semibold transition-colors rounded border border-[#e3b056]/70 bg-[#e3b056]/15 text-[#e3b056] hover:bg-[#e3b056]/25 hover:text-[#f3d7a1]"
                      >
                        <span>Materials and Imports</span>
                        <svg
                          className={`w-3 h-3 desktop-layout:w-4 desktop-layout:h-4 transition-transform ${showMaterials ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </aside>

        {/* Materials Panel (now sibling to aside, not inside it) */}
        <AnimatePresence>
          {showMaterials && view === 'route' && routeIsFinite && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed inset-x-0 bottom-0 top-14 max-h-[85vh] desktop-layout:inset-auto desktop-layout:!left-150 desktop-layout:top-0 desktop-layout:bottom-auto desktop-layout:right-auto desktop-layout:w-[330px] desktop-layout:max-h-none desktop-layout:h-full rounded-t-xl desktop-layout:rounded shadow-lg border border-neutral-800 border-b-0 desktop-layout:border-b z-50 origin-bottom desktop-layout:origin-left bg-neutral-900/95 backdrop-blur-sm"
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
                    <div key={material.itemId} className="flex justify-between items-center gap-2 text-neutral-200">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <CachedIcon
                          category="materials"
                          id={material.itemId}
                          alt={material.name || 'Item'}
                          className="w-6 h-6 rounded object-cover border border-neutral-700 flex-shrink-0"
                        />
                        <span className="truncate" style={{ color: qualityColors[material.quality ?? 1] }}>
                          {material.name || `Item ${material.itemId}`}
                        </span>
                        <MaterialSourceBadge source={materialBuySource(material.itemId, prices, materialInfo, useMarketValue)} />
                      </span>
                      <span className={`${selectedVersion === 'Forever' ? 'text-[#64cbfb]' : 'text-yellow-300'} font-medium`}>
                        {material.quantity.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <ShoppingListImport
                  profession={selectedProfession}
                  skill={committedSkill}
                  target={committedTarget}
                  items={displayedMaterialTotals}
                  steps={guideSteps}
                  successMarginPercent={successMarginPercent}
                  realm={selectedRealm}
                  faction={selectedFaction}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main panel - z-0 so left-edge drag zone (z-45) stays interactable; sliders use z-20 within their containers */}
        <main className="relative z-0 flex flex-col flex-1 h-full overflow-y-auto focus:outline-none desktop-layout:order-last bg-transparent [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-600/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:transition-colors [&::-webkit-scrollbar-thumb]:duration-300 hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600/60 motion-safe:transition-[scrollbar-color] motion-safe:duration-300 scrollbar-thin scrollbar-thumb-neutral-600/40 hover:scrollbar-thumb-neutral-600/60">
        <PriceAgeNotice realm={selectedRealm} faction={selectedFaction} variant="banner" />
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e3b056]">Recipe details</p>
            <p className="mt-3 text-xl font-semibold tracking-tight text-white">Choose a craft from the guide</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-400">
              <span className="desktop-layout:hidden">Tap the menu to open the leveling guide, then pick a recipe. </span>
              Costs, skill-up chances, and materials show up here.
            </p>
          </div>
        ) : (
          <div className="flex-1 w-full max-w-4xl pt-14 pb-6 desktop-layout:py-12 mx-auto px-4 sm:px-6 desktop-layout:max-[1919px]:max-w-5xl desktop-layout:max-[1919px]:px-8 min-[1920px]:grid min-[1920px]:w-max min-[1920px]:max-w-full min-[1920px]:flex-none min-[1920px]:self-center min-[1920px]:grid-cols-[160px_56rem_160px] min-[1920px]:justify-center min-[1920px]:items-start min-[1920px]:gap-6 min-[1920px]:px-6">
            <div className="flex-none items-center min-[1920px]:col-start-2">
              <div className="flex items-start pb-1 desktop-layout:pb-2">
                <CachedIcon
                  category={getRecipeProfession(selected.id, selectedProfession)}
                  id={selected.id}
                  alt={`${selected.name} icon`}
                  className="mr-3 h-10 w-10 flex-shrink-0 rounded-lg object-cover ring-1 ring-[#e3b056]/40 shadow-lg shadow-black/40 desktop-layout:h-16 desktop-layout:w-16"
                />
                <div className="min-w-0">
                <a
                    href={selected.url || `https://www.wowhead.com/${getWowheadBase(selectedVersion)}/spell=${selected.id}`}
                  target="_blank"
                  rel="noreferrer"
                    className="text-xl desktop-layout:text-[36px] hover:underline font-semibold"
                  style={{ color: qualityColors[selected.quality ?? 1] }}
                >
                  {selected.name}
                </a>
                  <SelectedCraftSource
                    recipe={selected}
                    materialInfo={materialInfo}
                    wowheadBase={getWowheadBase(selectedVersion)}
                  />
              </div>
              </div>
            </div>
            <AdSlot
              slot={AD_SLOT_SKYSCRAPER}
              width={160}
              height={600}
              className="sticky top-4 z-10 hidden h-[600px] w-[160px] items-center justify-center self-start min-[1920px]:col-start-1 min-[1920px]:row-start-2 min-[1920px]:flex"
            />
            <div className="mt-1 rounded-xl border border-[#e3b056]/20 bg-neutral-900/75 pb-12 shadow-2xl shadow-black/40 backdrop-blur-sm desktop-layout:mt-2 min-[1920px]:col-start-2 min-[1920px]:row-start-2 min-[1920px]:min-w-0">
              <div className="flex items-center justify-between border-b border-[#e3b056]/20 bg-gradient-to-r from-[#e3b056]/12 to-transparent px-4 py-5 sm:rounded-t-xl sm:px-6">
                <h3 className="text-base font-medium leading-6 tracking-tight text-white desktop-layout:text-lg">Level-up Calculator</h3>
              </div>
              <div className="flex flex-col desktop-layout:flex-row w-full h-full">
                <div className="relative h-[min(calc(75vw-1rem),284px)] w-full pb-4 pl-4 pr-4 pt-4 desktop-layout:h-[318px] desktop-layout:w-3/5 desktop-layout:pb-0 desktop-layout:pl-8 desktop-layout:pr-8 desktop-layout:pt-8">
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
                          const lowY  = yScale(expectedSkillUps(selected, clampedLow, workingOvertimeRank));
                          const highY = yScale(expectedSkillUps(selected, clampedHigh, workingOvertimeRank));
                          const y0    = yScale(0);

                          return (
                            <g>
                              {/* lower slider guide */}
                              <line
                                x1={lowX}  y1={lowY}
                                x2={lowX}  y2={y0}
                                stroke="#888"
                                strokeWidth={1}
                              />
                              {/* upper slider guide */}
                              <line
                                x1={highX} y1={highY}
                                x2={highX} y2={y0}
                                stroke="#888"
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
                          const minSkill = getEffectiveMinSkill(selected);

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
                  <div className="relative z-20 bottom-7 ml-9.5">
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
                                min: sliderMin,
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
                        const thumbSize = isDesktop ? 20 : 44;
                        return (
                          <div
                            key={key}
                            {...rest}
                            style={{
                              ...style,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: thumbSize,
                              height: thumbSize,
                              pointerEvents: 'auto'
                            }}
                            className="touch-manipulation"
                          >
                            <div
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 6,
                                backgroundColor: '#9ca3af',
                                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                                pointerEvents: 'none'
                              }}
                            />
                          </div>
                        );
                      }}
                    />
                  </div>
                </div> {/* end chart container */} 

                <aside className="relative flex w-full flex-none flex-col border-t border-white/[0.06] bg-white/[0.03] p-3 desktop-layout:w-2/5 desktop-layout:border-l desktop-layout:border-t-0 desktop-layout:p-4" style={{ minHeight: 200 }}>
                  <div className="flex w-full gap-3">
                  <div className="flex min-w-0 flex-1 flex-col items-center">
                    <span className="mb-2 text-[11px] font-medium tracking-wide text-neutral-400">From</span>
                    <div className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25">
                      <button
                        className="h-10 w-10 rounded-l-lg text-lg text-neutral-300 transition hover:bg-white/10 hover:text-white"
                        onClick={() => setRngLow(Math.max(sliderMin, rngLow - 1))}
                      >−</button>
                      <input
                        type="number"
                        value={rngLow}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) {
                            setRngLow(val);
                            clearRngLowDebounce();
                            rngLowDebounceRef.current = setTimeout(() => {
                              rngLowDebounceRef.current = null;
                              setRngLow(Math.max(sliderMinRef.current, Math.min(rngLowRef.current, rngHighRef.current - 1)));
                            }, COMMIT_DEBOUNCE_MS);
                          }
                        }}
                        onBlur={() => {
                          clearRngLowDebounce();
                          setRngLow(Math.max(sliderMin, Math.min(rngLow, rngHigh - 1)));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            clearRngLowDebounce();
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-12 bg-transparent text-center text-lg text-white outline-none appearance-none
                                  [&::-webkit-inner-spin-button]:appearance-none 
                                  [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        className="h-10 w-10 rounded-r-lg text-lg text-neutral-300 transition hover:bg-white/10 hover:text-white"
                        onClick={() => setRngLow(Math.min(rngHigh - 1, rngLow + 1))}
                      >+</button>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-center">
                    <span className="mb-2 text-[11px] font-medium tracking-wide text-neutral-400">To</span>
                    <div className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/25">
                      <button
                        className="h-10 w-10 rounded-l-lg text-lg text-neutral-300 transition hover:bg-white/10 hover:text-white"
                        onClick={() => setRngHigh(Math.max(rngLow + 1, rngHigh - 1))}
                      >−</button>
                      <input
                        type="number"
                        value={rngHigh}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) {
                            setRngHigh(val);
                            clearRngHighDebounce();
                            rngHighDebounceRef.current = setTimeout(() => {
                              rngHighDebounceRef.current = null;
                              setRngHigh(Math.max(rngLowRef.current + 1, Math.min(rngHighRef.current, sliderMaxRef.current)));
                            }, COMMIT_DEBOUNCE_MS);
                          }
                        }}
                        onBlur={() => {
                          clearRngHighDebounce();
                          setRngHigh(Math.max(rngLow + 1, Math.min(rngHigh, sliderMax)));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            clearRngHighDebounce();
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-12 bg-transparent text-center text-lg text-white outline-none appearance-none
                                  [&::-webkit-inner-spin-button]:appearance-none 
                                  [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <button
                        className="h-10 w-10 rounded-r-lg text-lg text-neutral-300 transition hover:bg-white/10 hover:text-white"
                        onClick={() => setRngHigh(Math.min(sliderMax, rngHigh + 1))}
                      >+</button>
                    </div>
                  </div>
                </div>
                  <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-sm font-semibold text-white desktop-layout:text-base">Total level-ups</span>
                      <span className="text-sm font-semibold text-white desktop-layout:text-base">{totalLevelUps}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-sm font-semibold text-white desktop-layout:text-base">Average success rate</span>
                      <span className="text-sm font-semibold desktop-layout:text-base" style={{ color: chanceColor(avgSuccessRate) }}>{(avgSuccessRate * 100).toFixed(2)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-sm font-semibold text-white desktop-layout:text-base">Average attempts required</span>
                      <span className="text-sm font-semibold text-white desktop-layout:text-base">{expCrafts}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-sm font-semibold text-white desktop-layout:text-base">Total materials cost</span>
                      <CostBox copper={Object.values(materialTotals).reduce((s, m) => s + m.craftCost, 0)} trim className="text-sm desktop-layout:text-base" />
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <span className="whitespace-nowrap text-sm font-semibold text-white desktop-layout:text-base">Cost after {priceSourceName}</span>
                      <CostBox copper={costAfterSource} trim className="text-sm desktop-layout:text-base" />
                    </div>
                  </div>
                </aside>
              </div>

              <RecipeDetailsSection
                recipe={selected}
                wowheadBase={getWowheadBase(selectedVersion)}
                materialInfo={materialInfo}
                prices={prices}
                useMarketValue={useMarketValue}
              />

              <div className="flex items-center justify-between border-y border-[#e3b056]/20 bg-gradient-to-r from-[#e3b056]/12 to-transparent px-2 py-3 desktop-layout:px-6 desktop-layout:py-5">
                <h3 className="text-sm desktop-layout:text-lg font-medium leading-6 tracking-tight text-white">Material Calculations</h3>
              </div>
              <div className="px-3 py-4 desktop-layout:px-6 desktop-layout:py-5">
                <MaterialTreeFlat rootNodes={materialTrees} materialInfo={materialInfo} expCrafts={expCrafts} wowheadBase={getWowheadBase(selectedVersion)} />
              </div>

              <CraftValuePanel
                recipe={selected}
                prices={prices}
                materialInfo={materialInfo}
                useMarketValue={useMarketValue}
                optimizeSubCrafting={optimizeSubCrafting}
                currentProfessionRecipeIds={currentProfessionRecipeIds}
                priceSourcing={priceSourcing}
                profession={selectedProfession}
                includeRecipeCost={includeRecipeCost}
                expCrafts={expCrafts}
                version={selectedVersion}
              />

            </div>
            <AdSlot
              slot={AD_SLOT_SKYSCRAPER}
              width={160}
              height={600}
              className="sticky top-4 z-10 hidden h-[600px] w-[160px] items-center justify-center self-start min-[1920px]:col-start-3 min-[1920px]:row-start-2 min-[1920px]:flex"
            />
          </div>
        )}
        </main>
      </div>
    </div>
  );
}