"use strict";
(() => {
  const sources = Object.freeze({
    eth: "assets/chain-ethereum.svg", ethereum: "assets/chain-ethereum.svg", sepolia: "assets/chain-ethereum.svg",
    sol: "assets/solana.png", solana: "assets/solana.png", devnet: "assets/solana.png",
    usdc: "assets/asset-usdc.svg", btc: "assets/asset-btc.svg", usdt: "assets/asset-usdt.svg",
    lifi: "assets/provider-lifi.svg", "lifi-1inch": "assets/provider-lifi.svg", "lifi-jupiter": "assets/provider-lifi.svg",
    "lifi-relay-depository": "assets/provider-lifi.svg", "lifi-mayan": "assets/provider-lifi.svg",
    uniswap: "assets/provider-uniswap.svg", "uniswap-v3": "assets/provider-uniswap.svg",
    hinkal: "assets/hinkal.svg", "hinkal-lifi-1inch": "assets/hinkal.svg", "hinkal-solana": "assets/hinkal.svg"
  });
  function icon(value) {
    const source = sources[String(value).toLowerCase()];
    if (!source) return null;
    const image = document.createElement("img");
    image.src = source;
    image.alt = "";
    image.className = "asset-logo";
    image.setAttribute("aria-hidden", "true");
    return image;
  }
  window.DriveKeyAssets = Object.freeze({icon});
})();
