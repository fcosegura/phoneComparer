const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

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

const ALLOWED_DEVICE_COUNT = { min: 2, max: 5 };
const MAX_REQUEST_BYTES = 16_000;
const MAX_DEVICE_NAME_LENGTH = 80;
const MAX_CORPUS_LENGTH = 18_000;
const MAX_SOURCE_EXCERPT = 6_000;
const SCOPE_ID = 'public';
const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SOURCE_HOST_SCORES = [
  ['gsmarena.com', 100],
  ['nanoreview.net', 95],
  ['devicespecifications.com', 92],
  ['phonearena.com', 88],
  ['versus.com', 76],
  ['smartprix.com', 72],
  ['91mobiles.com', 70],
  ['androidauthority.com', 62],
  ['tomsguide.com', 58],
];

const SOC_SCORE_PATTERNS = [
  [/apple a18 pro|a18 pro/i, 100],
  [/apple a18|a18\b/i, 98],
  [/apple a17 pro|a17 pro\b/i, 96],
  [/kirin 9030/i, 94],
  [/kirin 9020/i, 90],
  [/kirin 9010/i, 88],
  [/snapdragon 8 elite/i, 99],
  [/snapdragon 8 gen 3/i, 96],
  [/snapdragon 8s gen 3/i, 92],
  [/snapdragon 8 gen 2/i, 91],
  [/dimensity 9400/i, 98],
  [/dimensity 9300/i, 95],
  [/dimensity 8400/i, 88],
  [/exynos 2500/i, 96],
  [/exynos 2400/i, 90],
  [/tensor g5/i, 92],
  [/tensor g4/i, 88],
  [/tensor g3/i, 84],
  [/snapdragon 7\+ gen 3/i, 86],
  [/snapdragon 7 gen 3/i, 80],
  [/snapdragon 6 gen 1/i, 68],
  [/dimensity 8300/i, 84],
  [/dimensity 7300/i, 74],
];

const COMPARISON_JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const TABLE_BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS device_cache (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL DEFAULT 'public',
    normalized_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    search_query TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    source_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(scope_id, normalized_name)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_device_cache_scope_name ON device_cache(scope_id, normalized_name)',
  'CREATE INDEX IF NOT EXISTS idx_device_cache_last_used ON device_cache(last_used_at DESC)',
  `CREATE TABLE IF NOT EXISTS comparison_history (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL DEFAULT 'public',
    comparison_key TEXT NOT NULL,
    device_names_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comparison_history_scope_key ON comparison_history(scope_id, comparison_key)',
  `CREATE TABLE IF NOT EXISTS comparison_jobs (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    stage_label TEXT NOT NULL,
    device_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comparison_jobs_scope_created ON comparison_jobs(scope_id, created_at DESC)',
];

let schemaReadyPromise;

export default {
  async fetch(request, env, ctx) {
    try {
      await ensureSchema(env);

      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) {
        const response = await handleApiRequest(request, env, ctx, url);
        return applySecurityHeaders(response);
      }

      const assetResponse = await env.ASSETS.fetch(request);
      return applySecurityHeaders(assetResponse);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'worker_unhandled_error',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return applySecurityHeaders(
        json(
          {
            error: 'Se produjo un error inesperado en el Worker.',
          },
          500,
        ),
      );
    }
  },
};

async function handleApiRequest(request, env, ctx, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({
      ok: true,
      name: env.APP_NAME ?? 'phoneComparer',
      now: new Date().toISOString(),
    });
  }

  if (url.pathname === '/api/compare/start' && request.method === 'POST') {
    return handleCompareStartRequest(request, env, ctx);
  }

  if (url.pathname === '/api/compare/status' && request.method === 'GET') {
    return handleCompareStatusRequest(url, env);
  }

  if (url.pathname === '/api/compare' && request.method === 'POST') {
    return handleCompareRequest(request, env, ctx);
  }

  return json({ error: 'Ruta API no encontrada.' }, 404);
}

async function handleCompareRequest(request, env, ctx) {
  try {
    const { devices, forceRefresh } = await parseComparePayload(request);
    const payload = await buildComparisonPayload(devices, forceRefresh, env);

    ctx.waitUntil(saveComparisonHistory(env, payload.devices, payload.comparison));
    return json(payload);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo completar la comparacion.' }, 400);
  }
}

