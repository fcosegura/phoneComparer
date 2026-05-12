import { useEffect, useMemo, useState } from 'react';

const CATEGORY_DEFINITIONS = [
  ['network', 'Red'],
  ['launch', 'Lanzamiento'],
  ['body', 'Cuerpo'],
  ['display', 'Pantalla'],
  ['soc', 'Plataforma'],
  ['memory', 'Memoria'],
  ['mainCamera', 'Camara principal'],
  ['selfieCamera', 'Camara selfie'],
  ['sound', 'Audio'],
  ['connectivity', 'Conectividad'],
  ['features', 'Sensores'],
  ['battery', 'Bateria'],
  ['charging', 'Carga'],
  ['os', 'OS'],
  ['price', 'Precio'],
];

const EMPTY_FORM = ['', ''];

function sortSources(sources = []) {
  return [...sources].sort((left, right) => Number(right.selected) - Number(left.selected));
}

function App() {
  const [deviceNames, setDeviceNames] = useState(EMPTY_FORM);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const normalizedInputs = useMemo(
    () => deviceNames.map((value) => value.trim()).filter(Boolean),
    [deviceNames],
  );

  function updateDeviceName(index, value) {
    setDeviceNames((current) => current.map((entry, position) => (position === index ? value : entry)));
  }

  function addDeviceField() {
    setDeviceNames((current) => (current.length < 5 ? [...current, ''] : current));
  }

  function removeDeviceField(index) {
    setDeviceNames((current) => {
      if (current.length <= 2) {
        return current;
      }
      return current.filter((_, position) => position !== index);
    });
  }

  useEffect(() => {
    if (!job?.id || job.status === 'completed' || job.status === 'failed') {
      return undefined;
    }

    let cancelled = false;
    let timeoutId;

    async function pollJob() {
      try {
        const response = await fetch(`/api/compare/status?id=${encodeURIComponent(job.id)}`, {
          credentials: 'same-origin',
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error ?? 'No se pudo consultar el progreso de la comparacion.');
        }

        if (cancelled) {
          return;
        }

        setJob(payload.job);

        if (payload.job?.status === 'completed') {
          setResult(payload.result ?? null);
          setLoading(false);
          return;
        }

        if (payload.job?.status === 'failed') {
          setError(payload.job?.errorMessage ?? 'La comparacion termino con error.');
          setLoading(false);
          return;
        }

        timeoutId = window.setTimeout(pollJob, 1200);
      } catch (pollError) {
        if (cancelled) {
          return;
        }

        setError(pollError.message);
        setLoading(false);
        setJob((current) =>
          current
            ? {
                ...current,
                status: 'failed',
                errorMessage: pollError.message,
              }
            : current,
        );
      }
    }

    timeoutId = window.setTimeout(pollJob, job.status === 'queued' ? 500 : 1000);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [job?.id, job?.status]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setJob(null);
    setResult(null);

    try {
      const response = await fetch('/api/compare/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          devices: normalizedInputs,
          forceRefresh,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? 'No se pudo completar la comparacion.');
      }

      setJob(payload.job ?? null);
    } catch (submitError) {
      setError(submitError.message);
      setJob(null);
      setResult(null);
      setLoading(false);
    }
  }

  const comparisonRows = result?.comparison?.categories ?? [];
  const overallWinnerNames = result?.comparison?.overallWinnerIds ?? [];
  const progressValue = Math.max(4, Math.min(100, Math.round(job?.progress ?? 4)));

  return (
    <div className="app-shell">
      <main className="layout">
        <section className="hero card">
          <div>
            <span className="eyebrow">Cloudflare Worker + D1 + Workers AI</span>
            <h1>phoneComparer</h1>
            <p className="hero-copy">
              Escribe entre 2 y 5 moviles, lanza la comparacion y deja que la app recupere
              fuentes web, estructure especificaciones y destaque quien gana en cada categoria.
            </p>
          </div>
          <div className="hero-meta">
            <div>
              <strong>2-5</strong>
              <span>dispositivos por comparacion</span>
            </div>
            <div>
              <strong>D1</strong>
              <span>cache reutilizable por dispositivo</span>
            </div>
            <div>
              <strong>IA</strong>
              <span>sintesis y evaluacion con fallback</span>
            </div>
          </div>
        </section>

        <section className="card">
          <form className="compare-form" onSubmit={handleSubmit}>
            <div className="section-heading">
              <div>
                <h2>Comparar dispositivos</h2>
                <p>Ejemplo: `Samsung Galaxy S24`, `iPhone 16`, `Pixel 9 Pro`.</p>
              </div>
              <div className="actions-inline">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={forceRefresh}
                    onChange={(event) => setForceRefresh(event.target.checked)}
                  />
                  <span>Forzar nueva busqueda web</span>
                </label>
              </div>
            </div>

            <div className="device-grid">
              {deviceNames.map((value, index) => (
                <label key={`device-${index}`} className="field">
                  <span>Dispositivo {index + 1}</span>
                  <div className="field-row">
                    <input
                      type="text"
                      value={value}
                      onChange={(event) => updateDeviceName(index, event.target.value)}
                      placeholder="Nombre completo del telefono"
                      maxLength={80}
                    />
                    {deviceNames.length > 2 ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => removeDeviceField(index)}
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>

            <div className="form-footer">
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={addDeviceField}
                  disabled={deviceNames.length >= 5}
                >
                  Anadir dispositivo
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={loading || normalizedInputs.length < 2 || normalizedInputs.length > 5}
                >
                  {loading ? 'Buscando...' : 'Comparar'}
                </button>
              </div>
              <p className="hint">
                {normalizedInputs.length} dispositivo(s) listos. La app reutiliza cache D1 si ya existe
                una ficha reciente.
              </p>
            </div>
          </form>

          {error ? <div className="notice error">{error}</div> : null}
        </section>

        {loading ? (
          <section className="card progress-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Progreso</span>
                <h2>Buscando especificaciones</h2>
                <p>
                  {job?.stageLabel ??
                    'Preparando la comparacion, consultando fuentes y estructurando la ficha tecnica.'}
                </p>
              </div>
              <div className="progress-percent">{progressValue}%</div>
            </div>

            <div className="progress-track" aria-hidden="true">
              <span className="progress-fill" style={{ width: `${progressValue}%` }} />
            </div>

            <div className="progress-meta">
              <strong>
                {job?.completedCount ?? 0}/{job?.deviceCount ?? normalizedInputs.length}
              </strong>
              <span>dispositivos resueltos</span>
            </div>
          </section>
        ) : null}

        {result ? (
          <>
            <section className="card result-summary">
              <div>
                <span className="eyebrow">Resultado</span>
                <h2>Comparacion completada</h2>
                <p>
                  {result.comparison?.overallReason ??
                    'Se genero una evaluacion estructurada a partir de los datos encontrados.'}
                </p>
              </div>
              <div className="summary-metrics">
                <div>
                  <strong>{result.cacheSummary?.hits ?? 0}</strong>
                  <span>cache hits</span>
                </div>
                <div>
                  <strong>{result.cacheSummary?.misses ?? 0}</strong>
                  <span>consultas nuevas</span>
                </div>
                <div>
                  <strong>{result.comparison?.generatedBy ?? 'heuristic'}</strong>
                  <span>motor de evaluacion</span>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="section-heading">
                <div>
                  <h2>Ganador global</h2>
                  <p>Puede haber empate si los datos son muy similares o incompletos.</p>
                </div>
                <div className="winner-list">
                  {overallWinnerNames.length ? (
                    overallWinnerNames.map((winnerId) => {
                      const winner = result.devices.find((device) => device.id === winnerId);
                      return (
                        <span key={winnerId} className="winner-chip">
                          {winner?.name ?? winnerId}
                        </span>
                      );
                    })
                  ) : (
                    <span className="muted">Sin ganador claro</span>
                  )}
                </div>
              </div>
            </section>

            <section className="result-grid">
              {result.devices.map((device) => (
                <article key={device.id} className="card device-card">
                  <div className="device-card-header">
                    <div>
                      <h3>{device.name}</h3>
                      <p>{device.summary || 'No hubo suficiente informacion para generar resumen.'}</p>
                    </div>
                    <div className="badge-stack">
                      <span className={`badge ${device.cached ? 'badge-muted' : 'badge-fresh'}`}>
                        {device.cached ? 'Cache D1' : 'Consulta nueva'}
                      </span>
                      <span className="badge badge-neutral">{device.confidence ?? 'media'}</span>
                    </div>
                  </div>

                  <dl className="spec-list">
                    {CATEGORY_DEFINITIONS.map(([key, label]) => (
                      <div key={key} className="spec-item">
                        <dt>{label}</dt>
                        <dd>{device.specs?.[key]?.value || 'Sin dato'}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="sources">
                    <strong>Fuentes revisadas</strong>
                    <ul>
                      {sortSources(device.sources).slice(0, 4).map((source) => (
                        <li key={`${device.id}-${source.url}`}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title || source.url}
                          </a>
                          {source.selected ? <span className="source-pill">usada</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </section>

            <section className="card">
              <div className="section-heading">
                <div>
                  <h2>Tabla comparativa</h2>
                  <p>Las celdas marcadas resaltan la ventaja detectada por categoria.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      {result.devices.map((device) => (
                        <th key={`heading-${device.id}`}>{device.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <strong>
                            {row.label ||
                              CATEGORY_DEFINITIONS.find(([key]) => key === row.key)?.[1] ||
                              row.key}
                          </strong>
                          <p>{row.reasoning || 'Sin observaciones.'}</p>
                        </td>
                        {result.devices.map((device) => {
                          const isWinner = row.winnerIds?.includes(device.id);
                          return (
                            <td key={`${row.key}-${device.id}`} className={isWinner ? 'winner-cell' : ''}>
                              <div className="cell-content">
                                <span>{device.specs?.[row.key]?.value || 'Sin dato'}</span>
                                {isWinner ? <span className="winner-mark">Ventaja</span> : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default App;
