/*  Difficulty stays exactly the same  */
export type Difficulty = {
    orange: number | null;
    yellow: number | null;
    green:  number | null;
    gray:   number | null;
  };
  
  /*  NEW – describes the JSON before cleanup.
      Some quantities may be undefined. */
  export type RawRecipe = {
    id:         number;
    name:       string;
    minSkill:   number;
    difficulty: Difficulty;
    /** qty may be number | undefined in the raw file */
    materials:  Record<string, number | undefined>;
  };
  
  /*  Your existing clean shape – AFTER you drop undefineds. */
  export type Recipe = Omit<RawRecipe, "materials"> & {
    materials: Record<string, number>;   // numbers only
  };
  
  /*  unchanged */
  export type PriceMap = Record<
    string,
    { minBuyout?: number; marketValue?: number }
  >;