async function handleCompareStartRequest(request, env, ctx) {
  try {
    const { devices, forceRefresh } = await parseComparePayload(request);
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const initialJob = {
      id: jobId,
      status: COMPARISON_JOB_STATUS.QUEUED,
      progress: 4,
      stage: 'queued',
      stageLabel: 'Comparacion en cola. Preparando la busqueda...',
      deviceCount: devices.length,
      completedCount: 0,
      errorMessage: '',
      createdAt: now,
      updatedAt: now,
    };

    await env.DB
      .prepare(
        `INSERT INTO comparison_jobs (
          id, scope_id, status, progress, stage, stage_label, device_count, completed_count,
          result_json, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        jobId,
        SCOPE_ID,
        initialJob.status,
        initialJob.progress,
        initialJob.stage,
        initialJob.stageLabel,
        initialJob.deviceCount,
        initialJob.completedCount,
        null,
        null,
        initialJob.createdAt,
        initialJob.updatedAt,
      )
      .run();

    ctx.waitUntil(runComparisonJob(env, jobId, devices, forceRefresh));

    return json({ job: initialJob }, 202);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo iniciar la comparacion.' }, 400);
  }
}

async function handleCompareStatusRequest(url, env) {
  const jobId = normalizeWhitespace(url.searchParams.get('id'));
  if (!jobId) {
    return json({ error: 'Debes indicar el identificador del job.' }, 400);
  }

  const row = await env.DB
    .prepare(
      `SELECT id, status, progress, stage, stage_label, device_count, completed_count,
              result_json, error_message, created_at, updated_at
       FROM comparison_jobs
       WHERE scope_id = ? AND id = ?`,
    )
    .bind(SCOPE_ID, jobId)
    .first();

  if (!row) {
    return json({ error: 'No se encontro el job solicitado.' }, 404);
  }

  const result = row.status === COMPARISON_JOB_STATUS.COMPLETED ? parseJsonBlob(row.result_json) : null;

  return json({
    job: {
      id: row.id,
      status: row.status,
      progress: Math.round(Number(row.progress) || 0),
      stage: row.stage,
      stageLabel: row.stage_label,
      deviceCount: Number(row.device_count) || 0,
      completedCount: Number(row.completed_count) || 0,
      errorMessage: row.error_message ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    result,
  });
}

async function parseComparePayload(request) {
  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  const devices = normalizeRequestedDevices(body.devices);
  const forceRefresh = body.forceRefresh === true;

  if (devices.length < ALLOWED_DEVICE_COUNT.min || devices.length > ALLOWED_DEVICE_COUNT.max) {
    throw new Error(
      `Debes enviar entre ${ALLOWED_DEVICE_COUNT.min} y ${ALLOWED_DEVICE_COUNT.max} dispositivos.`,
    );
  }

  return { devices, forceRefresh };
}

async function buildComparisonPayload(devices, forceRefresh, env, onProgress = async () => {}) {
  const cacheWrites = [];
  const touchWrites = [];
  const resolvedDevices = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  await onProgress({
    status: COMPARISON_JOB_STATUS.RUNNING,
    progress: 6,
    stage: 'preparing',
    stageLabel: 'Preparando comparacion y revisando cache...',
    deviceCount: devices.length,
    completedCount: 0,
  });

  for (const [index, name] of devices.entries()) {
    const deviceProgress = createDeviceProgressReporter(onProgress, index, devices.length, name);
    const resolved = await resolveDevice(name, env, forceRefresh, deviceProgress);
    resolvedDevices.push(resolved.device);

    if (resolved.cached) {
      cacheHits += 1;
      touchWrites.push(resolved.writeStatement);
    } else {
      cacheMisses += 1;
      cacheWrites.push(resolved.writeStatement);
    }

    await deviceProgress({
      fraction: 1,
      stage: resolved.cached ? 'cached' : 'resolved',
      stageLabel: resolved.cached
        ? `Ficha recuperada desde cache para ${name}.`
        : `Ficha tecnica lista para ${name}.`,
      completedCount: index + 1,
    });
  }

  await onProgress({
    status: COMPARISON_JOB_STATUS.RUNNING,
    progress: 84,
    stage: 'saving-cache',
    stageLabel: 'Guardando resultados y actualizando cache...',
    deviceCount: devices.length,
    completedCount: devices.length,
  });

  if (touchWrites.length || cacheWrites.length) {
    await env.DB.batch([...touchWrites, ...cacheWrites].filter(Boolean));
  }

  await onProgress({
    status: COMPARISON_JOB_STATUS.RUNNING,
    progress: 92,
    stage: 'comparing',
    stageLabel: 'Calculando ventajas y ganador global...',
    deviceCount: devices.length,
    completedCount: devices.length,
  });

  const comparison = await compareDevices(resolvedDevices, env);

  return {
    comparedAt: new Date().toISOString(),
    cacheSummary: {
      hits: cacheHits,
      misses: cacheMisses,
    },
    devices: resolvedDevices,
    comparison,
  };
}

async function runComparisonJob(env, jobId, devices, forceRefresh) {
  try {
    const payload = await buildComparisonPayload(devices, forceRefresh, env, (update) =>
      updateComparisonJob(env, jobId, update),
    );

    await updateComparisonJob(env, jobId, {
      status: COMPARISON_JOB_STATUS.RUNNING,
      progress: 97,
      stage: 'saving-history',
      stageLabel: 'Guardando historial de la comparacion...',
      deviceCount: devices.length,
      completedCount: devices.length,
      errorMessage: '',
    });

    await saveComparisonHistory(env, payload.devices, payload.comparison);

    await updateComparisonJob(env, jobId, {
      status: COMPARISON_JOB_STATUS.COMPLETED,
      progress: 100,
      stage: 'completed',
      stageLabel: 'Comparacion completada.',
      deviceCount: devices.length,
      completedCount: devices.length,
      resultJson: JSON.stringify(payload),
      errorMessage: '',
    });
  } catch (error) {
    await updateComparisonJob(env, jobId, {
      status: COMPARISON_JOB_STATUS.FAILED,
      progress: 100,
      stage: 'failed',
      stageLabel: 'La comparacion termino con error.',
      deviceCount: devices.length,
      completedCount: 0,
      errorMessage: error instanceof Error ? error.message : 'Error inesperado.',
    });
  }
}

function createDeviceProgressReporter(onProgress, index, totalDevices, deviceName) {
  return async ({ fraction = 0, stage = 'resolving', stageLabel, completedCount = index }) => {
    const safeFraction = Math.max(0, Math.min(1, fraction));
    const progress = 8 + ((index + safeFraction) / Math.max(totalDevices, 1)) * 72;
    await onProgress({
      status: COMPARISON_JOB_STATUS.RUNNING,
      progress,
      stage,
      stageLabel: stageLabel ?? `Procesando ${deviceName}...`,
      deviceCount: totalDevices,
      completedCount,
      errorMessage: '',
    });
  };
}

async function updateComparisonJob(env, jobId, update) {
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE comparison_jobs
       SET status = ?,
           progress = ?,
           stage = ?,
           stage_label = ?,
           device_count = ?,
           completed_count = ?,
           result_json = COALESCE(?, result_json),
           error_message = ?,
           updated_at = ?
       WHERE scope_id = ? AND id = ?`,
    )
    .bind(
      update.status,
      Math.max(0, Math.min(100, Number(update.progress) || 0)),
      update.stage,
      update.stageLabel,
      Number(update.deviceCount) || 0,
      Number(update.completedCount) || 0,
      update.resultJson ?? null,
      update.errorMessage ?? null,
      now,
      SCOPE_ID,
      jobId,
    )
    .run();
}

async function saveComparisonHistory(env, devices, comparison) {
  return env.DB
    .prepare(
      `INSERT INTO comparison_history (
        id, scope_id, comparison_key, device_names_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      SCOPE_ID,
      buildComparisonKey(devices),
      JSON.stringify(devices.map((device) => device.name)),
      JSON.stringify(comparison),
      new Date().toISOString(),
    )
    .run();
}

async function resolveDevice(name, env, forceRefresh, onProgress = async () => {}) {
  const normalizedName = normalizeDeviceName(name);
  const now = new Date().toISOString();
  const ttlDays = toInteger(env.DEVICE_CACHE_TTL_DAYS, 30);

  await onProgress({
    fraction: 0.04,
    stage: 'cache-check',
    stageLabel: `Revisando cache disponible para ${name}...`,
  });

  const cachedRow = await env.DB
    .prepare(
      `SELECT id, display_name, spec_json, source_json, fetched_at
       FROM device_cache
       WHERE scope_id = ? AND normalized_name = ?`,
    )
    .bind(SCOPE_ID, normalizedName)
    .first();

  if (cachedRow && !forceRefresh && !isCacheExpired(cachedRow.fetched_at, ttlDays)) {
    const cachedDevice = deserializeCachedDevice(cachedRow, normalizedName);
    if (hasExpandedSpecs(cachedDevice.specs)) {
      await onProgress({
        fraction: 1,
        stage: 'cached',
        stageLabel: `Se reutilizo la ficha cacheada de ${name}.`,
      });
      return {
        cached: true,
        device: {
          ...cachedDevice,
          cached: true,
        },
        writeStatement: env.DB
          .prepare(
            `UPDATE device_cache
             SET last_used_at = ?, hit_count = hit_count + 1
             WHERE scope_id = ? AND normalized_name = ?`,
          )
          .bind(now, SCOPE_ID, normalizedName),
      };
    }
  }

  const freshDevice = await buildFreshDevice(name, normalizedName, env, onProgress);

  return {
    cached: false,
    device: {
      ...freshDevice,
      cached: false,
    },
    writeStatement: shouldCacheDevice(freshDevice)
      ? env.DB
          .prepare(
            `INSERT INTO device_cache (
              id, scope_id, normalized_name, display_name, search_query, spec_json, source_json,
              fetched_at, last_used_at, hit_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(scope_id, normalized_name) DO UPDATE SET
              display_name = excluded.display_name,
              search_query = excluded.search_query,
              spec_json = excluded.spec_json,
              source_json = excluded.source_json,
              fetched_at = excluded.fetched_at,
              last_used_at = excluded.last_used_at,
              hit_count = device_cache.hit_count + 1`,
          )
          .bind(
            freshDevice.id,
            SCOPE_ID,
            normalizedName,
            freshDevice.name,
            freshDevice.searchQuery,
            JSON.stringify(stripVolatileFields(freshDevice)),
            JSON.stringify(freshDevice.sources),
            freshDevice.fetchedAt,
            freshDevice.fetchedAt,
          )
      : null,
  };
}

async function buildFreshDevice(name, normalizedName, env, onProgress = async () => {}) {
  const searchQuery = `${name} gsmarena smartphone specs camera battery display charging memory connectivity price`;
  const maxSources = Math.max(2, Math.min(4, toInteger(env.MAX_WEB_SOURCES, 3)));
  await onProgress({
    fraction: 0.18,
    stage: 'searching',
    stageLabel: `Buscando fuentes de especificaciones para ${name}...`,
  });
  const preferredSource = await findPreferredSpecSource(name);
  const searchResults = await searchAcrossQueries(
    [
      searchQuery,
      `${name} gsmarena smartphone specs`,
      `${name} smartphone specs`,
      `${name} phone specs`,
    ],
    maxSources + 4,
  );
  const mergedCandidates = preferredSource
    ? [preferredSource, ...searchResults.filter((entry) => entry.url !== preferredSource.url)]
    : searchResults;
  await onProgress({
    fraction: 0.35,
    stage: 'selecting-sources',
    stageLabel: `Seleccionando las fuentes mas fiables para ${name}...`,
  });
  const selectedSources = selectSources(mergedCandidates, maxSources);
  await onProgress({
    fraction: 0.62,
    stage: 'extracting',
    stageLabel: `Extrayendo especificaciones ampliadas de ${name}...`,
  });
  const fetchedSources = (
    await Promise.all(selectedSources.map((source) => fetchSourceDocument(source)))
  ).filter(Boolean);

  const heuristicDevice = buildHeuristicDevice(name, normalizedName, searchQuery, fetchedSources);
  await onProgress({
    fraction: 0.82,
    stage: 'structuring',
    stageLabel: `Estructurando la ficha tecnica de ${name}...`,
  });
  const aiDevice = await buildAiDevice(name, normalizedName, heuristicDevice, fetchedSources, env);
  const mergedDevice = mergeDeviceData(name, normalizedName, searchQuery, heuristicDevice, aiDevice);

  return {
    ...mergedDevice,
    sources: fetchedSources.length ? fetchedSources : heuristicDevice.sources,
  };
}

async function searchWeb(query, limit) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('q', query);

  const html = await fetchText(url.toString());
  const results = [];
  const seenUrls = new Set();
  const anchorRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = match[1];
    const decodedUrl = decodeDuckDuckGoUrl(rawHref);

    if (!decodedUrl || seenUrls.has(decodedUrl) || !isUsefulSource(decodedUrl)) {
      continue;
    }

    const searchWindow = html.slice(match.index, match.index + 1_500);
    const snippetMatch =
      searchWindow.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      searchWindow.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    results.push({
      title: normalizeWhitespace(stripHtml(match[2])),
      url: decodedUrl,
      snippet: normalizeWhitespace(stripHtml(snippetMatch?.[1] ?? '')),
      hostScore: getSourceHostScore(decodedUrl),
      selected: false,
    });

    seenUrls.add(decodedUrl);

    if (results.length >= limit) {
      break;
    }
  }

  return results.sort((left, right) => right.hostScore - left.hostScore);
}

async function searchAcrossQueries(queries, limit) {
  const mergedResults = [];
  const seenUrls = new Set();

  for (const query of queries) {
    const results = await searchWeb(query, limit);
    for (const entry of results) {
      if (seenUrls.has(entry.url)) {
        continue;
      }

      seenUrls.add(entry.url);
      mergedResults.push(entry);
    }

    if (mergedResults.length >= limit) {
      break;
    }
  }

  return mergedResults
    .sort((left, right) => right.hostScore - left.hostScore)
    .slice(0, limit);
}

async function findPreferredSpecSource(deviceName) {
  const gsmaSource = await findGsmaArenaSpecSource(deviceName);
  if (gsmaSource) {
    return gsmaSource;
  }

  return null;
}

async function findGsmaArenaSpecSource(deviceName) {
  try {
    const url = new URL('https://www.gsmarena.com/results.php3');
    url.searchParams.set('sQuickSearch', 'yes');
    url.searchParams.set('sName', deviceName);

    const html = await fetchText(url.toString());
    const match = html.match(
      /<div class="makers">[\s\S]*?<li>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/li>/i,
    );

    if (!match) {
      return null;
    }

    const relativeUrl = match[1];
    const cardHtml = match[2];
    const title = normalizeWhitespace(stripHtml(cardHtml)).replace(/\s+/g, ' ');

    return {
      title: title || `GSMArena - ${deviceName}`,
      url: new URL(relativeUrl, 'https://www.gsmarena.com/').toString(),
      snippet: 'Ficha tecnica exacta encontrada en GSMArena.',
      hostScore: 150,
      selected: true,
    };
  } catch {
    return null;
  }
}

async function fetchSourceDocument(source) {
  try {
    const html = await fetchText(source.url);
    const structuredSpecs = isGsmaArenaSpecPage(source.url) ? parseGsmaArenaSpecs(html) : null;
    const text = clipText(
      structuredSpecs?.excerpt || extractTextFromHtml(html),
      MAX_SOURCE_EXCERPT,
    );

    if (!text) {
      return null;
    }

    return {
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      excerpt: text,
      structuredSpecs,
      selected: true,
    };
  } catch {
    return {
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      excerpt: '',
      selected: true,
    };
  }
}

async function buildAiDevice(name, normalizedName, heuristicDevice, fetchedSources, env) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return null;
  }

  const corpus = clipText(
    fetchedSources
      .map(
        (source, index) =>
          `Fuente ${index + 1}\nTitulo: ${source.title}\nURL: ${source.url}\nSnippet: ${source.snippet}\nContenido: ${source.excerpt}`,
      )
      .join('\n\n'),
    MAX_CORPUS_LENGTH,
  );

  if (!corpus) {
    return null;
  }

  const prompt = [
    'Devuelve SOLO JSON valido.',
    'Analiza el smartphone solicitado y usa un tono factico.',
    'Si un dato no es fiable, usa "No concluyente".',
    'Organiza la respuesta con una ficha ampliada inspirada en GSMArena: Network, Launch, Body, Display, Platform, Memory, Main Camera, Selfie Camera, Sound, Comms, Features, Battery, OS y Price.',
    `Dispositivo: ${name}`,
    `Normalizado: ${normalizedName}`,
    `Heuristica previa: ${JSON.stringify(heuristicDevice.specs)}`,
    'JSON esperado:',
    buildAiDeviceSchemaExample(),
    `Fuentes:\n${corpus}`,
  ].join('\n\n');

  try {
    const aiResponse = await env.AI.run(env.AI_MODEL ?? '@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
      temperature: 0.2,
    });

    const parsed = parseJsonBlob(readAiText(aiResponse));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      summary: cleanTextValue(parsed.summary),
      confidence: normalizeConfidence(parsed.confidence),
      specs: sanitizeAiSpecs(parsed.specs),
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'ai_device_enrichment_failed',
        device: name,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

async function compareDevices(devices, env) {
  const heuristicComparison = buildHeuristicComparison(devices);

  if (!env.AI || typeof env.AI.run !== 'function') {
    return heuristicComparison;
  }

  const prompt = [
    'Devuelve SOLO JSON valido.',
    'Eres un analista experto en smartphones.',
    'Compara los dispositivos y marca que equipo tiene ventaja visible por categoria.',
    'Si no hay evidencia suficiente, deja winnerIds como [] para esa categoria.',
    'Toma como referencia una ficha tecnica extensa, similar a GSMArena.',
    'JSON esperado:',
    buildComparisonSchemaExample(),
    `Dispositivos:\n${JSON.stringify(
      devices.map((device) => ({
        id: device.id,
        name: device.name,
        summary: device.summary,
        specs: Object.fromEntries(
          Object.entries(device.specs).map(([key, value]) => [key, value?.value ?? 'Sin dato']),
        ),
      })),
    )}`,
  ].join('\n\n');

  try {
    const aiResponse = await env.AI.run(env.AI_MODEL ?? '@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.1,
    });

    const parsed = parseJsonBlob(readAiText(aiResponse));
    const sanitized = sanitizeComparison(parsed, devices);

    if (!sanitized) {
      return heuristicComparison;
    }

    const mergedCategories = heuristicComparison.categories.map((row) => {
      const aiRow = sanitized.categories.find((entry) => entry.key === row.key);
      return aiRow ?? row;
    });

    return {
      overallWinnerIds: sanitized.overallWinnerIds.length
        ? sanitized.overallWinnerIds
        : heuristicComparison.overallWinnerIds,
      overallReason: sanitized.overallReason || heuristicComparison.overallReason,
      categories: mergedCategories,
      generatedBy: 'ai',
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'ai_comparison_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return heuristicComparison;
  }
}

function buildHeuristicDevice(name, normalizedName, searchQuery, fetchedSources) {
  const structuredSource = fetchedSources.find((source) => source?.structuredSpecs);
  if (structuredSource?.structuredSpecs?.specs) {
    return buildStructuredDevice(
      name,
      normalizedName,
      searchQuery,
      structuredSource.structuredSpecs,
      fetchedSources,
    );
  }

  const combinedText = clipText(
    fetchedSources
      .map((source) => `${source.title}\n${source.snippet}\n${source.excerpt}`)
      .join('\n\n'),
    MAX_CORPUS_LENGTH,
  );

  const launchValue = buildLaunchValue(combinedText);
  const networkValue = buildNetworkValue(combinedText);
  const bodyDetails = buildBodyValue(combinedText);
  const batteryMah = extractNumber(combinedText, /(\d[\d.,]{2,6})\s?(?:mAh|mah)/i);
  const chargingMetrics = extractChargingMetrics(combinedText);
  const refreshHz = extractNumber(combinedText, /(\d{2,3})\s?Hz/i);
  const displayInches = extractFloat(combinedText, /(\d(?:\.\d{1,2})?)\s?(?:-inch|inch|inches|["”])/i);
  const peakNits = extractNumber(combinedText, /(\d{3,4})\s?nits/i);
  const osValue = pickBestMatch(combinedText, [
    /(Android\s?\d{1,2}[^.;,\n]{0,24})/i,
    /(iOS\s?\d{1,2}[^.;,\n]{0,24})/i,
    /(HarmonyOS\s?\d(?:\.\d)?[^.;,\n]{0,24})/i,
    /(EMUI\s?\d(?:\.\d)?[^.;,\n]{0,24})/i,
  ]);
  const socValue = buildPlatformValue(combinedText);
  const memoryValue = buildMemoryValue(combinedText);
  const displayValue = buildDisplayValue(combinedText, displayInches, refreshHz, peakNits);
  const mainCameraValue = buildMainCameraValue(combinedText);
  const selfieCameraValue = buildSelfieCameraValue(combinedText);
  const soundValue = buildSoundValue(combinedText);
  const connectivityValue = buildConnectivityValue(combinedText);
  const featureValue = buildFeatureValue(combinedText);
  const price = extractPrice(combinedText);

  const specs = {
    network: {
      value: networkValue || 'No concluyente',
      score: computeNetworkScore(networkValue),
    },
    launch: {
      value: launchValue || 'No concluyente',
      score: computeLaunchScore(launchValue),
    },
    body: {
      value: bodyDetails.value || 'No concluyente',
      score: computeBodyScore(bodyDetails),
      weightGrams: bodyDetails.weightGrams,
      thicknessMm: bodyDetails.thicknessMm,
    },
    display: {
      value: displayValue || 'No concluyente',
      score: computeDisplayScore(displayValue, displayInches, refreshHz, peakNits),
      sizeInches: displayInches,
      refreshHz,
      peakNits,
    },
    soc: {
      value: socValue || 'No concluyente',
      score: computeSocScore(socValue),
    },
    memory: {
      value: memoryValue.value || 'No concluyente',
      score: computeMemoryScore(memoryValue),
      maxRamGb: memoryValue.maxRamGb,
      maxStorageGb: memoryValue.maxStorageGb,
    },
    mainCamera: {
      value: mainCameraValue || 'No concluyente',
      score: computeCameraScore(mainCameraValue),
    },
    selfieCamera: {
      value: selfieCameraValue || 'No concluyente',
      score: computeSelfieCameraScore(selfieCameraValue),
    },
    sound: {
      value: soundValue || 'No concluyente',
      score: computeSoundScore(soundValue),
    },
    connectivity: {
      value: connectivityValue.value || 'No concluyente',
      score: computeConnectivityScore(connectivityValue),
      wifiVersion: connectivityValue.wifiVersion,
      bluetoothVersion: connectivityValue.bluetoothVersion,
    },
    features: {
      value: featureValue || 'No concluyente',
      score: computeFeaturesScore(featureValue),
    },
    battery: {
      value: batteryMah ? `${batteryMah} mAh` : 'No concluyente',
      score: batteryMah ? Math.round(batteryMah / 100) : null,
      capacityMah: batteryMah,
    },
    charging: {
      value: chargingMetrics.value || 'No concluyente',
      score: computeChargingScore(chargingMetrics),
      watts: chargingMetrics.wiredWatts,
      wirelessWatts: chargingMetrics.wirelessWatts,
    },
    os: {
      value: osValue || 'No concluyente',
      score: computeOsScore(osValue),
    },
    price: {
      value: price.label || 'No concluyente',
      amount: price.amount,
      currency: price.currency,
    },
  };

  return {
    id: normalizedName,
    name,
    normalizedName,
    searchQuery,
    fetchedAt: new Date().toISOString(),
    confidence: computeDeviceConfidence(specs),
    summary: buildHeuristicSummary(name, specs),
    specs,
    sources: fetchedSources,
  };
}

function buildStructuredDevice(name, normalizedName, searchQuery, structured, fetchedSources) {
  const specs = structured.specs;

  return {
    id: normalizedName,
    name,
    normalizedName,
    searchQuery,
    fetchedAt: new Date().toISOString(),
    confidence: computeDeviceConfidence(specs),
    summary:
      structured.summary ||
      buildHeuristicSummary(name, specs) ||
      `${name} se estructuro a partir de una ficha tecnica exacta.`,
    specs,
    sources: fetchedSources,
  };
}

function mergeDeviceData(name, normalizedName, searchQuery, heuristicDevice, aiDevice) {
  const mergedSpecs = {};

  for (const [key] of CATEGORY_DEFINITIONS) {
    const heuristicSpec = heuristicDevice.specs[key];
    const aiSpec = aiDevice?.specs?.[key];

    mergedSpecs[key] = {
      ...heuristicSpec,
      value:
        cleanTextValue(aiSpec?.value) && cleanTextValue(aiSpec?.value) !== 'No concluyente'
          ? cleanTextValue(aiSpec.value)
          : heuristicSpec.value,
    };
  }

  return {
    id: normalizedName,
    name,
    normalizedName,
    searchQuery,
    fetchedAt: heuristicDevice.fetchedAt,
    confidence: aiDevice?.confidence ?? heuristicDevice.confidence,
    summary: aiDevice?.summary || heuristicDevice.summary,
    specs: mergedSpecs,
    sources: heuristicDevice.sources,
  };
}

function buildHeuristicComparison(devices) {
  const categories = CATEGORY_DEFINITIONS.map(([key, label]) => {
    const winnerIds = pickCategoryWinners(devices, key);
    return {
      key,
      label,
      winnerIds,
      reasoning: buildCategoryReasoning(devices, key, winnerIds),
    };
  });

  const scoreBoard = new Map(devices.map((device) => [device.id, 0]));
  for (const row of categories) {
    for (const winnerId of row.winnerIds) {
      scoreBoard.set(winnerId, (scoreBoard.get(winnerId) ?? 0) + 1);
    }
  }

  const highestScore = Math.max(...scoreBoard.values(), 0);
  const overallWinnerIds = [...scoreBoard.entries()]
    .filter(([, score]) => score === highestScore && score > 0)
    .map(([deviceId]) => deviceId);

  return {
    generatedBy: 'heuristic',
    overallWinnerIds,
    overallReason:
      overallWinnerIds.length > 0
        ? `Se marcaron como ganadores los modelos con mas ventajas acumuladas (${highestScore} categorias).`
        : 'No hubo datos suficientes para declarar un ganador global claro.',
    categories,
  };
}

function pickCategoryWinners(devices, key) {
  if (key === 'price') {
    const priced = devices
      .map((device) => ({
        id: device.id,
        amount: device.specs.price?.amount,
        currency: device.specs.price?.currency,
      }))
      .filter((entry) => Number.isFinite(entry.amount));

    if (priced.length < 2) {
      return [];
    }

    const currencies = new Set(priced.map((entry) => entry.currency || ''));
    if (currencies.size > 1) {
      return [];
    }

    const bestValue = Math.min(...priced.map((entry) => entry.amount));
    return priced
      .filter((entry) => Math.abs(entry.amount - bestValue) <= bestValue * 0.03)
      .map((entry) => entry.id);
  }

  const scored = devices
    .map((device) => ({
      id: device.id,
      score: device.specs[key]?.score,
    }))
    .filter((entry) => Number.isFinite(entry.score));

  if (!scored.length) {
    return [];
  }

  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const threshold = key === 'soc' ? 2 : 1;

  return scored
    .filter((entry) => Math.abs(entry.score - bestScore) <= threshold)
    .map((entry) => entry.id);
}

function buildCategoryReasoning(devices, key, winnerIds) {
  if (!winnerIds.length) {
    return 'No hubo evidencia suficiente para destacar una ventaja clara.';
  }

  const winnerNames = winnerIds
    .map((winnerId) => devices.find((device) => device.id === winnerId)?.name)
    .filter(Boolean)
    .join(', ');

  return `${winnerNames} destaca(n) en ${CATEGORY_DEFINITIONS.find(([entryKey]) => entryKey === key)?.[1].toLowerCase()}.`;
}

function sanitizeComparison(candidate, devices) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const validIds = new Set(devices.map((device) => device.id));
  const categories = Array.isArray(candidate.categories)
    ? candidate.categories
        .map((entry) => ({
          key: typeof entry?.key === 'string' ? entry.key : null,
          label: cleanTextValue(entry?.label),
          winnerIds: Array.isArray(entry?.winnerIds)
            ? entry.winnerIds.filter((item) => typeof item === 'string' && validIds.has(item))
            : [],
          reasoning: cleanTextValue(entry?.reasoning) || 'Sin observaciones.',
        }))
        .filter((entry) => entry.key && CATEGORY_DEFINITIONS.some(([key]) => key === entry.key))
    : [];

  if (!categories.length) {
    return null;
  }

  return {
    overallWinnerIds: Array.isArray(candidate.overallWinnerIds)
      ? candidate.overallWinnerIds.filter((item) => typeof item === 'string' && validIds.has(item))
      : [],
    overallReason:
      cleanTextValue(candidate.overallReason) ||
      'La IA no proporciono un razonamiento adicional para el ganador global.',
    categories,
  };
}

function sanitizeAiSpecs(candidate) {
  const result = {};
  for (const [key] of CATEGORY_DEFINITIONS) {
    result[key] = {
      value: cleanTextValue(candidate?.[key]?.value) || 'No concluyente',
    };
  }
  return result;
}

function deserializeCachedDevice(row, normalizedName) {
  const parsedDevice = parseJsonBlob(row.spec_json) ?? {};
  const parsedSources = parseJsonBlob(row.source_json) ?? [];

  return {
    id: parsedDevice.id ?? normalizedName,
    name: parsedDevice.name ?? row.display_name,
    normalizedName,
    searchQuery: parsedDevice.searchQuery ?? '',
    fetchedAt: parsedDevice.fetchedAt ?? row.fetched_at,
    confidence: parsedDevice.confidence ?? 'medium',
    summary: parsedDevice.summary ?? '',
    specs: parsedDevice.specs ?? {},
    sources: Array.isArray(parsedSources) ? parsedSources : [],
  };
}

function stripVolatileFields(device) {
  return {
    id: device.id,
    name: device.name,
    normalizedName: device.normalizedName,
    searchQuery: device.searchQuery,
    fetchedAt: device.fetchedAt,
    confidence: device.confidence,
    summary: device.summary,
    specs: device.specs,
  };
}

function hasExpandedSpecs(specs) {
  return countMeaningfulSpecs(specs) >= 6;
}

function shouldCacheDevice(device) {
  return countMeaningfulSpecs(device?.specs) >= 6;
}

function countMeaningfulSpecs(specs) {
  return CATEGORY_DEFINITIONS.filter(([key]) => {
    const value = cleanTextValue(specs?.[key]?.value);
    return value && value !== 'No concluyente';
  }).length;
}

function buildComparisonKey(devices) {
  return devices
    .map((device) => device.normalizedName)
    .sort((left, right) => left.localeCompare(right))
    .join('__');
}

function normalizeRequestedDevices(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const seen = new Set();
  const values = [];

  for (const entry of candidate) {
    if (typeof entry !== 'string') {
      continue;
    }

    const cleaned = normalizeWhitespace(entry).slice(0, MAX_DEVICE_NAME_LENGTH);
    const normalized = normalizeDeviceName(cleaned);

    if (!cleaned || !normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    values.push(cleaned);
  }

  return values;
}

function normalizeDeviceName(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildAiDeviceSchemaExample() {
  return JSON.stringify({
    summary: 'string',
    confidence: 'high|medium|low',
    specs: Object.fromEntries(CATEGORY_DEFINITIONS.map(([key]) => [key, { value: 'string' }])),
  });
}

function buildComparisonSchemaExample() {
  const [firstKey, firstLabel] = CATEGORY_DEFINITIONS[0];
  return JSON.stringify({
    overallWinnerIds: ['device-id'],
    overallReason: 'string',
    categories: [{ key: firstKey, label: firstLabel, winnerIds: ['device-id'], reasoning: 'string' }],
  });
}

function computeSocScore(value) {
  if (!value) {
    return null;
  }

  for (const [pattern, score] of SOC_SCORE_PATTERNS) {
    if (pattern.test(value)) {
      return score;
    }
  }

  if (/snapdragon 8/i.test(value)) return 90;
  if (/snapdragon 7/i.test(value)) return 76;
  if (/dimensity 9/i.test(value)) return 88;
  if (/dimensity 8/i.test(value)) return 80;
  if (/tensor/i.test(value)) return 82;
  if (/exynos/i.test(value)) return 72;
  if (/kirin/i.test(value)) return 78;
  if (/apple a/i.test(value)) return 94;

  return 60;
}

function computeNetworkScore(value) {
  if (!value) {
    return null;
  }

  let score = 18;
  if (/5g/i.test(value)) score += 35;
  if (/lte/i.test(value)) score += 14;
  if (/hspa/i.test(value)) score += 6;
  if (/sa\/nsa/i.test(value)) score += 8;
  return score;
}

function computeLaunchScore(value) {
  if (!value) {
    return null;
  }

  const yearMatch = value.match(/20\d{2}/);
  if (!yearMatch) {
    return null;
  }

  const year = Number(yearMatch[0]);
  const monthIndex = getMonthIndex(value);
  return year * 12 + (monthIndex >= 0 ? monthIndex + 1 : 0);
}

function computeBodyScore(details) {
  if (!details?.value) {
    return null;
  }

  let score = 42;
  if (/ip69/i.test(details.value)) score += 16;
  if (/ip68/i.test(details.value)) score += 12;
  if (/titanium/i.test(details.value)) score += 10;
  if (/aluminum|metal/i.test(details.value)) score += 7;
  if (/glass/i.test(details.value)) score += 4;

  if (Number.isFinite(details.weightGrams)) {
    if (details.weightGrams <= 190) score += 8;
    else if (details.weightGrams <= 210) score += 4;
    else if (details.weightGrams >= 230) score -= 4;
  }

  return Math.round(score);
}

function computeMemoryScore(memoryValue) {
  if (!memoryValue?.value) {
    return null;
  }

  let score = 35;
  if (Number.isFinite(memoryValue.maxRamGb)) score += memoryValue.maxRamGb * 2.5;
  if (Number.isFinite(memoryValue.maxStorageGb)) score += Math.min(memoryValue.maxStorageGb / 64, 18);
  if (/ufs 4/i.test(memoryValue.value)) score += 8;
  if (/lpddr5x/i.test(memoryValue.value)) score += 6;
  return Math.round(score);
}

function computeCameraScore(value) {
  if (!value) {
    return null;
  }

  const mpMatches = [...value.matchAll(/(\d{1,3})\s?MP/gi)].map((match) => Number(match[1]));
  let score = mpMatches.length ? Math.max(...mpMatches) / 4 : 35;

  if (/1\.0"?-type|1\/1\.28|1\/1\.3/i.test(value)) score += 12;
  if (/periscope/i.test(value)) score += 18;
  if (/telephoto/i.test(value)) score += 12;
  if (/ultrawide/i.test(value)) score += 6;
  if (/ois|optical image|sensor-shift/i.test(value)) score += 6;
  if (/optical zoom/i.test(value)) score += 8;

  return Math.round(score);
}

function computeSelfieCameraScore(value) {
  if (!value) {
    return null;
  }

  const mpMatches = [...value.matchAll(/(\d{1,2}(?:\.\d+)?)\s?MP/gi)].map((match) => Number(match[1]));
  let score = mpMatches.length ? Math.max(...mpMatches) * 1.7 : 24;
  if (/\bAF\b|autofocus/i.test(value)) score += 8;
  if (/4k/i.test(value)) score += 6;
  if (/ultrawide/i.test(value)) score += 4;
  return Math.round(score);
}

function computeSoundScore(value) {
  if (!value) {
    return null;
  }

  let score = 30;
  if (/stereo/i.test(value)) score += 18;
  if (/3\.5mm/i.test(value)) score += 8;
  if (/dolby|hi-res/i.test(value)) score += 6;
  return score;
}

function computeConnectivityScore(connectivityValue) {
  if (!connectivityValue?.value) {
    return null;
  }

  let score = 28;
  if (Number.isFinite(connectivityValue.wifiVersion)) score += connectivityValue.wifiVersion * 4;
  if (Number.isFinite(connectivityValue.bluetoothVersion)) score += connectivityValue.bluetoothVersion * 3;
  if (/\bNFC\b/i.test(connectivityValue.value)) score += 8;
  if (/\bUSB Type-C 3|DisplayPort/i.test(connectivityValue.value)) score += 8;
  if (/\bIR\b|infrared/i.test(connectivityValue.value)) score += 3;
  return Math.round(score);
}

function computeFeaturesScore(value) {
  if (!value) {
    return null;
  }

  let score = 24;
  if (/fingerprint/i.test(value)) score += 8;
  if (/barometer/i.test(value)) score += 4;
  if (/satellite/i.test(value)) score += 10;
  if (/face id|face unlock/i.test(value)) score += 4;
  return score;
}

function computeChargingScore(chargingMetrics) {
  if (!chargingMetrics?.value) {
    return null;
  }

  let score = 20;
  if (Number.isFinite(chargingMetrics.wiredWatts)) score += chargingMetrics.wiredWatts * 0.45;
  if (Number.isFinite(chargingMetrics.wirelessWatts)) score += chargingMetrics.wirelessWatts * 0.35;
  if (Number.isFinite(chargingMetrics.reverseWatts)) score += chargingMetrics.reverseWatts * 0.15;
  return Math.round(score);
}

function computeDisplayScore(value, sizeInches, refreshHz, peakNits) {
  if (!value && !Number.isFinite(sizeInches) && !Number.isFinite(refreshHz) && !Number.isFinite(peakNits)) {
    return null;
  }

  let score = 45;
  if (/ltpo/i.test(value)) score += 18;
  if (/amoled|oled/i.test(value)) score += 14;
  if (/120\s?hz/i.test(value)) score += 10;
  if (/144\s?hz/i.test(value)) score += 14;
  if (/qhd|3200|3120|3088|2848|1440/i.test(value)) score += 12;
  if (/fhd|2400|2340|2712|1276/i.test(value)) score += 6;
  if (Number.isFinite(refreshHz)) score += Math.min(refreshHz / 12, 12);
  if (Number.isFinite(sizeInches)) score += Math.min(sizeInches, 7);
  if (Number.isFinite(peakNits)) score += Math.min(peakNits / 400, 10);
  return Math.round(score);
}

function computeOsScore(value) {
  if (!value) {
    return null;
  }

  if (/ios\s?18/i.test(value)) return 95;
  if (/ios\s?17/i.test(value)) return 92;
  if (/android\s?16/i.test(value)) return 92;
  if (/android\s?15/i.test(value)) return 88;
  if (/android\s?14/i.test(value)) return 82;
  if (/harmonyos\s?5/i.test(value)) return 84;
  if (/emui\s?15/i.test(value)) return 80;
  if (/android/i.test(value)) return 76;
  return 70;
}

function computeDeviceConfidence(specs) {
  const resolved = Object.values(specs).filter(
    (spec) => spec && typeof spec.value === 'string' && spec.value !== 'No concluyente',
  ).length;
  if (resolved >= 11) return 'high';
  if (resolved >= 7) return 'medium';
  return 'low';
}

function buildHeuristicSummary(name, specs) {
  const highlights = [];

  for (const key of ['soc', 'display', 'memory', 'mainCamera', 'battery', 'charging']) {
    const value = specs[key]?.value;
    if (value && value !== 'No concluyente') {
      highlights.push(value);
    }
  }

  if (!highlights.length) {
    return `No se pudo extraer una ficha suficientemente fiable para ${name}; conviene refrescar o revisar el nombre del dispositivo.`;
  }

  return `${name} aparece con ${highlights.slice(0, 3).join(', ')} como rasgos mas consistentes entre las fuentes consultadas.`;
}

function buildNetworkValue(text) {
  const technology = pickBestMatch(text, [
    /(GSM\s*\/\s*CDMA\s*\/\s*HSPA\s*\/\s*CDMA2000\s*\/\s*LTE\s*\/\s*5G[^.;]{0,30})/i,
    /(GSM\s*\/\s*HSPA\s*\/\s*LTE\s*\/\s*5G[^.;]{0,30})/i,
    /(LTE\s*\/\s*5G[^.;]{0,30})/i,
    /(5G[^.;]{0,40})/i,
  ]);
  const speed = pickBestMatch(text, [/(HSPA[^.;]{0,18}LTE[^.;]{0,18}5G[^.;]{0,18})/i]);
  return joinUniqueParts([technology, speed], ' | ');
}

function buildLaunchValue(text) {
  const announced = pickBestMatch(text, [
    /((?:Announced|Released)\s*20\d{2}[^.;]{0,24})/i,
    /(20\d{2},\s*[A-Za-z]+\s*\d{0,2})/i,
  ]);
  const status = pickBestMatch(text, [/(Available|Coming soon|Rumored|Discontinued)[^.;]{0,20}/i]);
  return joinUniqueParts([announced, status], ' | ');
}

function buildBodyValue(text) {
  const dimensions = pickBestMatch(text, [/(\d{2,3}(?:\.\d+)?\s?[xX]\s?\d{2,3}(?:\.\d+)?\s?[xX]\s?\d{1,2}(?:\.\d+)?\s?mm)/i]);
  const weightMatch = text.match(/(\d{2,3}(?:\.\d+)?)\s?g\b/i);
  const weightGrams = Number.parseFloat(weightMatch?.[1] ?? '');
  const ipRating = pickBestMatch(text, [/(IP\d{2}(?:\/IP\d{2})?[^.;]{0,40})/i]);
  const build = pickBestMatch(text, [
    /(Glass front[^.;]{0,60})/i,
    /(titanium frame[^.;]{0,40})/i,
    /(aluminum frame[^.;]{0,40})/i,
    /(plastic frame[^.;]{0,40})/i,
  ]);

  return {
    value: joinUniqueParts(
      [dimensions, Number.isFinite(weightGrams) ? `${weightGrams} g` : '', ipRating, build],
      ' | ',
    ),
    weightGrams: Number.isFinite(weightGrams) ? weightGrams : null,
    thicknessMm: extractThicknessMm(dimensions),
  };
}

function buildPlatformValue(text) {
  const chipset = pickBestMatch(text, [
    /(?:Chipset|SoC|Processor)\s*[:-]?\s*([^.;]{0,70})/i,
    /((?:snapdragon|dimensity|exynos|tensor|kirin|apple a|helio)[^.;,\n]{0,45})/i,
  ]);
  const cpu = pickBestMatch(text, [/(?:CPU)\s*[:-]?\s*([^.;]{0,70})/i, /((?:octa-core|hexa-core|quad-core)[^.;]{0,60})/i]);
  const gpu = pickBestMatch(text, [/(?:GPU)\s*[:-]?\s*([^.;]{0,55})/i]);
  return joinUniqueParts([chipset, cpu, gpu], ' | ');
}

function buildMemoryValue(text) {
  const memoryLine = pickBestMatch(text, [
    /((?:\d+(?:\.\d+)?\s?(?:TB|GB)\s+\d{1,2}\s?GB RAM[^.;]{0,50}))/i,
    /(?:Internal|Memory)\s*[:-]?\s*([^.;]{0,90})/i,
  ]);
  const ramMatches = [...text.matchAll(/(\d{1,2})\s?GB RAM/gi)].map((match) => Number(match[1]));
  const storageMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s?(TB|GB)\b(?!\s?RAM)/gi)].map((match) =>
    normalizeStorageToGb(match[1], match[2]),
  );
  const maxRamGb = ramMatches.length ? Math.max(...ramMatches) : null;
  const maxStorageGb = storageMatches.length ? Math.max(...storageMatches) : null;

  return {
    value:
      memoryLine ||
      joinUniqueParts(
        [Number.isFinite(maxStorageGb) ? formatStorage(maxStorageGb) : '', maxRamGb ? `${maxRamGb}GB RAM` : ''],
        ' | ',
      ),
    maxRamGb,
    maxStorageGb,
  };
}

function buildDisplayValue(text, displayInches, refreshHz, peakNits) {
  const tech = pickBestMatch(text, [/(LTPO OLED|LTPO AMOLED|AMOLED|OLED|IPS LCD|LCD)[^.;,\n]{0,40}/i]);
  const resolution = pickBestMatch(text, [/(\d{3,4}\s?[xX]\s?\d{3,4})/i]);
  const protection = pickBestMatch(text, [/(Gorilla Glass[^.;]{0,25}|Kunlun Glass[^.;]{0,25}|Ceramic Shield[^.;]{0,25})/i]);

  return joinUniqueParts(
    [
      tech,
      displayInches ? `${displayInches}"` : '',
      refreshHz ? `${refreshHz} Hz` : '',
      peakNits ? `${peakNits} nits` : '',
      resolution,
      protection,
    ],
    ' | ',
  );
}

function buildMainCameraValue(text) {
  const mainLine = pickBestMatch(text, [
    /(?:Main Camera|Rear camera|Triple|Quad|Dual)\s*[:-]?\s*([^.;]{0,140})/i,
    /(\d{1,3}\s?MP[^.;,\n]{0,80})/i,
  ]);
  const zoom = pickBestMatch(text, [/(\d(?:\.\d)?x optical zoom[^.;,\n]{0,25})/i]);
  const extras = [
    /periscope/i.test(text) ? 'periscope' : '',
    /telephoto/i.test(text) ? 'telephoto' : '',
    /ultrawide/i.test(text) ? 'ultrawide' : '',
    /ois|optical image|sensor-shift/i.test(text) ? 'OIS' : '',
  ];
  return joinUniqueParts([mainLine, zoom, ...extras], ' | ');
}

function buildSelfieCameraValue(text) {
  const selfieLine = pickBestMatch(text, [
    /(?:Selfie camera|Front camera|Selfie)\s*[:-]?\s*([^.;]{0,90})/i,
    /(\d{1,2}(?:\.\d+)?\s?MP[^.;,\n]{0,40}\bAF\b[^.;,\n]{0,20})/i,
  ]);
  return joinUniqueParts([selfieLine, /\b4K\b/i.test(text) ? '4K video' : ''], ' | ');
}

function buildSoundValue(text) {
  return joinUniqueParts(
    [
      /stereo speakers/i.test(text) ? 'stereo speakers' : '',
      /3\.5mm jack/i.test(text) ? '3.5mm jack' : '',
      /dolby/i.test(text) ? 'Dolby' : '',
    ],
    ' | ',
  );
}

function buildConnectivityValue(text) {
  const wifi = pickBestMatch(text, [/(Wi-?Fi[^.;]{0,80})/i]);
  const bluetooth = pickBestMatch(text, [/(Bluetooth\s?\d(?:\.\d)?[^.;]{0,35})/i]);
  const usb = pickBestMatch(text, [/(USB Type-C[^.;]{0,45}|USB-C[^.;]{0,45})/i]);
  const wifiVersion = extractHighestNumber(text, /Wi-?Fi[^.;]{0,35}?([4567])\b/gi);
  const bluetoothVersion = extractHighestFloat(text, /Bluetooth\s?(\d(?:\.\d)?)/gi);

  return {
    value: joinUniqueParts(
      [wifi, bluetooth, usb, /\bNFC\b/i.test(text) ? 'NFC' : '', /infrared|IR blaster/i.test(text) ? 'IR' : ''],
      ' | ',
    ),
    wifiVersion,
    bluetoothVersion,
  };
}

function buildFeatureValue(text) {
  return joinUniqueParts(
    [
      pickBestMatch(text, [/(Fingerprint[^.;]{0,35})/i]),
      /barometer/i.test(text) ? 'barometer' : '',
      /satellite/i.test(text) ? 'satellite features' : '',
      /gyro/i.test(text) ? 'gyro' : '',
    ],
    ' | ',
  );
}

function extractChargingMetrics(text) {
  const wiredWatts =
    extractNumber(text, /(\d{1,3})\s?W\s?wired/i) ?? extractNumber(text, /(\d{1,3})\s?(?:W|watts?)/i);
  const wirelessWatts = extractNumber(text, /(\d{1,3})\s?W\s?wireless/i);
  const reverseWirelessWatts = extractNumber(text, /(\d{1,3})\s?W\s?reverse wireless/i);
  const reverseWiredWatts = extractNumber(text, /(\d{1,3})\s?W\s?reverse wired/i);
  const reverseWatts = reverseWirelessWatts ?? reverseWiredWatts;

  return {
    value: joinUniqueParts(
      [
        wiredWatts ? `${wiredWatts}W wired` : '',
        wirelessWatts ? `${wirelessWatts}W wireless` : '',
        reverseWirelessWatts ? `${reverseWirelessWatts}W reverse wireless` : '',
        reverseWiredWatts ? `${reverseWiredWatts}W reverse wired` : '',
      ],
      ' | ',
    ),
    wiredWatts,
    wirelessWatts,
    reverseWatts,
  };
}

function isGsmaArenaSpecPage(url) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname.includes('gsmarena.com') &&
      /-\d+\.php$/i.test(parsedUrl.pathname) &&
      !parsedUrl.pathname.includes('-review-') &&
      !parsedUrl.pathname.includes('-news-') &&
      !parsedUrl.pathname.includes('-price-')
    );
  } catch {
    return false;
  }
}

