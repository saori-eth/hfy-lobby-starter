# Hyperfy V2 World Bootstrapper

Sets up local Hyperfy SDK projects from exported V2 world data.

## Prerequisites

- Node.js v22.11.0
- `sqlite3` CLI
- `unzip` CLI

## Usage

```bash
node main.mjs 0xABC...DEF          # download + scaffold from wallet address
node main.mjs path/to/export.zip   # use a local zip
node main.mjs                      # interactive prompt for address
node main.mjs --no-dev 0xABC...    # setup only, don't start dev server
node main.mjs --import-only        # re-import in existing project (run from project dir)
```

The script scaffolds the SDK, imports all world data, syncs it, and launches `npm run dev` automatically. If the export contains multiple worlds, you'll be prompted to pick one.

## Re-importing

```bash
cd my-world && npm run import:v2
```
