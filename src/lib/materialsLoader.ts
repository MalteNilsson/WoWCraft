// Version-specific materials (vanilla = classic, tbc = burning crusade)
import vanillaMaterials from '@/data/materials/vanilla/materials.json';
import tbcMaterials from '@/data/materials/tbc/materials.json';
import foreverMaterials from '@/data/materials/forever/materials.json';
import { MaterialInfo } from './types';

// Recipe items (use static imports so they work in client components; fs.readFileSync fails in browser)
import vanillaEnchantingItems from '@/data/recipes/vanilla/enchanting_items.json';
import vanillaEngineeringItems from '@/data/recipes/vanilla/engineering_items.json';
import vanillaBlacksmithingItems from '@/data/recipes/vanilla/blacksmithing_items.json';
import vanillaLeatherworkingItems from '@/data/recipes/vanilla/leatherworking_items.json';
import vanillaTailoringItems from '@/data/recipes/vanilla/tailoring_items.json';
import vanillaAlchemyItems from '@/data/recipes/vanilla/alchemy_items.json';
import vanillaCookingItems from '@/data/recipes/vanilla/cooking_items.json';
import tbcEnchantingItems from '@/data/recipes/tbc/enchanting_items.json';
import tbcEngineeringItems from '@/data/recipes/tbc/engineering_items.json';
import tbcBlacksmithingItems from '@/data/recipes/tbc/blacksmithing_items.json';
import tbcLeatherworkingItems from '@/data/recipes/tbc/leatherworking_items.json';
import tbcTailoringItems from '@/data/recipes/tbc/tailoring_items.json';
import tbcAlchemyItems from '@/data/recipes/tbc/alchemy_items.json';
import tbcCookingItems from '@/data/recipes/tbc/cooking_items.json';
import tbcJewelcraftingItems from '@/data/recipes/tbc/jewelcrafting_items.json';
import foreverEnchantingItems from '@/data/recipes/forever/enchanting_items.json';
import foreverEngineeringItems from '@/data/recipes/forever/engineering_items.json';
import foreverBlacksmithingItems from '@/data/recipes/forever/blacksmithing_items.json';
import foreverLeatherworkingItems from '@/data/recipes/forever/leatherworking_items.json';
import foreverTailoringItems from '@/data/recipes/forever/tailoring_items.json';
import foreverAlchemyItems from '@/data/recipes/forever/alchemy_items.json';
import foreverCookingItems from '@/data/recipes/forever/cooking_items.json';

function processMaterials(raw: Record<string, any>): Record<number, MaterialInfo> {
  return Object.fromEntries(
    Object.entries(raw).map(([id, val]: [string, any]) => {
      const { vendorPrice, sellPrice, limitedStock, vendorStack, ...rest } = val;
      const safeVendorPrice = typeof vendorPrice === "number" ? vendorPrice : undefined;
      const buyPrice = safeVendorPrice;
      const safeSellPrice = typeof sellPrice === "number" && sellPrice > 0 ? sellPrice : undefined;
      return [parseInt(id), {
        ...rest,
        vendorPrice: safeVendorPrice,
        buyPrice,
        sellPrice: safeSellPrice,
        limitedStock: limitedStock === true ? true : undefined,
        vendorStack: typeof vendorStack === "number" && vendorStack > 1 ? vendorStack : undefined
      }];
    })
  );
}

