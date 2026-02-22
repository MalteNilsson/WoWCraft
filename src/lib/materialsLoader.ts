// Version-specific materials (vanilla = classic, tbc = burning crusade)
import vanillaMaterials from '@/data/materials/vanilla/materials.json';
import tbcMaterials from '@/data/materials/tbc/materials.json';
import { MaterialInfo } from './types';

// Recipe items (use static imports so they work in client components; fs.readFileSync fails in browser)
import vanillaEnchantingItems from '@/data/recipes/vanilla/enchanting_items.json';
import vanillaEngineeringItems from '@/data/recipes/vanilla/engineering_items.json';
import vanillaBlacksmithingItems from '@/data/recipes/vanilla/blacksmithing_items.json';
import vanillaLeatherworkingItems from '@/data/recipes/vanilla/leatherworking_items.json';
import vanillaTailoringItems from '@/data/recipes/vanilla/tailoring_items.json';
import vanillaAlchemyItems from '@/data/recipes/vanilla/alchemy_items.json';
import tbcEnchantingItems from '@/data/recipes/tbc/enchanting_items.json';
import tbcEngineeringItems from '@/data/recipes/tbc/engineering_items.json';
import tbcBlacksmithingItems from '@/data/recipes/tbc/blacksmithing_items.json';
import tbcLeatherworkingItems from '@/data/recipes/tbc/leatherworking_items.json';
import tbcTailoringItems from '@/data/recipes/tbc/tailoring_items.json';
import tbcAlchemyItems from '@/data/recipes/tbc/alchemy_items.json';
import tbcJewelcraftingItems from '@/data/recipes/tbc/jewelcrafting_items.json';

function processMaterials(raw: Record<string, any>): Record<number, MaterialInfo> {
  return Object.fromEntries(
    Object.entries(raw).map(([id, val]: [string, any]) => {
      const { vendorPrice, limitedStock, vendorStack, ...rest } = val;
      const safeVendorPrice = typeof vendorPrice === "number" ? vendorPrice : undefined;
      const buyPrice = safeVendorPrice;
      return [parseInt(id), {
        ...rest,
        vendorPrice: safeVendorPrice,
        buyPrice,
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
  wowheadPath: 'classic' | 'tbc'
) {
  Object.entries(items).forEach(([id, val]) => {
    const itemId = parseInt(id);
    if (!materialInfo[itemId]) {
      let icon = 'inv_scroll_03';
      if (itemType === 'engineering') icon = 'inv_scroll_05';
      else if (itemType === 'blacksmithing') icon = 'inv_scroll_06';
      else if (itemType === 'leatherworking' || itemType === 'tailoring') icon = 'inv_scroll_04';
      else if (itemType === 'alchemy' || itemType === 'jewelcrafting') icon = 'inv_scroll_03';
      materialInfo[itemId] = {
        name: `${itemType === 'engineering' ? 'Schematic' : itemType === 'blacksmithing' ? 'Plan' : itemType === 'leatherworking' || itemType === 'tailoring' ? 'Pattern' : itemType === 'jewelcrafting' ? 'Design' : 'Recipe'} #${id}`,
        quality: 1,
        class: 'Trade Goods',
        subclass: 'Recipe',
        icon,
        slot: '',
        link: `https://www.wowhead.com/${wowheadPath}/item=${id}`,
        buyPrice: val.buyPrice ?? undefined,
        vendorPrice: val.buyPrice ?? undefined,
        limitedStock: val.limitedStock,
        vendorStack: val.vendorStack,
        auctionhouse: val.auctionhouse,
        bop: val.bop
      };
    } else {
      materialInfo[itemId] = {
        ...materialInfo[itemId],
        buyPrice: val.buyPrice ?? materialInfo[itemId].buyPrice,
        vendorPrice: val.buyPrice ?? materialInfo[itemId].vendorPrice,
        limitedStock: val.limitedStock ?? materialInfo[itemId].limitedStock,
        vendorStack: val.vendorStack ?? materialInfo[itemId].vendorStack,
        auctionhouse: val.auctionhouse ?? materialInfo[itemId].auctionhouse,
        bop: val.bop ?? materialInfo[itemId].bop
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

const tbcMaterialInfo = processMaterials(tbcMaterials as Record<string, any>);
mergeRecipeItems(tbcMaterialInfo, tbcEnchantingItems as Record<string, any>, 'enchanting', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcEngineeringItems as Record<string, any>, 'engineering', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcBlacksmithingItems as Record<string, any>, 'blacksmithing', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcLeatherworkingItems as Record<string, any>, 'leatherworking', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcTailoringItems as Record<string, any>, 'tailoring', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcAlchemyItems as Record<string, any>, 'alchemy', 'tbc');
mergeRecipeItems(tbcMaterialInfo, tbcJewelcraftingItems as Record<string, any>, 'jewelcrafting', 'tbc');

export const materialInfoMap: Record<string, Record<number, MaterialInfo>> = {
  'Vanilla': vanillaMaterialInfo,
  'The Burning Crusade': tbcMaterialInfo
};

export default materialInfoMap;