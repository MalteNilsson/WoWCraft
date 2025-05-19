// src/lib/utils.tsx
import React from 'react';

type MoneyProps = {
  /** total value in copper */
  copper: number;
};

export function FormatMoney({ copper }: { copper: number }) {
  // break down into g/s/c
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;

  // render strings, padding silver & copper to two digits
  const goldStr   = `${g}g`;
  const silverStr = `${s.toString().padStart(2, "0")}s`;
  const copperStr = `${c.toString().padStart(2, "0")}c`;

  return (
    <span className="inline-flex items-baseline">
      {/* Reserve 4ch for gold (e.g. up to "9999g") */}
      <span
        className="text-yellow-400 text-right"
        style={{ minWidth: "4ch" }}
      >
        {goldStr}
      </span>

      {/* Reserve 3ch for silver ("00s" … "99s") */}
      <span
        className="text-gray-300 text-right ml-0.5"
        style={{ minWidth: "3ch" }}
      >
        {silverStr}
      </span>

      {/* Reserve 3ch for copper ("00c" … "99c") */}
      <span
        className="text-orange-400 text-right ml-0.5"
        style={{ minWidth: "3ch" }}
      >
        {copperStr}
      </span>
    </span>
  );
}