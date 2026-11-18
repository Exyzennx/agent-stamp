/* Agent Stamp — vanilla JS + ethers v6 (CDN). No backend, no server session.
 * The user's wallet is the only identity. Nothing here asks for a seed phrase
 * or private key — ever. Minting always waits for the user's own confirmation
 * in their wallet. */

"use strict";

// Deployed 2026-11-18 ~22:05 WIB dari Wallet Airdrop, tx 0x455d942680aead7d6ee344ebfa02a5b57acaaf794a6d298b09c7facdac03c508.
const CONTRACT_ADDRESS = "0x071e1689B69cA831dE56250D52f911ae95a01812";
const AGENT_ID_ADDRESS = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
const BSC_CHAIN_ID = 56; // BNB Smart Chain
const BSC_RPC_URL = "https://bsc-dataseed.bnbchain.org";
const BSCSCAN_TX = "https://bscscan.com/tx/";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BOARD_REFRESH_MS = 30000;

const isDeployed = CONTRACT_ADDRESS.toLowerCase() !== ZERO_ADDRESS;

// Minimal ABI for the Agent ID check (ERC-721 balanceOf only).
const AGENT_ID_ABI = ["function balanceOf(address account) view returns (uint256)"];

// Full AgentStamp ABI, loaded from agent-stamp-abi.json (same folder).
let STAMP_ABI = null;

const $ = (id) => document.getElementById(id);
const els = {
  connectBtn: $("connectBtn"),
  switchChainBtn: $("switchChainBtn"),
  noWalletBox: $("noWalletBox"),
  wrongChainBox: $("wrongChainBox"),
  deployNotice: $("deployNotice"),
  statusLine: $("statusLine"),
  walletAddress: $("walletAddress"),
  networkName: $("networkName"),
  agentIdStatus: $("agentIdStatus"),
  notHolderNote: $("notHolderNote"),
  mintBtn: $("mintBtn"),
  alreadyMinted: $("alreadyMinted"),
  countdown: $("countdown"),
  txStatus: $("txStatus"),
  mintResult: $("mintResult"),
  todayDate: $("todayDate"),
  currentStreak: $("currentStreak"),
  bestStreak: $("bestStreak"),
  lastMintDay: $("lastMintDay"),
  totalMinted: $("totalMinted"),
  leaderboardBody: $("leaderboardBody"),
  boardNote: $("boardNote"),
  refreshBoardBtn: $("refreshBoardBtn"),
  contractLink: $("contractLink"),
};

// Public read-only provider — used for stats/leaderboard without a wallet.
const readProvider = new ethers.JsonRpcProvider(BSC_RPC_URL);
let stampRead = null;   // read-only AgentStamp contract (null until ABI + deploy)
let browserProvider = null;
let signer = null;
let account = null;
let isHolder = false;
let canMint = false;
let countdownTimer = null;

function shortAddress(addr) {
  return addr ? addr.slice(0, 6) + "..." + addr.slice(-4) : "—";
}

function setStatus(msg) { els.statusLine.textContent = msg; }

