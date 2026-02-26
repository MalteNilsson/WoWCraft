# WoWCraft

A crafting planner and leveling guide for World of Warcraft Classic. WoWCraft calculates cost-effective profession leveling routes, material requirements, and skill progression paths using auction house data and vendor pricing.

## Overview

WoWCraft helps players optimize profession leveling by finding the most efficient crafting sequences based on skill-up probabilities, material costs, and available price data. It supports both Vanilla (skill 1–300) and The Burning Crusade (skill 1–375).

**Live site:** [wowcraft.io](https://wowcraft.io)

## Supported Professions

- Alchemy
- Blacksmithing
- Enchanting
- Engineering
- Jewelcrafting (TBC only)
- Leatherworking
- Tailoring

## Features

- **Dynamic route planning** – Calculates optimal crafting sequences using backward dynamic programming
- **Multiple price sources** – Cost mode, vendor price, disenchant value, or auction house prices
- **Realm and faction support** – Price data from multiple realms and regions (NA/EU)
- **Material trees** – Nested crafting requirements with vendor vs. craft cost analysis
- **Skill progression charts** – Visual difficulty zones and expected crafts per skill level
- **Alternative recipes** – Compare alternative steps per level range

## Technology Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS 4
- Recharts
- Framer Motion

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm, yarn, pnpm, or bun

### Installation

```bash
git clone https://github.com/MalteNilsson/WoWCraft.git
cd WoWCraft
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app redirects to the Enchanting planner by default.

### Production Build

```bash
npm run build
npm start
```

### Price Data

The app includes bundled price data for several realms. To fetch fresh data from the TSM API:

```bash
npm run tsm:fetch
```

Requires a TSM API access token. See `src/scripts/get_TSM_data.mjs` for configuration.

## Project Structure

```
src/
  app/           # Next.js App Router pages and layout
  data/          # Recipe data, price data, realm config
  lib/           # Planner logic, recipe calculations, utilities
  scripts/       # Scrapers and data fetch scripts
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

Report bugs or request features via [GitHub Issues](https://github.com/MalteNilsson/WoWCraft/issues).

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- TSM for their pricing API
- WoWHead for recipe and item data
- WoW Classic community for feedback and testing

---

*Not affiliated with Blizzard Entertainment. World of Warcraft is a registered trademark of Blizzard Entertainment.*