function mergeRecipeItems(
  materialInfo: Record<number, MaterialInfo>,
  items: Record<string, any>,
  itemType: string,
  wowheadPath: 'classic' | 'tbc' | 'forever'
) {
  Object.entries(items).forEach(([id, val]) => {
    const itemId = parseInt(id);
    const fallbackName = `${itemType === 'engineering' ? 'Schematic' : itemType === 'blacksmithing' ? 'Plan' : itemType === 'leatherworking' || itemType === 'tailoring' ? 'Pattern' : itemType === 'jewelcrafting' ? 'Design' : 'Recipe'} #${id}`;
    let fallbackIcon = 'inv_scroll_03';
    if (itemType === 'engineering') fallbackIcon = 'inv_scroll_05';
    else if (itemType === 'blacksmithing') fallbackIcon = 'inv_scroll_06';
    else if (itemType === 'leatherworking' || itemType === 'tailoring') fallbackIcon = 'inv_scroll_04';
    const itemName = typeof val.name === 'string' && val.name.trim() ? val.name.trim() : fallbackName;
    const itemQuality = typeof val.quality === 'number' ? val.quality : 1;
    const itemIcon = typeof val.icon === 'string' && val.icon.trim() ? val.icon.trim() : fallbackIcon;
    if (!materialInfo[itemId]) {
      materialInfo[itemId] = {
        name: itemName,
        quality: itemQuality,
        class: 'Trade Goods',
        subclass: 'Recipe',
        icon: itemIcon,
        slot: '',
        link: `https://www.wowhead.com/${wowheadPath}/item=${id}`,
        buyPrice: val.buyPrice ?? undefined,
        vendorPrice: val.buyPrice ?? undefined,
        limitedStock: val.limitedStock,
        vendorStack: val.vendorStack,
        auctionhouse: val.auctionhouse,
        bop: val.bop,
        hasSource: val.hasSource,
        mobDrop: val.mobDrop,
        currencyCost: Array.isArray(val.currencyCost) && val.currencyCost.length ? val.currencyCost : undefined,
        faction: val.faction === 'Alliance' || val.faction === 'Horde' ? val.faction : undefined
      };
    } else {
      const current = materialInfo[itemId];
      const stub = !current.name;
      materialInfo[itemId] = {
        ...current,
        name: current.name || itemName,
        quality: stub && typeof val.quality === 'number' ? val.quality : (current.quality ?? itemQuality),
        icon: current.icon || itemIcon,
        buyPrice: val.buyPrice ?? current.buyPrice,
        vendorPrice: val.buyPrice ?? current.vendorPrice,
        limitedStock: val.limitedStock ?? current.limitedStock,
        vendorStack: val.vendorStack ?? current.vendorStack,
        auctionhouse: val.auctionhouse ?? current.auctionhouse,
        bop: val.bop ?? current.bop,
        hasSource: val.hasSource ?? current.hasSource,
        mobDrop: val.mobDrop ?? current.mobDrop,
        currencyCost: Array.isArray(val.currencyCost) && val.currencyCost.length ? val.currencyCost : current.currencyCost,
        faction: val.faction === 'Alliance' || val.faction === 'Horde' ? val.faction : current.faction
      };
    }
  });
}

// Build version-specific materialInfo
const vanillaMaterialInfo = processMaterials(vanillaMaterials as Record<string, any>);
mergeRecipeItems(vanillaMaterialInfo, vanillaEnchantingItems as Record<string, any>, 'enchanting', 'classic');
mergeRecipeItems(vanillaMaterialInfo, vanillaEngineeringItems as Record<string, any>, 'engineering', 'classic');
mergeRecipeItems(vanillaMaterialInfo, vanillaBlacksmithingItems as Record<string, any>, 'blacksmithing', 'classic');
mergeRecipeItems(vanillaMaterialInfo, vanillaLeatherworkingItems as Record<string, any>, 'leatherworking', 'classic');
mergeRecipeItems(vanillaMaterialInfo, vanillaTailoringItems as Record<string, any>, 'tailoring', 'classic');
mergeRecipeItems(vanillaMaterialInfo, vanillaAlchemyItems as Record<string, any>, 'alchemy', 'classic');
mergeRecipeItems(vanillaMaterialInfo, vanillaCookingItems as Record<string, any>, 'cooking', 'classic');

const tbcMaterialInfo = processMaterials(tbcMaterials as Record<string, any>);
mergeRecipeItems(tbcMaterialInfo, tbcEnchantingItems as Record<string, any>, 'enchanting', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcEngineeringItems as Record<string, any>, 'engineering', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcBlacksmithingItems as Record<string, any>, 'blacksmithing', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcLeatherworkingItems as Record<string, any>, 'leatherworking', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcTailoringItems as Record<string, any>, 'tailoring', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcAlchemyItems as Record<string, any>, 'alchemy', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcCookingItems as Record<string, any>, 'cooking', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcJewelcraftingItems as Record<string, any>, 'jewelcrafting', 'tbc');

const foreverMaterialInfo = processMaterials(foreverMaterials as Record<string, any>);
mergeRecipeItems(foreverMaterialInfo, foreverEnchantingItems as Record<string, any>, 'enchanting', 'forever');
mergeRecipeItems(foreverMaterialInfo, foreverEngineeringItems as Record<string, any>, 'engineering', 'forever');
mergeRecipeItems(foreverMaterialInfo, foreverBlacksmithingItems as Record<string, any>, 'blacksmithing', 'forever');
mergeRecipeItems(foreverMaterialInfo, foreverLeatherworkingItems as Record<string, any>, 'leatherworking', 'forever');
mergeRecipeItems(foreverMaterialInfo, foreverTailoringItems as Record<string, any>, 'tailoring', 'forever');
mergeRecipeItems(foreverMaterialInfo, foreverAlchemyItems as Record<string, any>, 'alchemy', 'forever');
mergeRecipeItems(foreverMaterialInfo, foreverCookingItems as Record<string, any>, 'cooking', 'forever');

export const materialInfoMap: Record<string, Record<number, MaterialInfo>> = {
  'Vanilla': vanillaMaterialInfo,
  'The Burning Crusade': tbcMaterialInfo,
  'Forever': foreverMaterialInfo,
};

export default materialInfoMap;