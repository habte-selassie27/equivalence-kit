import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  connectWallet,
  describeError,
  getEthereum,
  readRecord,
  readWallet,
  verifyOnChain,
  type TxState,
  type WalletState,
} from "./lib/genlayer";
import { CONTRACT_ADDRESS, GIST_URL, explorerAddress, explorerTx } from "./config";
import { friendlyReason } from "./messages";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ status: "disconnected" });
  const [connecting, setConnecting] = useState(false);
  const [username, setUsername] = useState("");
  const [gistId, setGistId] = useState("");
  const [tx, setTx] = useState<TxState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [card, setCard] = useState<Record<string, unknown> | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    const injected = getEthereum();
    if (!injected) {
      setWallet({ status: "no-provider" });
      return;
    }
    injected
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const address = (accounts as string[])?.[0];
        setWallet(address ? { status: "connected", address } : { status: "disconnected" });
      })
      .catch(() => setWallet({ status: "disconnected" }));
  }, []);

  const proof = useMemo(
    () => (wallet.address ? `gitproof:${wallet.address.toLowerCase()}` : ""),
    [wallet.address],
  );

  const connect = async () => {
    setConnecting(true);
    try {
      setWallet(await connectWallet());
    } finally {
      setConnecting(false);
    }
  };

  const copyProof = async () => {
    if (!proof) return;
    try {
      await navigator.clipboard.writeText(proof);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const runVerify = async () => {
    if (!wallet.address || !username.trim() || !gistId.trim() || busy) return;
    setBusy(true);
    setTx({ phase: "signing" });
    try {
      const final = await verifyOnChain(username.trim(), gistId.trim(), setTx);
      if (final.phase === "finalized") {
        try {
          const record = await readRecord(wallet.address);
          if (record && Object.keys(record).length > 0) setCard(record);
        } catch {
          // The write landed; the read-back is a convenience.
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const runLookup = async () => {
    const value = query.trim();
    if (!value || looking) return;
    setLooking(true);
    setLookupError(null);
    setCard(null);
    try {
      const walletAddress = ADDRESS_RE.test(value) ? value : await readWallet(value);
      const record = walletAddress ? await readRecord(walletAddress) : null;
      if (!record || Object.keys(record).length === 0) {
        setLookupError(`No verified record for ${value}.`);
      } else {
        setCard(record);
      }
    } catch (error) {
      setLookupError(describeError(error));
    } finally {
      setLooking(false);
    }
  };

  const tier = card ? String(card.tier ?? "") : "";
  const verifiedAt = card ? Number(card.verified_at ?? 0) : 0;

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <span className="mark">G</span>
          <span>GitProof</span>
          <span className="chip">StudioNet</span>
        </div>
        <div>
          {wallet.status === "connected" && wallet.address ? (
            <span className="connected" title={wallet.address}>
              <span className="dot" /> {short(wallet.address)}
            </span>
          ) : (
            <button className="button" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </header>

      <main>
        <section className="hero">
          <h1>Prove your GitHub. Own your reputation.</h1>
          <p>
            A public gist and a GenLayer contract bind your wallet to your GitHub account —
            no OAuth, no backend. Validators fetch GitHub live and agree on a developer tier.
          </p>
          <p className="small muted">
            Contract{" "}
            <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
              {short(CONTRACT_ADDRESS)}
            </a>{" "}
            · reads need no wallet.
          </p>
        </section>

        {wallet.status === "no-provider" && (
          <p className="notice">No browser wallet detected. Install or unlock one to verify.</p>
        )}
        {wallet.status === "wrong-network" && (
          <p className="notice">Switch your wallet to StudioNet and try again.</p>
        )}

        <section className="panel">
          <div className="panel-head">
            <h2>1. Verify</h2>
            <span className="step">Write</span>
          </div>
          <ol className="steps">
            <li>
              Create a <strong>public</strong> gist at{" "}
              <a href={GIST_URL} target="_blank" rel="noreferrer">
                gist.github.com
              </a>{" "}
              with one line: <code>{proof || "gitproof:<your wallet address>"}</code>
            </li>
            <li>Enter your GitHub username and the gist ID below.</li>
            <li>Click Verify and approve the transaction in your wallet.</li>
          </ol>

          <div className="actions">
            <button className="button" onClick={copyProof} disabled={!proof}>
              {copied ? "Copied" : "Copy proof line"}
            </button>
            <a className="button ghost" href={GIST_URL} target="_blank" rel="noreferrer">
              Create a gist
            </a>
          </div>

          <div className="form">
            <label>
              GitHub username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="octocat"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              Gist ID
              <input
                value={gistId}
                onChange={(event) => setGistId(event.target.value)}
                placeholder="f73e0e3eb9ddf87d5c9625d46cdc745c"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>

          <button
            className="button primary wide"
            onClick={runVerify}
            disabled={busy || !wallet.address || !username.trim() || !gistId.trim()}
          >
            {busy ? "Verifying…" : "Verify"}
          </button>

          {tx.phase !== "idle" && (
            <div className="tx">
              <TxRow
                label="Signature"
                done={tx.phase !== "signing"}
                detail={tx.phase === "signing" ? "Confirm in your wallet." : "Signed."}
              />
              <TxRow
                label="Transaction"
                done={Boolean(tx.hash)}
                detail={
                  tx.hash ? (
                    <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">
                      {short(tx.hash)} ↗
                    </a>
                  ) : (
                    "Waiting for the wallet."
                  )
                }
              />
              <TxRow
                label="Consensus"
                done={tx.phase === "finalized" || tx.phase === "failed"}
                detail={tx.status ?? "Validators are voting; this can take a minute."}
              />
              <TxRow
                label="Result"
                done={tx.phase === "finalized" || tx.phase === "failed"}
                detail={
                  tx.phase === "finalized"
                    ? "Verified and stored on StudioNet."
                    : tx.phase === "failed"
                      ? tx.reason
                        ? `${tx.reason}: ${friendlyReason(tx.reason)}`
                        : tx.error ?? "Rejected."
                      : "Pending."
                }
                error={tx.phase === "failed"}
              />
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>2. Look up</h2>
            <span className="step">Read</span>
          </div>
          <p className="small muted">Enter a wallet address or a GitHub username.</p>
          <div className="lookup">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runLookup();
              }}
              placeholder="0x… or octocat"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="button" onClick={runLookup} disabled={looking || !query.trim()}>
              {looking ? "Reading…" : "Look up"}
            </button>
          </div>

          {lookupError && <p className="notice">{lookupError}</p>}
          {card && (
            <article className="card">
              <div>
                <div className="handle">@{String(card.github ?? "")}</div>
                <div className={`tier ${tier.toLowerCase()}`}>{tier}</div>
              </div>
              <div className="meta">
                <span>Wallet {short(String(card.wallet ?? ""))}</span>
                <span>
                  Verified{" "}
                  {verifiedAt > 0 ? new Date(verifiedAt * 1000).toLocaleDateString() : "—"}
                </span>
              </div>
            </article>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>GitProof · StudioNet</span>
        <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
          {short(CONTRACT_ADDRESS)}
        </a>
      </footer>
    </div>
  );
}

function TxRow(props: {
  label: string;
  done: boolean;
  detail: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={`tx-row ${props.error ? "error" : ""}`}>
      <span className={`tx-dot ${props.done ? "done" : ""}`} />
      <div>
        <strong>{props.label}</strong>
        <p>{props.detail}</p>
      </div>
    </div>
  );
}