function parseGsmaArenaSpecs(html) {
  const rows = extractGsmaArenaRows(html);
  if (!rows.length) {
    return null;
  }

  const networkValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Network', 'Technology'),
      getGsmaArenaValue(rows, 'Network', '5G bands'),
      getGsmaArenaValue(rows, 'Network', 'Speed'),
    ],
    ' | ',
  );
  const launchValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Launch', 'Announced'),
      getGsmaArenaValue(rows, 'Launch', 'Status'),
    ],
    ' | ',
  );
  const bodyValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Body', 'Dimensions'),
      getGsmaArenaValue(rows, 'Body', 'Weight'),
      getGsmaArenaValue(rows, 'Body', 'Build'),
      ...getGsmaArenaExtras(rows, 'Body'),
    ],
    ' | ',
  );
  const displayValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Display', 'Type'),
      getGsmaArenaValue(rows, 'Display', 'Size'),
      getGsmaArenaValue(rows, 'Display', 'Resolution'),
      getGsmaArenaValue(rows, 'Display', 'Protection'),
      ...getGsmaArenaExtras(rows, 'Display'),
    ],
    ' | ',
  );
  const socValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Platform', 'Chipset'),
      getGsmaArenaValue(rows, 'Platform', 'CPU'),
      getGsmaArenaValue(rows, 'Platform', 'GPU'),
    ],
    ' | ',
  );
  const osValue = getGsmaArenaValue(rows, 'Platform', 'OS');
  const memoryValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Memory', 'Internal'),
      getGsmaArenaValue(rows, 'Memory', 'Card slot'),
      ...getGsmaArenaExtras(rows, 'Memory'),
    ],
    ' | ',
  );
  const mainCameraValue = joinUniqueParts(
    [
      getGsmaArenaFirstMatchingValue(rows, 'Main Camera', ['Quad', 'Triple', 'Dual', 'Single']),
      getGsmaArenaValue(rows, 'Main Camera', 'Features'),
      getGsmaArenaValue(rows, 'Main Camera', 'Video'),
    ],
    ' | ',
  );
  const selfieCameraValue = joinUniqueParts(
    [
      getGsmaArenaFirstMatchingValue(rows, 'Selfie camera', ['Single', 'Dual']),
      getGsmaArenaValue(rows, 'Selfie camera', 'Features'),
      getGsmaArenaValue(rows, 'Selfie camera', 'Video'),
    ],
    ' | ',
  );
  const soundValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Sound', 'Loudspeaker'),
      getGsmaArenaValue(rows, 'Sound', '3.5mm jack'),
    ],
    ' | ',
  );
  const connectivityValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Comms', 'WLAN'),
      getGsmaArenaValue(rows, 'Comms', 'Bluetooth'),
      getGsmaArenaValue(rows, 'Comms', 'Positioning'),
      getGsmaArenaValue(rows, 'Comms', 'NFC'),
      getGsmaArenaValue(rows, 'Comms', 'Infrared port'),
      getGsmaArenaValue(rows, 'Comms', 'USB'),
    ],
    ' | ',
  );
  const featuresValue = joinUniqueParts(
    [
      getGsmaArenaValue(rows, 'Features', 'Sensors'),
      ...getGsmaArenaExtras(rows, 'Features'),
    ],
    ' | ',
  );
  const batteryValue = getGsmaArenaValue(rows, 'Battery', 'Type');
  const chargingValue = getGsmaArenaValue(rows, 'Battery', 'Charging');
  const priceValue = getGsmaArenaValue(rows, 'Misc', 'Price');

  const displayInches = extractFloat(displayValue, /(\d(?:\.\d{1,2})?)\s?inches/i);
  const refreshHz = extractNumber(displayValue, /(\d{2,3})\s?Hz/i);
  const peakNits = extractNumber(displayValue, /(\d{3,4})\s?nits/i);
  const batteryMah = extractNumber(batteryValue, /(\d[\d.,]{2,6})\s?(?:mAh|mah)/i);
  const chargingMetrics = extractChargingMetrics(chargingValue);
  const bodyDetails = {
    value: bodyValue,
    weightGrams: extractFloat(bodyValue, /(\d{2,3}(?:\.\d+)?)\s?g\b/i),
    thicknessMm: extractThicknessMm(getGsmaArenaValue(rows, 'Body', 'Dimensions')),
  };
  const memoryDetails = buildMemoryValue(memoryValue);
  const connectivityDetails = buildConnectivityValue(connectivityValue);
  const price = extractPrice(priceValue);

  const specs = {
    network: {
      value: networkValue || 'No concluyente',
      score: computeNetworkScore(networkValue),
    },
    launch: {
      value: launchValue || 'No concluyente',
      score: computeLaunchScore(launchValue),
    },
    body: {
      value: bodyValue || 'No concluyente',
      score: computeBodyScore(bodyDetails),
      weightGrams: bodyDetails.weightGrams,
      thicknessMm: bodyDetails.thicknessMm,
    },
    display: {
      value: displayValue || 'No concluyente',
      score: computeDisplayScore(displayValue, displayInches, refreshHz, peakNits),
      sizeInches: displayInches,
      refreshHz,
      peakNits,
    },
    soc: {
      value: socValue || 'No concluyente',
      score: computeSocScore(socValue),
    },
    memory: {
      value: memoryValue || 'No concluyente',
      score: computeMemoryScore(memoryDetails),
      maxRamGb: memoryDetails.maxRamGb,
      maxStorageGb: memoryDetails.maxStorageGb,
    },
    mainCamera: {
      value: mainCameraValue || 'No concluyente',
      score: computeCameraScore(mainCameraValue),
    },
    selfieCamera: {
      value: selfieCameraValue || 'No concluyente',
      score: computeSelfieCameraScore(selfieCameraValue),
    },
    sound: {
      value: soundValue || 'No concluyente',
      score: computeSoundScore(soundValue),
    },
    connectivity: {
      value: connectivityValue || 'No concluyente',
      score: computeConnectivityScore(connectivityDetails),
      wifiVersion: connectivityDetails.wifiVersion,
      bluetoothVersion: connectivityDetails.bluetoothVersion,
    },
    features: {
      value: featuresValue || 'No concluyente',
      score: computeFeaturesScore(featuresValue),
    },
    battery: {
      value: batteryValue || 'No concluyente',
      score: batteryMah ? Math.round(batteryMah / 100) : null,
      capacityMah: batteryMah,
    },
    charging: {
      value: chargingValue || 'No concluyente',
      score: computeChargingScore(chargingMetrics),
      watts: chargingMetrics.wiredWatts,
      wirelessWatts: chargingMetrics.wirelessWatts,
    },
    os: {
      value: osValue || 'No concluyente',
      score: computeOsScore(osValue),
    },
    price: {
      value: priceValue || 'No concluyente',
      amount: price.amount,
      currency: price.currency,
    },
  };

  return {
    specs,
    excerpt: rows.map((row) => `${row.section} ${row.label}: ${row.value}`).join('\n'),
    summary: '',
  };
}

