import type { PriceMap } from "./types";
import type { MaterialInfo } from "./types";

/** TBC disenchant outcome: { itemId, chance, minQty, maxQty } */
export type DisenchantOutcome = {
  itemId: number;
  chance: number;
  minQty: number;
  maxQty: number;
};

// Vanilla/low-level disenchant material IDs (ilvl 1-65 greens)
const VANILLA_DUST = [
  [10940, 1, 2],   // ilvl 5-15: Strange Dust
  [10940, 2, 3],   // 16-20
  [10940, 4, 6],   // 21-25
  [11083, 1, 2],   // 26-30: Soul Dust
  [11083, 2, 5],   // 31-35
  [11137, 1, 2],   // 36-40: Vision Dust
  [11137, 2, 5],   // 41-45
  [11176, 1, 2],   // 46-50: Dream Dust
  [11176, 2, 5],   // 51-55
  [16204, 1, 2],   // 56-60: Illusion Dust
  [16204, 2, 5],   // 61-65
] as const;
const VANILLA_ESSENCE = [
  [10938, 1, 2],   // 5-15: Lesser Magic
  [10939, 1, 2],   // 16-20: Greater Magic
  [10998, 1, 2],   // 21-25: Lesser Astral
  [11082, 1, 2],   // 26-30: Greater Astral
  [11134, 1, 2],   // 31-35: Lesser Mystic
  [11135, 1, 2],   // 36-40: Greater Mystic
  [11174, 1, 2],   // 41-45: Lesser Nether
  [11175, 1, 2],   // 46-50: Greater Nether
  [16202, 1, 2],   // 51-55: Lesser Eternal
  [16203, 1, 2],   // 56-60: Greater Eternal
  [16203, 1, 3],   // 61-65: Greater Eternal 1-3
] as const;
const VANILLA_SHARD = [0, 10978, 10978, 11084, 11138, 11139, 11177, 11178, 14343, 14344, 14344] as const; // 0 = no shard

/** Rare (blue) shards by ilvl bracket. ilvl 1-25: Small Glimmering, 26-30: Large Glimmering, ..., 66-99: Small Prismatic, 100+: Large Prismatic */
const RARE_SHARD_BY_ILVL: ReadonlyArray<number> = [
  10978, 11084, 11138, 11139, 11177, 11178, 14343, 14344, 22448, 22449,
];
function getRareShardBracket(ilvl: number): number {
  if (ilvl <= 25) return 0;   // Small Glimmering
  if (ilvl <= 30) return 1;   // Large Glimmering
  if (ilvl <= 35) return 2;   // Small Glowing
  if (ilvl <= 40) return 3;   // Large Glowing
  if (ilvl <= 45) return 4;   // Small Radiant
  if (ilvl <= 50) return 5;   // Large Radiant
  if (ilvl <= 55) return 6;   // Small Brilliant
  if (ilvl <= 65) return 7;   // Large Brilliant
  if (ilvl <= 99) return 8;   // Small Prismatic
  return 9;                   // Large Prismatic (ilvl 100+)
}

function getVanillaGreenBracket(ilvl: number): number {
  if (ilvl <= 15) return 0;  // 5-15
  if (ilvl <= 20) return 1;  // 16-20
  if (ilvl <= 25) return 2;  // 21-25
  if (ilvl <= 30) return 3;  // 26-30
  if (ilvl <= 35) return 4;  // 31-35
  if (ilvl <= 40) return 5;  // 36-40
  if (ilvl <= 45) return 6;  // 41-45
  if (ilvl <= 50) return 7;  // 46-50
  if (ilvl <= 55) return 8;  // 51-55
  if (ilvl <= 60) return 9;  // 56-60
  return 10;  // 61-65
}

const WEAPON_SLOTS = ['One-Hand', 'Two-Hand', 'Main Hand', 'Off Hand', 'Ranged', 'Held In Off-hand', 'Thrown'];
const ARMOR_SLOTS = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Shirt', 'Tabard', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Finger', 'Trinket', 'Shield'];

/** Item IDs that are known non-disenchantable (keys, consumables, item enchantments, etc.) despite having quality 2+ and empty class/slot. */
const NON_DISENCHANTABLE_ITEM_IDS = new Set<number>([
  // Skeleton Keys
  15869, 15870, 15871, 15872,
  // Tailoring spellthreads (item enchantments for legs)
  24273, 24274, 24275, 24276,
  // Leatherworking armor kits (item enchantments)
  2304, 2313, 4265, 8173, 15564, 18251, 25650, 25651, 25652,
  29483, 29485, 29486, 29487, 29488,
]);

/** Infer WoW item class from slot when class is missing (e.g. armor items with class: "" in materials.json). */
function inferClassFromSlot(slot: string | undefined): string | undefined {
  if (!slot || slot === '') return undefined;
  const s = slot.trim();
  if (WEAPON_SLOTS.includes(s)) return '2';
  if (ARMOR_SLOTS.includes(s)) return '4';
  return undefined;
}

/** WoW item class: only Weapon (2) and Armor (4) can be disenchanted. Ammo (6), consumables, etc. cannot. */
export function isDisenchantableItemClass(itemClass: string | number | undefined, slot?: string): boolean {
  const c = itemClass === undefined ? '' : String(itemClass);
  if (c === '2' || c === '4') return true;
  if (c === '' || c === undefined) {
    const inferred = inferClassFromSlot(slot);
    if (inferred === '2' || inferred === '4') return true;
    // Many armor items in materials.json have class: "" and slot: "" (scraper didn't populate).
    // Assume armor when both are empty - crafted gear with missing data is often armor.
    if (!slot || slot.trim() === '') return true;
  }
  return false;
}

