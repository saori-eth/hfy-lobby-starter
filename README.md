# Hyperfy V2 World Bootstrapper

Sets up local Hyperfy SDK projects from exported V2 world data.

## Prerequisites

- Node.js
- `sqlite3` CLI
- `unzip` CLI

## Usage

```bash
# Prompt for wallet address interactively
node main.mjs

# Download export for a specific wallet address
node main.mjs 0xABC...DEF

# Use a local zip file
node main.mjs path/to/export.zip

# Re-import into an existing project (run from inside the project directory)
node main.mjs --import-only
```

## What it does

1. **Downloads or locates** a V2 world export (zip containing a SQLite database and assets)
2. **Reads the manifest** to discover worlds in the export
3. **Scaffolds an SDK project** for each world via `npx gamedev@latest init`
4. **Imports world content:**
   - Extracts blueprints, entities, and config from the SQLite database
   - Copies model files and prop assets into `assets/`
   - Generates app directories under `apps/` with `index.js` scripts and JSON metadata
   - Writes `world.json` with settings, spawn point, and entity placements
5. **Post-setup:** bumps upload limits if needed, resets sync state, and adds an `import:v2` npm script

## Project structure (after setup)

```
my-world/
├── apps/
│   ├── $scene/
│   │   ├── $scene.json
│   │   └── index.js
│   └── SomeApp/
│       ├── SomeApp.json
│       └── index.js
├── assets/
│   ├── scene-model.glb
│   └── ...
├── hyperfy-export/
│   └── <original>.zip
└── world.json
```

## Re-importing

To re-run the import step on an existing project (e.g. after updating the export zip in `hyperfy-export/`):

```bash
cd my-world
npm run import:v2
```
