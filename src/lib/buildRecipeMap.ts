import { RawRecipe } from "./types";

export type RecipeMap = Record<number, {
  itemId: number;
  makes: number;
  materials: Record<number, number>;
}>;

export function buildRecipeMap(rawRecipes: RawRecipe[]): RecipeMap {
  const map: RecipeMap = {};

  for (const raw of rawRecipes) {
    if (!raw.produces?.id) continue;

    const cleanedMaterials: Record<number, number> = {};
    for (const [idStr, qty] of Object.entries(raw.materials)) {
      if (qty !== undefined) cleanedMaterials[parseInt(idStr)] = qty;
    }

    map[raw.produces.id] = {
      itemId: raw.produces.id,
      makes: raw.produces.quantity ?? 1,
      materials: cleanedMaterials,
    };
  }

  return map;
}