function extractGsmaArenaRows(html) {
  const specsRoot = html.match(/<div id="specs-list">([\s\S]*?)<\/div>\s*<script/i)?.[1] ?? '';
  if (!specsRoot) {
    return [];
  }

  const rows = [];
  let currentSection = '';

  for (const tableMatch of specsRoot.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableMatch[1];

    for (const rowMatch of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1];
      const sectionMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
      if (sectionMatch) {
        currentSection = normalizeWhitespace(stripHtml(sectionMatch[1]));
      }

      const cells = [...rowHtml.matchAll(/<td[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi)];
      if (!cells.length || !currentSection) {
        continue;
      }

      const labelCell = cells.find((cell) => cell[1].includes('ttl'));
      const valueCell = cells.find((cell) => cell[1].includes('nfo'));
      if (!valueCell) {
        continue;
      }

      const label = normalizeWhitespace(stripHtml(labelCell?.[2] ?? '')) || '';
      const value = normalizeWhitespace(stripHtml(valueCell[2]));
      if (!value) {
        continue;
      }

      rows.push({
        section: currentSection,
        label,
        value,
      });
    }
  }

  return rows;
}

function getGsmaArenaValue(rows, section, label) {
  return joinUniqueParts(
    rows
      .filter((row) => row.section === section && row.label === label)
      .map((row) => row.value),
    ' / ',
  );
}

