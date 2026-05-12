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

const CATEGORY_ORDER = [
  ['soc', 'SOC'],
  ['cameras', 'Camaras'],
  ['battery', 'Bateria'],
  ['charging', 'Carga'],
  ['display', 'Pantalla'],
  ['os', 'OS'],
  ['price', 'Precio'],
];

const ALLOWED_DEVICE_COUNT = { min: 2, max: 5 };
const MAX_REQUEST_BYTES = 16_000;
const MAX_DEVICE_NAME_LENGTH = 80;
const MAX_CORPUS_LENGTH = 15_000;
const MAX_SOURCE_EXCERPT = 3_000;
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

  if (url.pathname === '/api/compare' && request.method === 'POST') {
    return handleCompareRequest(request, env, ctx);
  }

  return json({ error: 'Ruta API no encontrada.' }, 404);
}

async function handleCompareRequest(request, env, ctx) {
  let body;

  try {
    body = await readJsonBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'No se pudo leer el cuerpo de la peticion.',
      },
      400,
    );
  }

  const devices = normalizeRequestedDevices(body.devices);
  const forceRefresh = body.forceRefresh === true;

  if (devices.length < ALLOWED_DEVICE_COUNT.min || devices.length > ALLOWED_DEVICE_COUNT.max) {
    return json(
      {
        error: `Debes enviar entre ${ALLOWED_DEVICE_COUNT.min} y ${ALLOWED_DEVICE_COUNT.max} dispositivos.`,
      },
      400,
    );
  }

  const cacheWrites = [];
  const touchWrites = [];
  const resolvedDevices = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const name of devices) {
    const resolved = await resolveDevice(name, env, forceRefresh);
    resolvedDevices.push(resolved.device);

    if (resolved.cached) {
      cacheHits += 1;
      touchWrites.push(resolved.writeStatement);
    } else {
      cacheMisses += 1;
      cacheWrites.push(resolved.writeStatement);
    }
  }

  if (touchWrites.length || cacheWrites.length) {
    await env.DB.batch([...touchWrites, ...cacheWrites].filter(Boolean));
  }

  const comparison = await compareDevices(resolvedDevices, env);

  const historyStatement = env.DB
    .prepare(
      `INSERT INTO comparison_history (
        id, scope_id, comparison_key, device_names_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      SCOPE_ID,
      buildComparisonKey(resolvedDevices),
      JSON.stringify(resolvedDevices.map((device) => device.name)),
      JSON.stringify(comparison),
      new Date().toISOString(),
    );

  ctx.waitUntil(historyStatement.run());

  return json({
    comparedAt: new Date().toISOString(),
    cacheSummary: {
      hits: cacheHits,
      misses: cacheMisses,
    },
    devices: resolvedDevices,
    comparison,
  });
}

async function resolveDevice(name, env, forceRefresh) {
  const normalizedName = normalizeDeviceName(name);
  const now = new Date().toISOString();
  const ttlDays = toInteger(env.DEVICE_CACHE_TTL_DAYS, 30);
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

  const freshDevice = await buildFreshDevice(name, normalizedName, env);

  return {
    cached: false,
    device: {
      ...freshDevice,
      cached: false,
    },
    writeStatement: env.DB
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
      ),
  };
}

async function buildFreshDevice(name, normalizedName, env) {
  const searchQuery = `${name} smartphone specs camera battery display charging price`;
  const maxSources = Math.max(2, Math.min(4, toInteger(env.MAX_WEB_SOURCES, 3)));
  const searchResults = await searchWeb(searchQuery, maxSources + 3);
  const selectedSources = selectSources(searchResults, maxSources);
  const fetchedSources = (
    await Promise.all(selectedSources.map((source) => fetchSourceDocument(source)))
  ).filter(Boolean);

  const heuristicDevice = buildHeuristicDevice(name, normalizedName, searchQuery, fetchedSources);
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

async function fetchSourceDocument(source) {
  try {
    const html = await fetchText(source.url);
    const text = clipText(extractTextFromHtml(html), MAX_SOURCE_EXCERPT);

    if (!text) {
      return null;
    }

    return {
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      excerpt: text,
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
    `Dispositivo: ${name}`,
    `Normalizado: ${normalizedName}`,
    `Heuristica previa: ${JSON.stringify(heuristicDevice.specs)}`,
    'JSON esperado:',
    '{"summary":"string","confidence":"high|medium|low","specs":{"soc":{"value":"string"},"cameras":{"value":"string"},"battery":{"value":"string"},"charging":{"value":"string"},"display":{"value":"string"},"os":{"value":"string"},"price":{"value":"string"}}}',
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
    'JSON esperado:',
    '{"overallWinnerIds":["device-id"],"overallReason":"string","categories":[{"key":"soc","label":"SOC","winnerIds":["device-id"],"reasoning":"string"}]}',
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
  const combinedText = clipText(
    fetchedSources
      .map((source) => `${source.title}\n${source.snippet}\n${source.excerpt}`)
      .join('\n\n'),
    MAX_CORPUS_LENGTH,
  );

  const socValue = pickBestMatch(combinedText, [
    /(?:snapdragon|dimensity|exynos|tensor|apple a|helio)[^.;,\n]{0,45}/i,
  ]);
  const batteryMah = extractNumber(combinedText, /(\d{3,5})\s?(?:mAh|mah)/i);
  const chargingW = extractNumber(combinedText, /(\d{1,3})\s?(?:W|watts?)/i);
  const refreshHz = extractNumber(combinedText, /(\d{2,3})\s?Hz/i);
  const displayInches = extractFloat(combinedText, /(\d(?:\.\d{1,2})?)\s?(?:-inch|inch|inches|["”])/i);
  const osValue = pickBestMatch(combinedText, [
    /(Android\s?\d{1,2}[^.;,\n]{0,24})/i,
    /(iOS\s?\d{1,2}[^.;,\n]{0,24})/i,
  ]);
  const displayValue = buildDisplayValue(combinedText, displayInches, refreshHz);
  const cameraValue = buildCameraValue(combinedText);
  const price = extractPrice(combinedText);

  const specs = {
    soc: {
      value: socValue || 'No concluyente',
      score: computeSocScore(socValue),
    },
    cameras: {
      value: cameraValue || 'No concluyente',
      score: computeCameraScore(cameraValue),
    },
    battery: {
      value: batteryMah ? `${batteryMah} mAh` : 'No concluyente',
      score: batteryMah ? Math.round(batteryMah / 100) : null,
      capacityMah: batteryMah,
    },
    charging: {
      value: chargingW ? `${chargingW} W` : 'No concluyente',
      score: chargingW,
      watts: chargingW,
    },
    display: {
      value: displayValue || 'No concluyente',
      score: computeDisplayScore(displayValue, displayInches, refreshHz),
      sizeInches: displayInches,
      refreshHz,
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

function mergeDeviceData(name, normalizedName, searchQuery, heuristicDevice, aiDevice) {
  const mergedSpecs = {};

  for (const [key] of CATEGORY_ORDER) {
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
  const categories = CATEGORY_ORDER.map(([key, label]) => {
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

  return `${winnerNames} destaca(n) en ${CATEGORY_ORDER.find(([entryKey]) => entryKey === key)?.[1].toLowerCase()}.`;
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
        .filter((entry) => entry.key && CATEGORY_ORDER.some(([key]) => key === entry.key))
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
  for (const [key] of CATEGORY_ORDER) {
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
  if (/apple a/i.test(value)) return 94;

  return 60;
}

function computeCameraScore(value) {
  if (!value) {
    return null;
  }

  const mpMatches = [...value.matchAll(/(\d{1,3})\s?MP/gi)].map((match) => Number(match[1]));
  let score = mpMatches.length ? Math.max(...mpMatches) / 4 : 35;

  if (/periscope/i.test(value)) score += 18;
  if (/telephoto/i.test(value)) score += 12;
  if (/ultrawide/i.test(value)) score += 6;
  if (/ois|optical image/i.test(value)) score += 4;

  return Math.round(score);
}

function computeDisplayScore(value, sizeInches, refreshHz) {
  let score = 45;
  if (/ltpo/i.test(value)) score += 18;
  if (/amoled|oled/i.test(value)) score += 14;
  if (/120\s?hz/i.test(value)) score += 10;
  if (/144\s?hz/i.test(value)) score += 14;
  if (/qhd|3200|3120|3088|1440/i.test(value)) score += 12;
  if (/fhd|2400|2340|2712/i.test(value)) score += 6;
  if (Number.isFinite(refreshHz)) score += Math.min(refreshHz / 12, 12);
  if (Number.isFinite(sizeInches)) score += Math.min(sizeInches, 7);
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
  if (/android/i.test(value)) return 76;
  return 70;
}

function computeDeviceConfidence(specs) {
  const resolved = Object.values(specs).filter(
    (spec) => spec && typeof spec.value === 'string' && spec.value !== 'No concluyente',
  ).length;
  if (resolved >= 6) return 'high';
  if (resolved >= 4) return 'medium';
  return 'low';
}

function buildHeuristicSummary(name, specs) {
  const highlights = [];

  if (specs.soc?.value && specs.soc.value !== 'No concluyente') highlights.push(specs.soc.value);
  if (specs.display?.value && specs.display.value !== 'No concluyente') highlights.push(specs.display.value);
  if (specs.battery?.value && specs.battery.value !== 'No concluyente') highlights.push(specs.battery.value);

  if (!highlights.length) {
    return `No se pudo extraer una ficha suficientemente fiable para ${name}; conviene refrescar o revisar el nombre del dispositivo.`;
  }

  return `${name} aparece con ${highlights.slice(0, 3).join(', ')} como rasgos mas consistentes entre las fuentes consultadas.`;
}

function buildDisplayValue(text, displayInches, refreshHz) {
  const tech = pickBestMatch(text, [/(LTPO AMOLED|AMOLED|OLED|IPS LCD|LCD)[^.;,\n]{0,25}/i]);
  const resolution = pickBestMatch(text, [/(\d{3,4}\s?[xX]\s?\d{3,4})/i]);

  const parts = [tech];
  if (displayInches) parts.push(`${displayInches}"`);
  if (refreshHz) parts.push(`${refreshHz} Hz`);
  if (resolution) parts.push(resolution);

  return parts.filter(Boolean).join(', ');
}

function buildCameraValue(text) {
  const primaryCamera = pickBestMatch(text, [/(\d{1,3}\s?MP[^.;,\n]{0,45})/i]);
  const extraFlags = [];
  if (/periscope/i.test(text)) extraFlags.push('periscope');
  if (/telephoto/i.test(text)) extraFlags.push('telephoto');
  if (/ultrawide/i.test(text)) extraFlags.push('ultrawide');

  return [primaryCamera, ...extraFlags].filter(Boolean).join(', ');
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

    const blockedHosts = ['youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'tiktok.com'];
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
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
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
  return normalizeWhitespace(String(value ?? '').replace(/<[^>]+>/g, ' '));
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractNumber(text, pattern) {
  const match = text.match(pattern);
  const parsed = Number.parseInt(match?.[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractFloat(text, pattern) {
  const match = text.match(pattern);
  const parsed = Number.parseFloat(match?.[1] ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}
