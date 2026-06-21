let map, busMarker, routeLine, traveledLine, stopLayer;
const $ = (id) => document.getElementById(id);

function busIcon(label) {
  return L.divIcon({ className: '', html: `<div class="bus-marker">${label || 'BUS'}</div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
}
function stopIcon(type) {
  const isIntegration = String(type || '').toUpperCase().includes('INTEGRA');
  return L.divIcon({ className: '', html: `<div class="stop-marker ${isIntegration ? 'integration' : ''}"></div>`, iconSize: [25, 25], iconAnchor: [12, 12] });
}
function initMap(points) {
  map = L.map('map', { zoomControl: false }).setView([-23.5716, -48.0252], 14);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  L.control.layers({ 'CARTO Voyager': carto, 'Esri Streets': esri }, null, { position: 'topright' }).addTo(map);

  const route = points.map(p => [p.lat, p.lng]);
  routeLine = L.polyline(route, { color: '#005d2c', weight: 6, opacity: .72, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  traveledLine = L.polyline([], { color: '#22a652', weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  stopLayer = L.layerGroup().addTo(map);
  points.forEach(p => {
    L.circle([p.lat, p.lng], { radius: p.radiusEnter, color: '#18863f', weight: 1, fillColor: '#22a652', fillOpacity: .08 }).addTo(stopLayer);
    L.marker([p.lat, p.lng], { icon: stopIcon(p.type) })
      .bindPopup(`<strong>${p.name}</strong><br>${p.fullName}<br>${p.street}<br><small>${p.type}</small>`)
      .addTo(stopLayer);
  });
  busMarker = L.marker(route[0], { icon: busIcon('BUS') }).addTo(map);
  fitMap();
}
function fitMap() {
  if (!routeLine) return;
  map.fitBounds(routeLine.getBounds(), { padding: [28, 28] });
}
function renderTable(points, progress) {
  const passed = new Set(progress?.passed || []);
  $('pointsBody').innerHTML = points.map(p => {
    const status = passed.has(p.id) ? 'Atendido' : (progress?.nextPoint?.id === p.id ? 'Próximo' : 'Aguardando');
    return `<tr>
      <td data-label="#">${String(p.order).padStart(2, '0')}</td>
      <td data-label="Ponto"><strong>${p.name}</strong><br><span class="muted">${p.fullName}</span></td>
      <td data-label="Horário">${p.time || '-'}</td>
      <td data-label="Tipo"><span class="pill ${p.type === 'INTEGRAÇÃO' ? 'green' : ''}">${p.type || '-'}</span></td>
      <td data-label="Status">${status}</td>
    </tr>`;
  }).join('');
}
function renderState(data) {
  const { line, vehicle, progress } = data;
  if (!map) initMap(line.points);

  $('sourceText').textContent = data.source === 'flits' ? 'Telemetria real FLITS/Cittati' : 'Mock de simulação local';
  $('warning').textContent = (data.warnings || []).join(' ');
  $('warning').classList.toggle('show', Boolean((data.warnings || []).length));

  if (!vehicle) {
    busMarker.setOpacity(0);
    traveledLine.setLatLngs([]);
    $('vehicleText').textContent = 'Nenhum carro real da Linha 001A localizado';
    $('nearestText').textContent = progress?.message || 'Aguardando retorno da API real';
    $('nextText').textContent = 'Aguardando GPS real';
    $('gpsText').textContent = 'sem GPS';
    $('eventText').textContent = 'API consultada, mas sem veículo compatível no momento';
    renderTable(line.points, progress || { passed: [] });
    return;
  }

  const latlng = [vehicle.latitude, vehicle.longitude];
  busMarker.setOpacity(1);
  busMarker.setLatLng(latlng);
  busMarker.setIcon(busIcon(vehicle.prefix || vehicle.id));
  const traveled = line.points.slice(0, Math.max(1, progress.currentIndex + 1)).map(p => [p.lat, p.lng]);
  traveled.push(latlng);
  traveledLine.setLatLngs(traveled);
  $('vehicleText').textContent = `Carro ${vehicle.prefix || vehicle.id} · Linha ${vehicle.line || '01A'} · ${progress.gps.status}`;
  $('nearestText').textContent = `${progress.nearest.pointName} · ${progress.nearest.distance} m`;
  $('nextText').textContent = `${progress.nextPoint.displayName} · ${progress.nextPoint.etaText}`;
  $('gpsText').textContent = `${API.formatClock(vehicle.gpsDatetime)} · ${API.formatGpsAge(progress)}`;
  $('eventText').textContent = progress.event ? progress.event.title : 'Aguardando entrada em geofence real';
  renderTable(line.points, progress);
}
async function tick() {
  try { renderState(await API.state()); } catch (err) { console.error(err); $('warning').textContent = err.message; $('warning').classList.add('show'); }
}
document.addEventListener('DOMContentLoaded', () => {
  $('fitBtn')?.addEventListener('click', fitMap);
  $('refreshBtn')?.addEventListener('click', tick);
  tick();
  setInterval(tick, 5000);
});
