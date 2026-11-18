# Agent Stamp — static site

Free daily stamp NFT for Binance Agent ID holders (BNB Smart Chain).
Static only: `index.html` + `app.js` + `style.css` + `agent-stamp-abi.json`.
No backend, no server session, no login. Your wallet is your identity.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure (connect, mint, streak, stats, leaderboard, footer) |
| `app.js` | All logic: connect, chain switch, Agent ID check, mint, streak, leaderboard |
| `style.css` | Dark, mobile-first styling, no framework |
| `agent-stamp-abi.json` | AgentStamp contract ABI (exact functions/events from the spec) |

## Deploy the contract address (one-line change)

In `app.js`, replace the placeholder:

```js
// GANTI SETELAH DEPLOY — replace this with the deployed AgentStamp address.
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000";
```

with the deployed address, e.g.:

```js
const CONTRACT_ADDRESS = "0xAbC...";
```

That's the only change needed. The footer BscScan link updates automatically
from the same constant, and the "not deployed yet" notice disappears.
The Agent ID contract address (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`)
and the BSC public RPC (`https://bsc-dataseed.bnbchain.org`) are already set.

## Serve / test locally

```bash
cd ~/workspace/agent-id-hackathon/site
python3 -m http.server 8000
# open http://localhost:8000 in a browser
```

Or any static server (`npx serve`, `node --run`, etc.). No build step.

What to check:
1. Page renders, no console errors.
2. "Connect Wallet" button is visible.
3. Stats/leaderboard load from the BSC public RPC — while the contract is
   still a placeholder, they show a friendly "not deployed yet" message
   instead of crashing.
4. With a wallet (Binance Wallet / MetaMask app browser): connect, verify the
   Agent ID status, switch chain if prompted, and mint (free, gas only,
   value 0 — you confirm in your own wallet).

## Static hosting

Upload the four files as-is to any static host (GitHub Pages, Vercel,
Netlify, Cloudflare Pages, IPFS gateway, or plain nginx). No environment
variables, no server code, no build command.

## Safety notes

- Mint calls `mint()` with value 0 only. The user confirms every transaction
  in their own wallet; the site never bypasses that confirmation.
- The site never asks for a seed phrase or private key.
- No "passive income" or return promises anywhere on the page.