function dayNumberToDateUTC(day) {
  if (!day || Number(day) === 0) return "Never";
  const d = new Date(Number(day) * 86400 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function msToNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next - now;
}

function startCountdown() {
  stopCountdown();
  const tick = () => {
    const ms = msToNextUtcMidnight();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    els.countdown.textContent =
      String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

async function loadAbi() {
  try {
    const res = await fetch("agent-stamp-abi.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    STAMP_ABI = await res.json();
  } catch (err) {
    console.error("Failed to load agent-stamp-abi.json:", err);
    setStatus("Could not load the contract ABI. Please reload the page.");
    return false;
  }
  return true;
}

// ---------- Public reads (work without a wallet) ----------

async function refreshStats() {
  if (!stampRead) {
    els.totalMinted.textContent = "—";
    return;
  }
  try {
    const total = await stampRead.totalMinted();
    els.totalMinted.textContent = total.toString();
  } catch (err) {
    console.error("totalMinted failed:", err);
    els.totalMinted.textContent = "—";
    els.boardNote.textContent = "Could not load on-chain data right now. Please try again later.";
  }
}

async function refreshBoard() {
  if (!stampRead) {
    els.leaderboardBody.innerHTML =
      '<tr><td colspan="3" class="empty">Contract not deployed yet — leaderboard will appear after deployment.</td></tr>';
    return;
  }
  try {
    const [addrs, streaks] = await stampRead.topBoard();
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const addr = addrs[i];
      const streak = streaks[i];
      if (!addr || addr.toLowerCase() === ZERO_ADDRESS || Number(streak) === 0) continue;
      const me = account && addr.toLowerCase() === account.toLowerCase();
      rows.push(
        "<tr" + (me ? ' class="me"' : "") + "><td>" + (rows.length + 1) + "</td><td>" +
        shortAddress(addr) + (me ? " (you)" : "") + "</td><td>" + streak.toString() + "</td></tr>"
      );
    }
    els.leaderboardBody.innerHTML = rows.length
      ? rows.join("")
      : '<tr><td colspan="3" class="empty">No stamps yet — be the first to mint.</td></tr>';
    els.boardNote.textContent = "";
  } catch (err) {
    console.error("topBoard failed:", err);
    els.leaderboardBody.innerHTML =
      '<tr><td colspan="3" class="empty">Could not load the leaderboard right now. Tap Refresh to try again.</td></tr>';
  }
}

// ---------- Wallet ----------

async function connectWallet() {
  if (!window.ethereum) {
    els.noWalletBox.hidden = false;
    setStatus("No wallet detected. Open this page in the Binance Wallet or MetaMask app.");
    return;
  }
  els.noWalletBox.hidden = true;
  try {
    setStatus("Waiting for wallet approval…");
    browserProvider = new ethers.BrowserProvider(window.ethereum);
    await browserProvider.send("eth_requestAccounts", []);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    els.connectBtn.textContent = shortAddress(account);
    await afterConnect();
  } catch (err) {
    console.error("Connect failed:", err);
    setStatus("Connection cancelled or failed. Tap Connect Wallet to try again.");
  }
}

async function afterConnect() {
  const network = await browserProvider.getNetwork();
  const chainId = Number(network.chainId);
  els.walletAddress.textContent = shortAddress(account);
  els.networkName.textContent = chainId === BSC_CHAIN_ID
    ? "BNB Smart Chain (56)"
    : "Chain " + chainId + " (not BSC)";
  els.wrongChainBox.hidden = chainId === BSC_CHAIN_ID;

  if (chainId !== BSC_CHAIN_ID) {
    setStatus("Please switch to BNB Smart Chain (Chain 56) to mint.");
    updateMintButton();
    return;
  }
  await refreshAccountState();
}

async function switchChain() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x38" }], // 56
    });
  } catch (err) {
    console.error("Switch chain failed:", err);
    if (err && err.code === 4902) {
      setStatus("BSC is not added to this wallet. Please add BNB Smart Chain (Chain 56) manually.");
    } else {
      setStatus("Chain switch cancelled. Stay on BNB Smart Chain to mint.");
    }
  }
}

async function refreshAccountState() {
  if (!account) return;
  els.agentIdStatus.textContent = "Checking…";
  els.agentIdStatus.className = "";
  isHolder = false;
  canMint = false;

  // 1) Agent ID holder check (live contract, always readable).
  try {
    const agentId = new ethers.Contract(AGENT_ID_ADDRESS, AGENT_ID_ABI, readProvider);
    const bal = await agentId.balanceOf(account);
    isHolder = bal > 0n;
    els.agentIdStatus.textContent = isHolder ? "Yes — holder ✓" : "No Agent ID";
    els.agentIdStatus.className = isHolder ? "ok" : "bad";
    els.notHolderNote.hidden = isHolder;
  } catch (err) {
    console.error("Agent ID balanceOf failed:", err);
    els.agentIdStatus.textContent = "Could not check — try again";
    els.agentIdStatus.className = "bad";
  }

  // 2) Streak + mint eligibility (needs the deployed AgentStamp contract).
  if (stampRead) {
    try {
      const [cur, best, lastDay] = await stampRead.streakOf(account);
      els.currentStreak.textContent = cur.toString();
      els.bestStreak.textContent = best.toString();
      els.lastMintDay.textContent = dayNumberToDateUTC(lastDay);
    } catch (err) {
      console.error("streakOf failed:", err);
      els.currentStreak.textContent = "—";
      els.bestStreak.textContent = "—";
      els.lastMintDay.textContent = "—";
    }
    try {
      canMint = await stampRead.canMintToday(account);
    } catch (err) {
      console.error("canMintToday failed:", err);
      canMint = false;
    }
  } else {
    els.currentStreak.textContent = "—";
    els.bestStreak.textContent = "—";
    els.lastMintDay.textContent = "—";
  }

  updateMintButton();
  await refreshBoard(); // highlight "you" row if present

  if (!isDeployed) {
    setStatus("Connected as " + shortAddress(account) + ". Contract not deployed yet — minting is disabled.");
  } else if (!isHolder) {
    setStatus("Connected. This wallet holds no Agent ID, so it cannot mint.");
  } else if (!canMint) {
    setStatus("Connected. You already minted today — come back tomorrow.");
  } else {
    setStatus("Connected. You can mint today's stamp — it's free (gas only).");
  }
}

