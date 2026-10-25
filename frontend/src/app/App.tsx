import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { packageVersion } from "../data/load";
import { engine, type EngineProgress, type EngineStatus } from "../worker/engine";
import { bootProgressLabel, engineFailureMessage } from "../lib/engineMessages";
import { useSlowBoot } from "../lib/useSlowBoot";
import { applyTheme, getThemeSetting, nextThemeSetting, subscribeSystemTheme, type ThemeSetting } from "../lib/theme";
import { ThemeToggle } from "../components/ThemeToggle";
import { WalletButton } from "../components/WalletButton";
import { HomeScreen } from "../screens/Home/HomeScreen";
import { PatternsScreen } from "../screens/Patterns/PatternsScreen";
import { PlaygroundScreen } from "../screens/Playground/PlaygroundScreen";
import { TightnessScreen } from "../screens/Tightness/TightnessScreen";
import { AuditScreen } from "../screens/Audit/AuditScreen";
import { DecisionGuideScreen } from "../screens/DecisionGuide/DecisionGuideScreen";
import { BuilderScreen } from "../screens/Builder/BuilderScreen";
import { DevelopersGuideScreen } from "../screens/DevelopersGuide/DevelopersGuideScreen";
import { LiveScreen } from "../screens/Live/LiveScreen";

/** The official Equivalence Principle page. Linked from the footer per UI.md 6. */
const EQUIVALENCE_DOCS_URL =
  "https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle";

function EngineStatusLine({
  status,
  progress,
}: {
  status: EngineStatus;
  progress: EngineProgress | null;
}) {
  // After 12 s of loading, say why: a first visit downloads the engine files.
  const slowBoot = useSlowBoot(status === "loading");
  const label =
    status === "ready"
      ? `Engine ready — equivalencekit ${packageVersion}`
      : status === "loading"
        ? slowBoot
          ? `${bootProgressLabel(progress)} (slow connection)`
          : bootProgressLabel(progress)
        : status === "failed"
          ? "Engine unavailable"
          : "Engine idle";

  return (
    <span
      className="engine-status"
      data-status={status}
      title={
        status === "failed"
          ? engineFailureMessage(engine.getLastError())
          : status === "loading"
            ? "The first visit downloads about 13 MB of engine files from this site."
            : undefined
      }
    >
      <span
        className="engine-dot"
        aria-hidden="true"
        data-status={status}
      />
      {label}
      {status === "failed" ? (
        <button
          type="button"
          className="engine-retry"
          onClick={() => {
            void engine.retry();
          }}
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}

export function App() {
  const [status, setStatus] = useState<EngineStatus>(engine.getStatus());
  const [progress, setProgress] = useState<EngineProgress | null>(engine.getProgress());
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(() => getThemeSetting());

  useEffect(() => engine.onStatus(setStatus), []);
  useEffect(() => engine.onProgress(setProgress), []);

  // Warm the engine up as soon as the shell mounts, so the status line shows
  // "Loading the engine" and then "Engine ready" while the first screen is usable.
  useEffect(() => {
    void engine.warmUp();
  }, []);

  // The theme: stamp the attribute on every change, and re-stamp when the OS
  // preference changes while the setting is "auto". The inline bootstrap in
  // index.html already stamped it before first paint; this keeps it in step.
  useEffect(() => {
    applyTheme(themeSetting);
  }, [themeSetting]);

  useEffect(() => {
    return subscribeSystemTheme(() => applyTheme(getThemeSetting()));
  }, []);

  const cycleTheme = () => {
    setThemeSetting((current) => nextThemeSetting(current));
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="brand">
            EquivalenceKit
            <small>Tested equivalence patterns for GenLayer contracts</small>
          </NavLink>
          <nav className="nav" aria-label="Primary">
            <NavLink to="/patterns">Patterns</NavLink>
            <NavLink to="/playground">Playground</NavLink>
            <NavLink to="/audit">Audit</NavLink>
            <NavLink to="/live">Live</NavLink>
            <NavLink to="/tightness">Tightness</NavLink>
            <NavLink to="/builder">Builder</NavLink>
            <NavLink to="/guide">Decision guide</NavLink>
            <NavLink to="/developing">Developer's guide</NavLink>
          </nav>
          <div className="header-controls">
            <WalletButton />
            <ThemeToggle setting={themeSetting} onCycle={cycleTheme} />
            <EngineStatusLine status={status} progress={progress} />
          </div>
        </div>
      </header>

      <main id="main" className="app-main">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/patterns" element={<PatternsScreen />} />
          <Route path="/playground" element={<PlaygroundScreen />} />
          <Route path="/audit" element={<AuditScreen />} />
          <Route path="/live" element={<LiveScreen />} />
          <Route path="/tightness" element={<TightnessScreen />} />
          <Route path="/builder" element={<BuilderScreen />} />
          <Route path="/guide" element={<DecisionGuideScreen />} />
          <Route path="/developing" element={<DevelopersGuideScreen />} />
          <Route
            path="*"
            element={
              <div className="panel">
                <h2>That page doesn&apos;t exist</h2>
                <p>Choose one from the navigation above.</p>
              </div>
            }
          />
        </Routes>
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>
            These rules show how validators agree. They do not check whether content is
            true.
          </span>
          <span className="footer-links">
            <a href={EQUIVALENCE_DOCS_URL} target="_blank" rel="noreferrer">
              Equivalence Principle
            </a>
            <span className="mono small">equivalencekit {packageVersion}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