function getGsmaArenaExtras(rows, section) {
  return rows
    .filter((row) => row.section === section && !row.label)
    .map((row) => row.value);
}

function getGsmaArenaFirstMatchingValue(rows, section, labels) {
  for (const label of labels) {
    const value = getGsmaArenaValue(rows, section, label);
    if (value) {
      return value;
    }
  }

  return '';
}

function joinUniqueParts(parts, separator = ', ') {
  const seen = new Set();
  const values = [];

  for (const part of parts) {
    const normalized = cleanTextValue(part);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    values.push(normalized);
  }

  return values.join(separator);
}

function getMonthIndex(value) {
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  return monthNames.findIndex((month) => value.toLowerCase().includes(month));
}

function extractThicknessMm(dimensions) {
  if (!dimensions) {
    return null;
  }

  const metricPart = dimensions.split('(')[0];
  const mmMatches = [...metricPart.matchAll(/(\d{1,3}(?:\.\d+)?)\s?mm/gi)].map((match) =>
    Number.parseFloat(match[1]),
  );
  if (mmMatches.length) {
    return mmMatches[mmMatches.length - 1];
  }

  const xMatches = [...metricPart.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?=[xX])/gi)].map((match) =>
    Number.parseFloat(match[1]),
  );
  return xMatches.length ? xMatches[xMatches.length - 1] : null;
}

