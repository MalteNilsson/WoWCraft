/**
 * Records the 1–300 raw-material cost of every Forever profession for PvE and PvP
 * on US and EU, for Alliance and Horde.
 *
 * Run this after auction prices have been written into src/data/prices.
 * Each price snapshot is stored once, keyed by when those prices were observed,
 * in src/data/profession-costs/forever.json.
 *
 * The copper total matches the planner footer: default cost mode, recipe cost
 * included, sub-crafting optimization off, currency recipes off.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeDynamicPlan } from '../lib/planner';
import { craftCost, expectedCraftsBetween } from '../lib/recipeCalc';
import { materialInfoMap } from '../lib/materialsLoader';
import { toPriceMap } from '../lib/pricing';
import type { PlanStep } from '../lib/planner';
import type { MaterialInfo, PriceMap, Recipe } from '../lib/types';
import foreverAlchemy from '../data/recipes/forever/alchemy.json';
import foreverBlacksmithing from '../data/recipes/forever/blacksmithing.json';
import foreverCooking from '../data/recipes/forever/cooking.json';
import foreverEnchanting from '../data/recipes/forever/enchanting.json';
import foreverEngineering from '../data/recipes/forever/engineering.json';
import foreverLeatherworking from '../data/recipes/forever/leatherworking.json';
import foreverTailoring from '../data/recipes/forever/tailoring.json';
import foreverSodSpellIds from '../data/sod/forever-excluded-spell-ids.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricesDir = path.join(__dirname, '../data/prices');
const outputPath = path.join(__dirname, '../data/profession-costs/forever.json');

const SKILL = 1;
const TARGET = 300;
const PRICE_SOURCING = 'cost' as const;

const PROFESSIONS: { name: string; recipes: Recipe[] }[] = [
  { name: 'Alchemy', recipes: foreverAlchemy as unknown as Recipe[] },
  { name: 'Blacksmithing', recipes: foreverBlacksmithing as unknown as Recipe[] },
  { name: 'Cooking', recipes: foreverCooking as unknown as Recipe[] },
  { name: 'Enchanting', recipes: foreverEnchanting as unknown as Recipe[] },
  { name: 'Engineering', recipes: foreverEngineering as unknown as Recipe[] },
  { name: 'Leatherworking', recipes: foreverLeatherworking as unknown as Recipe[] },
  { name: 'Tailoring', recipes: foreverTailoring as unknown as Recipe[] },
];

const CONFIGS: { realm: string; realmType: 'PvE' | 'PvP'; faction: 'Alliance' | 'Horde'; file: string; ageKey: string }[] = [
  { realm: 'Forever PvE US', realmType: 'PvE', faction: 'Alliance', file: 'ForeverNormal_alliance.json', ageKey: 'Forever PvE US_Alliance' },
  { realm: 'Forever PvE US', realmType: 'PvE', faction: 'Horde', file: 'ForeverNormal_horde.json', ageKey: 'Forever PvE US_Horde' },
  { realm: 'Forever PvP US', realmType: 'PvP', faction: 'Alliance', file: 'ForeverPvP_alliance.json', ageKey: 'Forever PvP US_Alliance' },
  { realm: 'Forever PvP US', realmType: 'PvP', faction: 'Horde', file: 'ForeverPvP_horde.json', ageKey: 'Forever PvP US_Horde' },
  { realm: 'Forever PvE EU', realmType: 'PvE', faction: 'Alliance', file: 'ForeverPvE_EU_alliance.json', ageKey: 'Forever PvE EU_Alliance' },
  { realm: 'Forever PvE EU', realmType: 'PvE', faction: 'Horde', file: 'ForeverPvE_EU_horde.json', ageKey: 'Forever PvE EU_Horde' },
  { realm: 'Forever PvP EU', realmType: 'PvP', faction: 'Alliance', file: 'ForeverPvP_EU_alliance.json', ageKey: 'Forever PvP EU_Alliance' },
  { realm: 'Forever PvP EU', realmType: 'PvP', faction: 'Horde', file: 'ForeverPvP_EU_horde.json', ageKey: 'Forever PvP EU_Horde' },
];

type CostEntry = {
  realm: string;
  realmType: 'PvE' | 'PvP';
  faction: 'Alliance' | 'Horde';
  profession: string;
  pricesObservedAt: string;
  recordedAt: string;
  skill: number;
  target: number;
  totalCopper: number | null;
  finalSkill: number;
  reachedTarget: boolean;
};

type CostHistory = {
  version: 'Forever';
  priceSourcing: 'cost';
  includeRecipeCost: true;
  entries: CostEntry[];
};

const sodSpellIds = new Set<number>(foreverSodSpellIds as number[]);

function foreverRecipes(profession: string, recipes: Recipe[]): Recipe[] {
  const withoutSod = recipes.filter((recipe) => !sodSpellIds.has(recipe.id));
  if (profession !== 'Blacksmithing') return withoutSod;
  return withoutSod.filter((recipe) => !recipe.name?.startsWith('Hard Gold'));
}

function loadPrices(file: string, materialInfo: Record<number, MaterialInfo>): PriceMap {
  const rows = JSON.parse(fs.readFileSync(path.join(pricesDir, file), 'utf8')) as {
    itemId: number;
    minBuyout: number;
    marketValue: number;
    numAuctions?: number;
  }[];
  const materials = Object.fromEntries(
    Object.entries(materialInfo).map(([id, info]) => [id, { vendorPrice: info.vendorPrice, limitedStock: info.limitedStock }])
  );
  return toPriceMap(rows, materials);
}

/** Same total the planner footer shows for the route. */
function displayedRouteCost(
  steps: PlanStep[],
  startSkill: number,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  recipeIds: Set<number>,
  profession: string
): number {
  let total = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!('recipe' in step)) continue;
    const start = i === 0 ? startSkill : steps[i - 1].endSkill;
    const crafts = expectedCraftsBetween(start, step.endSkill, step.recipe.difficulty);
    const materialCost = craftCost(step.recipe, prices, materialInfo, false, false, false, false, recipeIds, PRICE_SOURCING, profession) * crafts;
    const recipeCost = step.recipe.source
      ? craftCost(step.recipe, prices, materialInfo, true, true, false, false, recipeIds, PRICE_SOURCING, profession)
      : 0;
    total += materialCost + recipeCost;
  }
  return total;
}

