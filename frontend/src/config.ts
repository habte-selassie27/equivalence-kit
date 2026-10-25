export const CONTRACT_ADDRESS =
  "0x779eC676925D2d884f42b6398e622600aBa92e2e" as const;
export const NETWORK = "studionet";
export const EXPLORER = "https://explorer-studio.genlayer.com";
export const GIST_URL = "https://gist.github.com/";

export function explorerTx(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER}/address/${address}`;
}
