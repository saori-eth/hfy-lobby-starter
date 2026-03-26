# Hyperfy World Setup

You are helping a user set up a local Hyperfy world from their V2 export.

## Prerequisites

Node.js v22.11.0 must be installed. Also need `sqlite3` and `unzip` CLI tools.

## Steps

1. Create the working directory:

```bash
mkdir -p ~/lobby && cd ~/lobby
```

2. Download the bootstrapper script:

```bash
curl -O https://raw.githubusercontent.com/saori-eth/hfy-lobby-starter/refs/heads/main/main.mjs
```

3. Ask the user for their wallet address (0x-prefixed, 42 characters).

4. Run the script with their address:

```bash
node main.mjs --no-dev 0x<THEIR_ADDRESS>
```

The script will download their world export, scaffold the project, and install dependencies. Once complete, `cd` into the created world directory and run `npm run dev` to start the dev server at http://localhost:3000.