function normalizeStorageToGb(rawAmount, unit) {
  const amount = Number.parseFloat(rawAmount);
  if (!Number.isFinite(amount)) {
    return null;
  }

  return String(unit).toUpperCase() === 'TB' ? amount * 1024 : amount;
}

function formatStorage(storageGb) {
  if (!Number.isFinite(storageGb)) {
    return '';
  }

  if (storageGb >= 1024) {
    const tb = storageGb / 1024;
    return `${tb % 1 === 0 ? tb.toFixed(0) : tb.toFixed(1)}TB`;
  }

  return `${Math.round(storageGb)}GB`;
}

function extractHighestNumber(text, pattern) {
  const matches = [...text.matchAll(pattern)].map((match) => Number.parseInt(match[1], 10));
  const valid = matches.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function extractHighestFloat(text, pattern) {
  const matches = [...text.matchAll(pattern)].map((match) => Number.parseFloat(match[1]));
  const valid = matches.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function pickBestMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(match[1]);
    }
    if (match?.[0]) {
      return normalizeWhitespace(match[0]);
    }
  }

  return '';
}

function extractPrice(text) {
  const match = text.match(/(?:€\s?|\$\s?|USD\s?|EUR\s?|GBP\s?|£\s?)(\d[\d.,]{2,})/i);
  if (!match) {
    return { label: '', amount: null, currency: null };
  }

  const prefixMatch = text.slice(Math.max(0, match.index - 4), match.index + 4).match(/€|\$|USD|EUR|GBP|£/i);
  const currency = prefixMatch?.[0]?.toUpperCase() ?? null;
  const numeric = Number.parseFloat(match[1].replace(/,/g, '').replace(/\.(?=\d{3}\b)/g, ''));

  return {
    label: `${currency ?? ''} ${match[1]}`.trim(),
    amount: Number.isFinite(numeric) ? numeric : null,
    currency,
  };
}

