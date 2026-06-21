require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { line001A } = require('./data/line001A');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// POC real: por padrão NÃO existe fallback mock.
// O mock só funciona se ALLOW_MOCK=true e a chamada usar ?mock=true.
const ALLOW_MOCK = String(process.env.ALLOW_MOCK || 'false').toLowerCase() === 'true';
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 5);
const STALE_AFTER_SECONDS = Number(process.env.STALE_AFTER_SECONDS || 90);
const LINE_CODE = process.env.LINE_CODE || '01A';
const LINE_CODE_ALT = process.env.LINE_CODE_ALT || '001A';
const STRICT_LINE_FILTER = String(process.env.STRICT_LINE_FILTER || 'true').toLowerCase() !== 'false';

const CITTATI_BASE_URL = process.env.CITTATI_BASE_URL || 'https://flits.cittati.com.br';
const CITTATI_APP_CODE = process.env.CITTATI_APP_CODE || '200';
const CITTATI_CLIENT_ID = process.env.CITTATI_CLIENT_ID || '1';
const CITTATI_COMPANY_ID = process.env.CITTATI_COMPANY_ID || '';
const CITTATI_USERNAME = process.env.CITTATI_USERNAME || '';
const CITTATI_PASSWORD = process.env.CITTATI_PASSWORD || '';

const DEFAULT_VEHICLES = (process.env.DEFAULT_VEHICLES || '')
  .split(',')
  .map(v => Number(String(v).trim()))
  .filter(Number.isFinite);

const DEFAULT_LINES = (process.env.DEFAULT_LINES || '')
  .split(',')
  .map(v => Number(String(v).trim()))
  .filter(Number.isFinite);

// Frota usada apenas quando DEFAULT_VEHICLES não for informado.
// A API FLITS normalmente trabalha melhor recebendo os IDs de veículos monitorados.
const FALLBACK_VEHICLES = [
  129923, 129922, 129616, 129615, 129614, 129991, 129607, 119919, 119917,
  129606, 119968, 119403, 113995, 119920, 119918, 129987, 119916, 119389,
  129988, 119915, 119387, 129992, 129989, 129956, 129955
];

let authState = {
  accessToken: process.env.CITTATI_TOKEN || '',
  expiresAt: 0,
  preference: null
};

const memory = {
  lastPointIndexByVehicle: new Map(),
  insideByVehicle: new Map(),
  history: [],
  lastState: null
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function nowIso() { return new Date().toISOString(); }

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

function lineCodeVariants(...codes) {
  const variants = new Set();
  for (const code of codes) {
    const normalized = normalizeText(code);
    if (!normalized) continue;
    variants.add(normalized);
    variants.add(normalized.replace(/^0+(?=\d)/, ''));
  }
  return [...variants].filter(Boolean);
}

function lineMatches(vehicle, requestedCode = LINE_CODE) {
  if (!STRICT_LINE_FILTER) return true;
  const expected = lineCodeVariants(requestedCode, LINE_CODE_ALT);
  if (!expected.length) return true;
  return [vehicle.line, vehicle.route, vehicle.lineId, vehicle.routeId].some(value => {
    const candidate = normalizeText(value);
    return expected.some(code => candidate.includes(code));
  });
}

function missingConfig() {
  const missing = [];
  const hasLogin = Boolean(CITTATI_USERNAME && CITTATI_PASSWORD);
  const hasToken = Boolean(authState.accessToken);
  if (!CITTATI_BASE_URL) missing.push('CITTATI_BASE_URL');
  if (!CITTATI_COMPANY_ID) missing.push('CITTATI_COMPANY_ID');
  if (!hasLogin && !hasToken) missing.push('CITTATI_USERNAME/CITTATI_PASSWORD ou CITTATI_TOKEN');
  return missing;
}

function isTokenFresh() {
  return Boolean(authState.accessToken && authState.expiresAt && Date.now() < authState.expiresAt - 60_000);
}

async function authenticate() {
  if (!CITTATI_USERNAME || !CITTATI_PASSWORD) {
    if (authState.accessToken) return authState.accessToken;
    throw new Error('Informe CITTATI_USERNAME/CITTATI_PASSWORD ou CITTATI_TOKEN no .env');
  }

  const form = new FormData();
  form.append('client_id', 'cittati');
  form.append('scope', 'flits flits_fret');
  form.append('password', CITTATI_PASSWORD);
  form.append('username', CITTATI_USERNAME);

  const response = await fetch(`${CITTATI_BASE_URL}/api/auth/authenticate`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      AppCode: CITTATI_APP_CODE,
      ClientId: CITTATI_CLIENT_ID
    },
    body: form
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha no login FLITS: HTTP ${response.status} - ${text.slice(0, 300)}`);
  }

  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Login FLITS não retornou JSON: ${text.slice(0, 300)}`); }

  if (!data.access_token) throw new Error('Login FLITS não retornou access_token');

  authState = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    preference: data.preference || null
  };

  return authState.accessToken;
}

