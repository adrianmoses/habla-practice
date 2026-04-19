import { useCallback, useEffect, useMemo, useState } from "react";

import TabNav from "./components/TabNav.jsx";
import TopBar from "./components/TopBar.jsx";
import ScenarioEditor from "./components/ScenarioEditor.jsx";
import Frases from "./views/Frases.jsx";
import Historial from "./views/Historial.jsx";
import LiveSession from "./views/LiveSession.jsx";
import PostSession from "./views/PostSession.jsx";
import SesionHome from "./views/SesionHome.jsx";
import * as api from "./lib/api.js";

export default function App() {
  const [activeTab, setActiveTab] = useState("sesion");
  const [overlay, setOverlay] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [durationSec, setDurationSec] = useState(600);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetchAll = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.listScenarios(), api.listChunks()]);
      setScenarios(s);
      setChunks(c);
      setError(null);
      return { scenarios: s, chunks: c };
    } catch (err) {
      setError(err.message || "Error al cargar datos");
      throw err;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refetchAll();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchAll]);

  useEffect(() => {
    if (selectedScenarioId == null && scenarios.length > 0) {
      setSelectedScenarioId(scenarios[0].id);
    }
    if (selectedScenarioId != null && !scenarios.some((s) => s.id === selectedScenarioId)) {
      setSelectedScenarioId(scenarios[0]?.id ?? null);
    }
  }, [scenarios, selectedScenarioId]);

  const selectedScenario = useMemo(
    () => scenarios.find((s) => s.id === selectedScenarioId) ?? null,
    [scenarios, selectedScenarioId],
  );

  const handleStart = useCallback(() => {
    if (!selectedScenario) return;
    setOverlay({ kind: "live", scenario: selectedScenario, durationSec });
  }, [selectedScenario, durationSec]);

  const handleLiveEnd = useCallback((sessionId) => {
    setOverlay((prev) => {
      if (prev?.kind !== "live") return prev;
      if (sessionId == null) return null;
      return { kind: "post", scenario: prev.scenario, sessionId };
    });
  }, []);

  const handlePostSave = useCallback(async () => {
    setOverlay(null);
    try {
      await refetchAll();
    } catch {
      // error surfaces via existing error banner
    }
  }, [refetchAll]);

  const openScenarioCreate = useCallback(() => {
    setOverlay({ kind: "scenario-editor", scenario: null });
  }, []);

  const openScenarioEdit = useCallback((scenario) => {
    setOverlay({ kind: "scenario-editor", scenario });
  }, []);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  const handleScenarioCreated = useCallback(
    async (created) => {
      await refetchAll();
      setSelectedScenarioId(created.id);
      setOverlay(null);
    },
    [refetchAll],
  );

  const handleScenarioUpdated = useCallback(async () => {
    await refetchAll();
    setOverlay(null);
  }, [refetchAll]);

  const handleScenarioDeleted = useCallback(async () => {
    await refetchAll();
    setOverlay(null);
  }, [refetchAll]);

  const handleChunksChanged = useCallback(async () => {
    await refetchAll();
  }, [refetchAll]);

  return (
    <div className="shell">
      <TopBar streak={null} />
      <TabNav activeTab={activeTab} onChange={setActiveTab} />
      <div className="content">
        {loading && <div className="content-loading">cargando…</div>}
        {!loading && error && <div className="content-error">{error}</div>}
        {!loading && !error && activeTab === "sesion" && (
          <SesionHome
            scenarios={scenarios}
            selectedScenario={selectedScenario}
            onSelectScenario={setSelectedScenarioId}
            onEditScenario={openScenarioEdit}
            onNewScenario={openScenarioCreate}
            durationSec={durationSec}
            onChangeDuration={setDurationSec}
            onStart={handleStart}
          />
        )}
        {!loading && !error && activeTab === "frases" && (
          <Frases chunks={chunks} onChanged={handleChunksChanged} />
        )}
        {!loading && !error && activeTab === "historial" && <Historial />}
      </div>
      {overlay?.kind === "scenario-editor" && (
        <ScenarioEditor
          scenario={overlay.scenario}
          chunks={chunks}
          onClose={closeOverlay}
          onCreated={handleScenarioCreated}
          onUpdated={handleScenarioUpdated}
          onDeleted={handleScenarioDeleted}
        />
      )}
      {overlay?.kind === "live" && (
        <LiveSession
          scenario={overlay.scenario}
          durationSec={overlay.durationSec}
          onEnd={handleLiveEnd}
        />
      )}
      {overlay?.kind === "post" && (
        <PostSession
          scenario={overlay.scenario}
          sessionId={overlay.sessionId}
          onSave={handlePostSave}
        />
      )}
    </div>
  );
}