function selectSources(results, limit) {
  return results
    .slice()
    .sort((left, right) => right.hostScore - left.hostScore)
    .slice(0, limit)
    .map((entry) => ({ ...entry, selected: true }));
}

function decodeDuckDuckGoUrl(rawHref) {
  try {
    if (rawHref.startsWith('//')) {
      rawHref = `https:${rawHref}`;
    }

    if (rawHref.startsWith('/')) {
      rawHref = `https://duckduckgo.com${rawHref}`;
    }

    const url = new URL(rawHref);
    const encoded = url.searchParams.get('uddg');
    if (encoded) {
      return decodeURIComponent(encoded);
    }
    if (url.hostname.includes('duckduckgo.com') && url.pathname === '/y.js') {
      const base64Redirect = url.searchParams.get('u');
      if (base64Redirect) {
        try {
          return decodeURIComponent(atob(base64Redirect));
        } catch {
          // Ignore malformed ad redirect payloads and continue with other fields.
        }
      }

      const nestedRedirect = url.searchParams.get('u3');
      if (nestedRedirect) {
        try {
          const nestedUrl = new URL(decodeURIComponent(nestedRedirect));
          const encodedTarget = nestedUrl.searchParams.get('u');
          if (encodedTarget) {
            return decodeURIComponent(encodedTarget);
          }
          return nestedUrl.toString();
        } catch {
          // Ignore malformed nested redirect payloads.
        }
      }

      return null;
    }
    if (url.protocol.startsWith('http')) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function isUsefulSource(candidateUrl) {
  try {
    const url = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    const blockedHosts = [
      'youtube.com',
      'youtu.be',
      'facebook.com',
      'instagram.com',
      'tiktok.com',
      'duckduckgo.com',
      'google.com',
      'bing.com',
      'amazon.',
      'idealo.',
      'ebay.',
      'aliexpress.',
      'temu.',
    ];
    return !blockedHosts.some((host) => url.hostname.includes(host));
  } catch {
    return false;
  }
}

function getSourceHostScore(candidateUrl) {
  try {
    const hostname = new URL(candidateUrl).hostname;
    const match = SOURCE_HOST_SCORES.find(([host]) => hostname.includes(host));
    return match?.[1] ?? 50;
  } catch {
    return 0;
  }
}

function extractTextFromHtml(html) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

async function fetchText(url) {
  const response = await withTimeout(
    fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    }),
    9_000,
  );

  if (!response.ok) {
    throw new Error(`No se pudo leer ${url}: ${response.status}`);
  }

  return response.text();
}