async function getAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && isTokenFresh()) return authState.accessToken;
  if (!forceRefresh && authState.accessToken && !CITTATI_USERNAME) return authState.accessToken;
  return authenticate();
}

function normalizeVehicle(v) {
  return {
    id: v.companyVehicleId || v.id || v.vehicleId,
    prefix: v.companyVehiclePrefix || v.prefix || String(v.companyVehicleId || v.id || v.vehicleId || ''),
    company: v.companyName || '',
    lineId: v.companyLineId ?? v.lineId ?? null,
    line: v.companyLineDescription || v.line || '',
    routeId: v.tripRouteId ?? v.routeId ?? null,
    route: v.tripRouteDescription || v.route || '',
    direction: v.direction || '',
    velocity: v.velocity ?? null,
    ignition: Boolean(v.ignition),
    accessibility: Boolean(v.hasAcessibility),
    vehicleType: v.vehicleType || '',
    latitude: Number(v.latitude ?? v.lat),
    longitude: Number(v.longitude ?? v.lng),
    gpsDatetime: v.gpsDatetime || v.gpsDateTime || v.updatedAt || '',
    transmissionDateTime: v.transmissionDateTime || '',
    lastPointName: v.lastGeographicPointName || '',
    lastPointAddress: v.lastGeographicPointAdrres || v.lastGeographicPointAddress || '',
    raw: v
  };
}

async function fetchPositionsWithToken(token, payload) {
  return fetch(`${CITTATI_BASE_URL}/api/mapView/findLastVehiclesPositions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
      CompanyId: CITTATI_COMPANY_ID,
      AppCode: CITTATI_APP_CODE,
      ClientId: CITTATI_CLIENT_ID
    },
    body: JSON.stringify(payload)
  });
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  return data.items || data.data || data.list || data.vehicles || [];
}

async function fetchRealVehicles({ lineCode = LINE_CODE, vehicles = [], lines = [] } = {}) {
  const missing = missingConfig();
  if (missing.length) throw new Error(`Configuração incompleta: ${missing.join(', ')}`);

  const selectedVehicles = Array.isArray(vehicles) && vehicles.length
    ? vehicles.map(Number).filter(Number.isFinite)
    : (DEFAULT_VEHICLES.length ? DEFAULT_VEHICLES : FALLBACK_VEHICLES);

  const selectedLines = Array.isArray(lines) && lines.length
    ? lines.map(Number).filter(Number.isFinite)
    : DEFAULT_LINES;

  const payload = { lines: selectedLines, vehicles: selectedVehicles };

  let token = await getAccessToken();
  let response = await fetchPositionsWithToken(token, payload);
  if (response.status === 401 && CITTATI_USERNAME && CITTATI_PASSWORD) {
    token = await getAccessToken({ forceRefresh: true });
    response = await fetchPositionsWithToken(token, payload);
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`Erro ao consultar FLITS: HTTP ${response.status} - ${text.slice(0, 500)}`);

  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Resposta FLITS não veio em JSON: ${text.slice(0, 500)}`); }

  const allVehicles = extractList(data)
    .map(normalizeVehicle)
    .filter(v => Number.isFinite(v.latitude) && Number.isFinite(v.longitude));

  const vehiclesFiltered = allVehicles.filter(v => lineMatches(v, lineCode));

  return { allVehicles, vehicles: vehiclesFiltered, payload };
}

