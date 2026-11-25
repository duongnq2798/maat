// EIP-6963 (multi injected provider discovery): wallets announce themselves on window, so no global is guessed at and no
// wallet library is needed.

/** The EIP-1193 surface /ask uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface InjectedWallet {
  info: WalletInfo;
  provider: Eip1193Provider;
}

const ANNOUNCE = "eip6963:announceProvider";
const REQUEST = "eip6963:requestProvider";

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** The announcement's wallet, or null when it is not one: a page or an extension can dispatch anything. */
function walletOf(detail: unknown): InjectedWallet | null {
  if (detail === null || typeof detail !== "object") return null;
  const { info, provider } = detail as { info?: Partial<WalletInfo>; provider?: Partial<Eip1193Provider> };
  if (!info || !isText(info.uuid, 128) || !isText(info.name, 64) || typeof info.rdns !== "string") return null;
  if (!provider || typeof provider.request !== "function") return null;
  return { info: { uuid: info.uuid, name: info.name, icon: typeof info.icon === "string" ? info.icon : "", rdns: info.rdns }, provider: provider as Eip1193Provider };
}

/**
 * Listens for wallet announcements, then asks every wallet to announce itself. `onChange` gets the whole list each time a
 * new wallet arrives, in arrival order, one entry per uuid. Returns the function that stops listening.
 */
export function watchWallets(target: Window, onChange: (wallets: InjectedWallet[]) => void): () => void {
  const wallets = new Map<string, InjectedWallet>();
  const onAnnounce = (e: Event) => {
    const w = walletOf((e as CustomEvent).detail);
    if (!w || wallets.has(w.info.uuid)) return;
    wallets.set(w.info.uuid, w);
    onChange([...wallets.values()]);
  };
  target.addEventListener(ANNOUNCE, onAnnounce);
  target.dispatchEvent(new Event(REQUEST));
  return () => target.removeEventListener(ANNOUNCE, onAnnounce);
}