function withTimeout(promise, ms) {
  let timerId;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timerId));
}

async function readJsonBody(request, maxBytes) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error('La peticion supera el tamano permitido.');
  }

  const text = await request.text();
  if (text.length > maxBytes) {
    throw new Error('La peticion supera el tamano permitido.');
  }

  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new Error('JSON invalido en el cuerpo de la peticion.');
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function applySecurityHeaders(response) {
  const securedResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    securedResponse.headers.set(key, value);
  }
  return securedResponse;
}

function ensureSchema(env) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = env.DB.batch(TABLE_BOOTSTRAP_STATEMENTS.map((statement) => env.DB.prepare(statement)))
      .catch((error) => {
        schemaReadyPromise = undefined;
        throw error;
      });
  }
  return schemaReadyPromise;
}

function isCacheExpired(isoDate, ttlDays) {
  const cachedTime = Date.parse(isoDate);
  if (!Number.isFinite(cachedTime)) {
    return true;
  }

  return Date.now() - cachedTime > ttlDays * 24 * 60 * 60 * 1000;
}

function parseJsonBlob(text) {
  if (typeof text !== 'string') {
    return text ?? null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function readAiText(aiResponse) {
  if (typeof aiResponse === 'string') {
    return aiResponse;
  }

  if (typeof aiResponse?.response === 'string') {
    return aiResponse.response;
  }

  if (Array.isArray(aiResponse?.result?.messages)) {
    return aiResponse.result.messages.map((entry) => entry.content ?? '').join('\n');
  }

  return JSON.stringify(aiResponse ?? {});
}

function cleanTextValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return normalizeWhitespace(value).slice(0, 260);
}

function normalizeConfidence(value) {
  const cleaned = cleanTextValue(value).toLowerCase();
  if (['high', 'alta'].includes(cleaned)) return 'high';
  if (['low', 'baja'].includes(cleaned)) return 'low';
  return 'medium';
}

function clipText(value, maxLength) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/g, ' ')));
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&thinsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&deg;/g, 'deg')
    .replace(/&Prime;/g, '"')
    .replace(/&prime;/g, "'")
    .replace(/&euro;/gi, 'EUR ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractNumber(text, pattern) {
  const match = text.match(pattern);
  const normalized = String(match?.[1] ?? '')
    .replace(/,/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(/\s+/g, '');
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractFloat(text, pattern) {
  const match = text.match(pattern);
  const normalized = String(match?.[1] ?? '')
    .replace(/,(?=\d{1,2}\b)/g, '.')
    .replace(/\s+/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