function updateMintButton() {
  const onBsc = els.wrongChainBox.hidden;
  if (!account) {
    els.mintBtn.disabled = true;
    els.alreadyMinted.hidden = true;
    stopCountdown();
    return;
  }
  if (isHolder && canMint && onBsc && isDeployed) {
    els.mintBtn.disabled = false;
    els.alreadyMinted.hidden = true;
    stopCountdown();
  } else {
    els.mintBtn.disabled = true;
    if (isHolder && !canMint && onBsc && isDeployed) {
      els.alreadyMinted.hidden = false;
      startCountdown();
    } else {
      els.alreadyMinted.hidden = true;
      stopCountdown();
    }
  }
}

// ---------- Mint ----------

async function mintStamp() {
  if (!signer || !account || !stampRead) return;
  if (!isHolder || !canMint) return; // button state is the guard; never bypass it
  els.mintBtn.disabled = true;
  els.mintResult.hidden = true;
  els.txStatus.textContent = "";
  try {
    // User confirms this transaction in their own wallet. value = 0 (free mint).
    const stamp = new ethers.Contract(CONTRACT_ADDRESS, STAMP_ABI, signer);
    const tx = await stamp.mint(); // no value sent
    els.txStatus.innerHTML =
      'Transaction submitted — <a href="' + BSCSCAN_TX + tx.hash + '" target="_blank" rel="noopener">view on BscScan</a>. Waiting for confirmation…';
    const receipt = await tx.wait();
    // tokenId comes from the StampMinted event in the receipt — never guessed.
    let tokenId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = stamp.interface.parseLog(log);
        if (parsed && parsed.name === "StampMinted") { tokenId = parsed.args.tokenId; break; }
      } catch (_) { /* log belongs to another contract — ignore */ }
    }
    els.txStatus.innerHTML =
      'Confirmed ✓ — <a href="' + BSCSCAN_TX + tx.hash + '" target="_blank" rel="noopener">view on BscScan</a>';
    els.mintResult.hidden = false;
    els.mintResult.textContent = tokenId !== null
      ? "Stamp minted! Token ID: " + tokenId.toString()
      : "Stamp minted! (Token ID not found in receipt — check BscScan.)";
    setStatus("Stamp minted for today. See you tomorrow!");
    await refreshAccountState();
    await refreshStats();
  } catch (err) {
    console.error("Mint failed:", err);
    if (err && (err.code === "ACTION_REJECTED" || err.code === 4001)) {
      els.txStatus.textContent = "Transaction rejected in your wallet. Nothing was minted.";
    } else {
      els.txStatus.textContent = "Mint failed: " + (err && err.shortMessage ? err.shortMessage : (err && err.message ? err.message : "unknown error"));
    }
    updateMintButton();
  }
}

// ---------- Init ----------

async function init() {
  els.todayDate.textContent = new Date().toISOString().slice(0, 10) + " (UTC)";
  els.contractLink.textContent = CONTRACT_ADDRESS;
  els.contractLink.href = "https://bscscan.com/address/" + CONTRACT_ADDRESS;

  if (!isDeployed) {
    els.deployNotice.hidden = false;
  }

  if (!window.ethereum) {
    els.noWalletBox.hidden = false;
  }

  const abiOk = await loadAbi();
  if (abiOk && isDeployed) {
    stampRead = new ethers.Contract(CONTRACT_ADDRESS, STAMP_ABI, readProvider);
  }

  // Public data loads even without a wallet; errors are handled inside.
  await refreshStats();
  await refreshBoard();
  setInterval(async () => { await refreshStats(); await refreshBoard(); }, BOARD_REFRESH_MS);

  els.connectBtn.addEventListener("click", connectWallet);
  els.switchChainBtn.addEventListener("click", switchChain);
  els.mintBtn.addEventListener("click", mintStamp);
  els.refreshBoardBtn.addEventListener("click", async () => {
    els.refreshBoardBtn.disabled = true;
    await refreshStats();
    await refreshBoard();
    els.refreshBoardBtn.disabled = false;
  });

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", async (accounts) => {
      if (!accounts || accounts.length === 0) {
        account = null; signer = null; isHolder = false; canMint = false;
        els.connectBtn.textContent = "Connect Wallet";
        els.walletAddress.textContent = "—";
        els.networkName.textContent = "—";
        els.agentIdStatus.textContent = "—";
        els.notHolderNote.hidden = true;
        setStatus("Wallet disconnected. Connect your wallet to check your Agent ID.");
        updateMintButton();
      } else {
        account = accounts[0];
        signer = await browserProvider.getSigner();
        els.connectBtn.textContent = shortAddress(account);
        await afterConnect();
      }
    });
    window.ethereum.on("chainChanged", async () => { await afterConnect(); });
  }
}

document.addEventListener("DOMContentLoaded", init);