function toRad(value) { return value * Math.PI / 180; }
function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function gpsAgeSeconds(vehicle) {
  const d = new Date(vehicle.gpsDatetime || vehicle.transmissionDateTime || 0);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
}

function getPointTime(point) { return point.scheduledTime || ''; }

function buildMockVehicle() {
  const points = line001A.points;
  const cycleSeconds = 210;
  const elapsed = Math.floor(Date.now() / 1000) % cycleSeconds;
  const t = elapsed / cycleSeconds;
  const raw = t * (points.length - 1);
  const idx = Math.min(points.length - 2, Math.floor(raw));
  const local = raw - idx;
  const a = points[idx];
  const b = points[idx + 1];
  return {
    id: line001A.mockVehicle.id,
    prefix: line001A.mockVehicle.prefix,
    line: LINE_CODE,
    route: line001A.service,
    velocity: 24,
    latitude: a.lat + (b.lat - a.lat) * local,
    longitude: a.lng + (b.lng - a.lng) * local,
    gpsDatetime: nowIso(),
    mock: true
  };
}

function findNearestPoint(vehicle) {
  const here = { lat: vehicle.latitude, lng: vehicle.longitude };
  return line001A.points
    .map((point, index) => ({ point, index, distance: distanceMeters(here, point) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function pushHistory(item) {
  memory.history.unshift(item);
  memory.history = memory.history.slice(0, 150);
}

function evaluateGeofence(vehicle) {
  const vehicleKey = String(vehicle.id || vehicle.prefix || 'sem-prefixo');
  const nearest = findNearestPoint(vehicle);
  const lastIndex = memory.lastPointIndexByVehicle.get(vehicleKey) ?? -1;
  const insideKey = `${vehicleKey}:${nearest.index}`;
  const wasInside = memory.insideByVehicle.get(insideKey) || false;
  const isInside = nearest.distance <= nearest.point.radiusEnter;
  let currentIndex = Math.max(lastIndex, 0);
  let event = null;

  if (isInside && !wasInside) {
    currentIndex = Math.max(lastIndex, nearest.index);
    memory.lastPointIndexByVehicle.set(vehicleKey, currentIndex);
    memory.insideByVehicle.set(insideKey, true);
    event = {
      type: 'passed_stop',
      title: `Passou no ponto ${nearest.point.name}`,
      text: `Linha ${LINE_CODE} - Carro ${vehicle.prefix || vehicle.id} - ${Math.round(nearest.distance)} m do ponto - GPS ${new Date(vehicle.gpsDatetime || Date.now()).toLocaleString('pt-BR')}`,
      pointId: nearest.point.id,
      pointName: nearest.point.name,
      distance: Math.round(nearest.distance),
      vehicle: vehicle.prefix || vehicle.id,
      createdAt: nowIso(),
      gpsDatetime: vehicle.gpsDatetime || null
    };
    pushHistory(event);

    if (nearest.index === line001A.points.length - 1) {
      pushHistory({
        type: 'line_reset',
        title: 'Linha reiniciada',
        text: 'O ponto final foi atendido. A verificação voltou para o primeiro ponto.',
        createdAt: nowIso()
      });
      setTimeout(() => {
        memory.lastPointIndexByVehicle.set(vehicleKey, -1);
        memory.insideByVehicle.clear();
      }, 30_000);
    }
  }

  if (!isInside && wasInside && nearest.distance >= nearest.point.radiusExit) {
    memory.insideByVehicle.set(insideKey, false);
  }

  if (lastIndex < 0 && nearest.distance > nearest.point.radiusEnter) {
    currentIndex = Math.max(0, Math.min(nearest.index, line001A.points.length - 1));
  }

  const nextIndex = Math.min(currentIndex + 1, line001A.points.length - 1);
  const nextPoint = line001A.points[nextIndex];
  const finalPoint = line001A.points[line001A.points.length - 1];
  const distanceToNext = distanceMeters({ lat: vehicle.latitude, lng: vehicle.longitude }, nextPoint);
  const etaMinutes = Math.max(1, Math.ceil(distanceToNext / 280));
  const ageSeconds = gpsAgeSeconds(vehicle);
  const gpsStatus = ageSeconds === null ? 'unknown' : ageSeconds > STALE_AFTER_SECONDS ? 'stale' : 'online';

  return {
    currentIndex,
    nextIndex,
    passed: line001A.points.slice(0, Math.max(0, currentIndex + 1)).map(p => p.id),
    nearest: {
      pointId: nearest.point.id,
      pointName: nearest.point.name,
      distance: Math.round(nearest.distance),
      inside: isInside,
      radiusEnter: nearest.point.radiusEnter,
      radiusExit: nearest.point.radiusExit
    },
    nextPoint: {
      id: nextPoint.id,
      name: nextPoint.name,
      displayName: nextPoint.displayName,
      distance: Math.round(distanceToNext),
      etaMinutes,
      etaText: etaMinutes === 1 ? '1 minuto' : `${etaMinutes} minutos`
    },
    finalPoint: {
      id: finalPoint.id,
      name: finalPoint.name,
      etaText: currentIndex >= line001A.points.length - 1 ? 'Chegou' : `${Math.max(1, Math.ceil(distanceMeters({ lat: vehicle.latitude, lng: vehicle.longitude }, finalPoint) / 330))} minutos`
    },
    gps: { ageSeconds, status: gpsStatus, staleAfterSeconds: STALE_AFTER_SECONDS },
    event
  };
}

function publicLine() {
  return { ...line001A, points: line001A.points.map(p => ({ ...p, time: getPointTime(p) })) };
}

function emptyProgress(message) {
  return {
    currentIndex: -1,
    nextIndex: 0,
    passed: [],
    nearest: { pointId: null, pointName: 'Sem veículo localizado', distance: null, inside: false },
    nextPoint: { id: line001A.points[0].id, name: line001A.points[0].name, displayName: line001A.points[0].displayName, distance: null, etaMinutes: null, etaText: 'aguardando GPS real' },
    finalPoint: { id: line001A.points.at(-1).id, name: line001A.points.at(-1).name, etaText: 'aguardando GPS real' },
    gps: { ageSeconds: null, status: 'no_vehicle', staleAfterSeconds: STALE_AFTER_SECONDS },
    event: null,
    message
  };
}

async function buildPocState({ preferMock = false } = {}) {
  const warnings = [];
  let source = 'flits';
  let vehicle = null;
  let progress;
  let meta = {};

  if (preferMock) {
    if (!ALLOW_MOCK) throw new Error('Mock bloqueado. Para simular, defina ALLOW_MOCK=true no .env.');
    source = 'mock';
    vehicle = buildMockVehicle();
    progress = evaluateGeofence(vehicle);
  } else {
    const { allVehicles, vehicles, payload } = await fetchRealVehicles({ lineCode: LINE_CODE });
    meta = { requestedPayload: payload, totalReturnedByApi: allVehicles.length, totalAfterLineFilter: vehicles.length, strictLineFilter: STRICT_LINE_FILTER };
    if (!vehicles.length) {
      warnings.push(`API real consultada, mas nenhum veículo compatível com ${LINE_CODE}/${LINE_CODE_ALT} foi localizado. Verifique DEFAULT_VEHICLES, DEFAULT_LINES ou STRICT_LINE_FILTER=false.`);
      progress = emptyProgress(warnings[0]);
    } else {
      vehicle = vehicles[0];
      progress = evaluateGeofence(vehicle);
      const age = progress.gps.ageSeconds;
      if (age !== null && age > STALE_AFTER_SECONDS) warnings.push(`GPS recebido, mas está antigo: ${age}s desde o último gpsDatetime.`);
    }
  }

  const state = {
    ok: true,
    source,
    mode: source === 'flits' ? 'real' : 'mock',
    updatedAt: nowIso(),
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    line: publicLine(),
    vehicle,
    progress,
    history: memory.history,
    warnings,
    meta
  };
  memory.lastState = state;
  return state;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mode: 'real-flits',
    mockAllowed: ALLOW_MOCK,
    missingConfig: missingConfig(),
    baseUrl: CITTATI_BASE_URL,
    appCode: CITTATI_APP_CODE,
    clientId: CITTATI_CLIENT_ID,
    companyIdConfigured: Boolean(CITTATI_COMPANY_ID),
    loginConfigured: Boolean(CITTATI_USERNAME && CITTATI_PASSWORD),
    tokenInMemory: Boolean(authState.accessToken),
    tokenFresh: isTokenFresh(),
    expiresAt: authState.expiresAt ? new Date(authState.expiresAt).toISOString() : null,
    lineCode: LINE_CODE,
    lineCodeAlt: LINE_CODE_ALT,
    defaultVehiclesCount: DEFAULT_VEHICLES.length || FALLBACK_VEHICLES.length,
    strictLineFilter: STRICT_LINE_FILTER,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    staleAfterSeconds: STALE_AFTER_SECONDS
  });
});

app.get('/api/lines/001A', (req, res) => res.json(publicLine()));
app.get('/api/lines/01A', (req, res) => res.json(publicLine()));

app.post('/api/auth/login', async (req, res) => {
  try {
    const missing = missingConfig();
    if (missing.length) return res.status(500).json({ error: 'Configuração incompleta no .env', missing });
    await authenticate();
    res.json({ ok: true, expiresAt: authState.expiresAt ? new Date(authState.expiresAt).toISOString() : null });
  } catch (err) {
    res.status(401).json({ error: 'Não foi possível autenticar', message: err.message });
  }
});

app.post('/api/vehicles/positions', async (req, res) => {
  try {
    const result = await fetchRealVehicles({
      lineCode: typeof req.body.lineCode === 'string' ? req.body.lineCode.trim() : LINE_CODE,
      vehicles: Array.isArray(req.body.vehicles) ? req.body.vehicles : [],
      lines: Array.isArray(req.body.lines) ? req.body.lines : []
    });
    res.json({
      count: result.vehicles.length,
      totalReturnedByApi: result.allVehicles.length,
      updatedAt: nowIso(),
      source: 'flits',
      filter: { lineCode: req.body.lineCode || LINE_CODE, strictLineFilter: STRICT_LINE_FILTER },
      vehicles: result.vehicles
    });
  } catch (err) {
    res.status(500).json({ error: 'Falha interna no proxy real FLITS', message: err.message });
  }
});

app.get('/api/poc/001A/state', async (req, res) => {
  try {
    const preferMock = req.query.mock === 'true';
    res.json(await buildPocState({ preferMock }));
  } catch (err) {
    res.status(500).json({ ok: false, source: 'flits', mode: 'real', error: err.message, updatedAt: nowIso() });
  }
});

app.get('/api/poc/001A/history', (req, res) => res.json({ ok: true, updatedAt: nowIso(), history: memory.history }));

app.get('/api/poc/001A/debug', (req, res) => {
  res.json({ ok: true, lastState: memory.lastState, history: memory.history });
});

app.post('/api/poc/001A/reset', (req, res) => {
  memory.lastPointIndexByVehicle.clear();
  memory.insideByVehicle.clear();
  memory.history = [];
  res.json({ ok: true, message: 'Memória de geofence reiniciada.' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mapa.html')));

app.listen(PORT, () => {
  console.log(`PushBus POC REAL 001A em http://localhost:${PORT}`);
  console.log('Modo padrão: FLITS/Cittati real. Sem fallback mock automático.');
});
