import rawMaterials from '@/data/materials/materials.json';
import { MaterialInfo } from './types';

const materialInfo: Record<number, MaterialInfo> = Object.fromEntries(
  Object.entries(rawMaterials).map(([id, val]) => {
    const { vendorPrice, ...rest } = val;
    const safeVendorPrice = typeof vendorPrice === "number" ? vendorPrice : undefined;

    return [parseInt(id), { ...rest, vendorPrice: safeVendorPrice }];
  })
);

export default materialInfo;