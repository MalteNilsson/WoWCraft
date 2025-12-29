import rawMaterials from '@/data/materials/materials.json';
import enchantingItems from '@/data/recipes/enchanting_items.json';
import engineeringItems from '@/data/recipes/engineering_items.json';
import blacksmithingItems from '@/data/recipes/blacksmithing_items.json';
import leatherworkingItems from '@/data/recipes/leatherworking_items.json';
import tailoringItems from '@/data/recipes/tailoring_items.json';
import alchemyItems from '@/data/recipes/alchemy_items.json';
import { MaterialInfo } from './types';

// First process the main materials
const materialInfo: Record<number, MaterialInfo> = Object.fromEntries(
  Object.entries(rawMaterials).map(([id, val]: [string, any]) => {
    const { vendorPrice, limitedStock, ...rest } = val;
    const safeVendorPrice = typeof vendorPrice === "number" ? vendorPrice : undefined;
    const buyPrice = safeVendorPrice; // Use vendorPrice as buyPrice

    return [parseInt(id), { 
      ...rest, 
      vendorPrice: safeVendorPrice, 
      buyPrice,
      limitedStock: limitedStock === true ? true : undefined
    }];
  })
);

// Helper function to merge recipe item data into materialInfo
function mergeRecipeItems(items: Record<string, any>, itemType: string) {
  Object.entries(items).forEach(([id, val]) => {
    const itemId = parseInt(id);
    if (!materialInfo[itemId]) {
      // Determine icon based on item type
      let icon = 'inv_scroll_03'; // Default for formulas/enchanting
      if (itemType === 'engineering') icon = 'inv_scroll_05'; // Schematic
      else if (itemType === 'blacksmithing') icon = 'inv_scroll_06'; // Plans
      else if (itemType === 'leatherworking') icon = 'inv_scroll_04'; // Patterns
      else if (itemType === 'tailoring') icon = 'inv_scroll_04'; // Patterns
      else if (itemType === 'alchemy') icon = 'inv_scroll_03'; // Recipes
      
      materialInfo[itemId] = {
        name: `${itemType === 'engineering' ? 'Schematic' : itemType === 'blacksmithing' ? 'Plan' : itemType === 'leatherworking' || itemType === 'tailoring' ? 'Pattern' : 'Recipe'} #${id}`,
        quality: 1,
        class: 'Trade Goods',
        subclass: 'Recipe',
        icon,
        slot: '',
        link: `https://www.wowhead.com/classic/item=${id}`,
        buyPrice: val.buyPrice ?? undefined,
        vendorPrice: val.buyPrice ?? undefined,
        limitedStock: val.limitedStock,
        auctionhouse: val.auctionhouse,
        bop: val.bop
      };
    } else {
      // If the item already exists, just update the vendor-related fields
      materialInfo[itemId] = {
        ...materialInfo[itemId],
        buyPrice: val.buyPrice ?? materialInfo[itemId].buyPrice,
        vendorPrice: val.buyPrice ?? materialInfo[itemId].vendorPrice,
        limitedStock: val.limitedStock ?? materialInfo[itemId].limitedStock,
        auctionhouse: val.auctionhouse ?? materialInfo[itemId].auctionhouse,
        bop: val.bop ?? materialInfo[itemId].bop
      };
    }
  });
}

// Merge in all profession-specific recipe item data
mergeRecipeItems(enchantingItems, 'enchanting');
mergeRecipeItems(engineeringItems, 'engineering');
mergeRecipeItems(blacksmithingItems, 'blacksmithing');
mergeRecipeItems(leatherworkingItems, 'leatherworking');
mergeRecipeItems(tailoringItems, 'tailoring');
mergeRecipeItems(alchemyItems, 'alchemy');

export default materialInfo;