/**
 * Get expected disenchant materials for TBC items.
 * Based on wowpedia/wow-professions disenchant tables. Returns outcomes with expected value.
 * Quality: 1=common (no DE), 2=uncommon, 3=rare, 4=epic
 * isWeapon: true for weapons, false for armor (different dust/essence split)
 * itemClass: WoW item class (2=weapon, 4=armor) - only these can be disenchanted; ammo (6), etc. cannot
 * slot: optional slot string - used to infer class when itemClass is empty (e.g. armor with class: "")
 * itemId: optional - if in NON_DISENCHANTABLE_ITEM_IDS (keys, etc.), returns [] even when class/slot suggest disenchant
 */
export function getDisenchantOutcomes(
  itemLevel: number,
  quality: number,
  isWeapon: boolean,
  itemClass?: string | number,
  slot?: string,
  itemId?: number
): DisenchantOutcome[] {
  if (itemId != null && NON_DISENCHANTABLE_ITEM_IDS.has(itemId)) return [];
  if (!isDisenchantableItemClass(itemClass, slot)) return [];
  // When class is empty, infer from slot; if slot also empty, assume armor (common for crafted gear with missing data)
  const effectiveClass = (itemClass === undefined || itemClass === '' ? inferClassFromSlot(slot) ?? '4' : String(itemClass));
  const effectiveIsWeapon = effectiveClass === '2' ? true : false;
  if (quality < 2) return []; // Common items can't be disenchanted

  // Uncommon (green)
  if (quality === 2) {
    const dustChance = effectiveIsWeapon ? 0.2 : 0.75;
    const essenceChance = effectiveIsWeapon ? 0.75 : 0.2;

    // ilvl 1-65: Vanilla materials or early TBC (57-65)
    if (itemLevel < 66) {
      if (itemLevel < 57) {
        // Vanilla greens
        const b = getVanillaGreenBracket(itemLevel);
        const dust = VANILLA_DUST[b];
        const essence = VANILLA_ESSENCE[b];
        const shardId = VANILLA_SHARD[b];
        const outcomes: DisenchantOutcome[] = [
          { itemId: dust[0], chance: dustChance, minQty: dust[1], maxQty: dust[2] },
          { itemId: essence[0], chance: essenceChance, minQty: essence[1], maxQty: essence[2] },
        ];
        if (shardId > 0) outcomes.push({ itemId: shardId, chance: 0.03, minQty: 1, maxQty: 1 });
        return outcomes;
      }
      // ilvl 57-65: TBC materials (Arcane Dust 1-3, Lesser Planar 1-3, Small Prismatic)
      return [
        { itemId: 22445, chance: dustChance, minQty: 1, maxQty: 3 },
        { itemId: 22447, chance: essenceChance, minQty: 1, maxQty: 3 },
        { itemId: 22448, chance: 0.03, minQty: 1, maxQty: 1 },
      ];
    }

    // ilvl 66+: TBC materials
    // ilvl 66-79: Arcane Dust 75% 1-2x, Lesser Planar 22% 1-2x, Small Prismatic 3%
    // ilvl 80-99: Arcane Dust 75% 2-3x, Lesser Planar 22% 2-3x, Small Prismatic 3%
    // ilvl 100-120: Arcane Dust 75% 2-5x, Greater Planar 22% 1-2x, Large Prismatic 3%
    const essenceId = itemLevel >= 100 ? 22446 : 22447;
    const shardId = itemLevel >= 100 ? 22449 : 22448;
    const dustQty = itemLevel >= 100 ? [2, 5] : itemLevel >= 80 ? [2, 3] : [1, 2];
    const essenceQty = itemLevel >= 100 ? [1, 2] : itemLevel >= 80 ? [2, 3] : [1, 2];

    return [
      { itemId: 22445, chance: dustChance, minQty: dustQty[0], maxQty: dustQty[1] },
      { itemId: essenceId, chance: essenceChance, minQty: essenceQty[0], maxQty: essenceQty[1] },
      { itemId: shardId, chance: 0.03, minQty: 1, maxQty: 1 },
    ];
  }

  // Rare (blue) - 100% shard, type depends on ilvl (vanilla shards for low ilvl, TBC Prismatic for 66+)
  if (quality === 3) {
    const bracket = getRareShardBracket(itemLevel);
    const shardId = RARE_SHARD_BY_ILVL[bracket];
    return [
      { itemId: shardId, chance: 1, minQty: 1, maxQty: 1 },
    ];
  }

  // TBC epic (purple) - 100% crystal. ilvl 60-99: Nexus Crystal; ilvl 100+: Void Crystal
  if (quality === 4) {
    const crystalId = itemLevel >= 100 ? 22450 : 20725; // Void Crystal : Nexus Crystal
    return [
      { itemId: crystalId, chance: 1, minQty: 1, maxQty: 1 },
    ];
  }

  return [];
}

/** Expected value from disenchanting one item (copper). Returns 0 if item cannot be disenchanted. */
export function getExpectedDisenchantValue(
  itemLevel: number,
  quality: number,
  isWeapon: boolean,
  prices: PriceMap,
  materialInfo: Record<number, MaterialInfo>,
  useMarketValue: boolean,
  itemClass?: string | number,
  slot?: string,
  itemId?: number
): number {
  const outcomes = getDisenchantOutcomes(itemLevel, quality, isWeapon, itemClass, slot, itemId);
  let total = 0;
  for (const o of outcomes) {
    const avgQty = (o.minQty + o.maxQty) / 2;
    const price = useMarketValue
      ? (prices[o.itemId]?.marketValue ?? prices[o.itemId]?.minBuyout ?? 0)
      : (prices[o.itemId]?.minBuyout ?? prices[o.itemId]?.marketValue ?? 0);
    total += o.chance * avgQty * (price || 0);
  }
  return total;
}