function loadHistory(): CostHistory {
  if (!fs.existsSync(outputPath)) {
    return { version: 'Forever', priceSourcing: 'cost', includeRecipeCost: true, entries: [] };
  }
  return JSON.parse(fs.readFileSync(outputPath, 'utf8')) as CostHistory;
}

function alreadyRecorded(entries: CostEntry[], entry: Pick<CostEntry, 'realm' | 'faction' | 'profession' | 'pricesObservedAt'>): boolean {
  return entries.some((existing) =>
    existing.realm === entry.realm &&
    existing.faction === entry.faction &&
    existing.profession === entry.profession &&
    existing.pricesObservedAt === entry.pricesObservedAt
  );
}

function main() {
  const materialInfo = materialInfoMap.Forever;
  const age = JSON.parse(fs.readFileSync(path.join(pricesDir, 'forever_price_age.json'), 'utf8')) as Record<string, string>;
  const history = loadHistory();
  const recordedAt = new Date().toISOString();
  const added: CostEntry[] = [];
  let failed = 0;

  for (const config of CONFIGS) {
    const pricesObservedAt = age[config.ageKey];
    if (!pricesObservedAt) {
      console.log(`No TradeSkillMaster prices yet for ${config.realm} ${config.faction}`);
      continue;
    }
    const prices = loadPrices(config.file, materialInfo);
    for (const profession of PROFESSIONS) {
      const identity = { realm: config.realm, faction: config.faction, profession: profession.name, pricesObservedAt };
      if (alreadyRecorded(history.entries, identity)) {
        console.log(`skip ${profession.name} ${config.realmType} ${config.faction} (already recorded ${pricesObservedAt})`);
        continue;
      }
      try {
        const recipes = foreverRecipes(profession.name, profession.recipes);
        const recipeIds = new Set(recipes.map((recipe) => recipe.id));
        const plan = makeDynamicPlan(
          SKILL,
          TARGET,
          recipes,
          prices,
          materialInfo,
          profession.name,
          true,
          true,
          false,
          false,
          false,
          recipeIds,
          PRICE_SOURCING,
          undefined,
          false,
          config.faction
        );
        const total = displayedRouteCost(plan.steps, SKILL, prices, materialInfo, recipeIds, profession.name);
        const hasSteps = plan.steps.some((step) => 'recipe' in step);
        const reachedTarget = hasSteps && plan.finalSkill >= TARGET && Number.isFinite(total);
        const entry: CostEntry = {
          ...identity,
          realmType: config.realmType,
          pricesObservedAt,
          recordedAt,
          skill: SKILL,
          target: TARGET,
          totalCopper: hasSteps && Number.isFinite(total) ? Math.round(total) : null,
          finalSkill: plan.finalSkill,
          reachedTarget,
        };
        added.push(entry);
        const gold = entry.totalCopper == null ? 'unavailable' : `${(entry.totalCopper / 10000).toFixed(2)}g`;
        console.log(`${profession.name} ${config.realm} ${config.faction}: ${gold} through ${plan.finalSkill}${reachedTarget ? '' : ' (short of 300)'}`);
      } catch (error) {
        failed += 1;
        console.error(`failed ${profession.name} ${config.realmType} ${config.faction}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (added.length > 0) {
    history.entries.push(...added);
    history.entries.sort((a, b) =>
      a.pricesObservedAt.localeCompare(b.pricesObservedAt) ||
      a.realm.localeCompare(b.realm) ||
      a.faction.localeCompare(b.faction) ||
      a.profession.localeCompare(b.profession)
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(history, null, 2)}\n`);
    console.log(`Recorded ${added.length} costs in ${path.relative(process.cwd(), outputPath)}`);
  } else {
    console.log('No new profession costs to record.');
  }

  if (failed > 0) process.exitCode = 1;
}

main();
