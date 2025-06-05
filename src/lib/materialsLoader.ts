import rawMaterials from '@/data/materials/materials.json';
import enchantingItems from '@/data/recipes/enchanting_items.json';
import { MaterialInfo } from './types';

// First process the main materials
const materialInfo: Record<number, MaterialInfo> = Object.fromEntries(
  Object.entries(rawMaterials).map(([id, val]) => {
    const { vendorPrice, ...rest } = val;
    const safeVendorPrice = typeof vendorPrice === "number" ? vendorPrice : undefined;
    const buyPrice = safeVendorPrice; // Use vendorPrice as buyPrice

    return [parseInt(id), { ...rest, vendorPrice: safeVendorPrice, buyPrice }];
  })
);

// Then merge in enchanting items data
Object.entries(enchantingItems).forEach(([id, val]) => {
  const itemId = parseInt(id);
  if (!materialInfo[itemId]) {
    materialInfo[itemId] = {
      name: `Formula #${id}`, // Basic name since we don't have the full item data
      quality: 1,
      class: 'Trade Goods',
      subclass: 'Recipe',
      icon: 'inv_scroll_03',
      slot: '',
      link: `https://www.wowhead.com/classic/item=${id}`,
      buyPrice: val.buyPrice ?? undefined,
      vendorPrice: val.buyPrice ?? undefined,
      limitedStock: val.limitedStock,
      auctionhouse: val.auctionhouse
    };
  } else {
    // If the item already exists, just update the vendor-related fields
    materialInfo[itemId] = {
      ...materialInfo[itemId],
      buyPrice: val.buyPrice ?? materialInfo[itemId].buyPrice,
      vendorPrice: val.buyPrice ?? materialInfo[itemId].vendorPrice,
      limitedStock: val.limitedStock,
      auctionhouse: val.auctionhouse
    };
  }
});

export default materialInfo;