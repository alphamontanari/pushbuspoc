const $ = (id) => document.getElementById(id);
function renderTimeline(line, progress) {
  const passed = new Set(progress.passed || []);
  const pct = line.points.length <= 1 ? 0 : ((progress.currentIndex + 1) / line.points.length) * 100;
  const timeline = $('timeline');
  timeline.style.setProperty('--progress', `${Math.max(0, Math.min(100, pct))}%`);
  timeline.innerHTML = line.points.map((p, i) => {
    const done = passed.has(p.id);
    const current = progress.nextPoint?.id === p.id;
    const terminal = i === 0 || String(p.type).includes('INTEGRA');
    return `<div class="stop-row ${done ? 'done' : ''} ${current ? 'current' : ''} ${terminal ? 'terminal' : ''}">
      <span class="marker"></span>
      <span class="time">${p.time || '--:--'}</span>
      <span class="stop-name">${p.name}</span>
      ${current ? '<span class="pill green">Chegando</span>' : ''}
    </div>`;
  }).join('');
}
function renderPhone(data) {
  const { line, vehicle, progress } = data;
  $('clock').textContent = API.formatClock(data.updatedAt);
  $('lineTitle').textContent = line.shortName.toUpperCase();
  $('partida').textContent = line.partida;
  $('chegada').textContent = line.chegada;
  if (!vehicle) {
    $('eventSmall').textContent = 'Aguardando GPS real da Linha 001A';
    $('etaText').textContent = 'Sem veículo compatível retornado pela Cittati/FLITS';
    $('carro').textContent = 'Carro não localizado';
  } else {
    $('eventSmall').textContent = progress.event ? progress.event.title : `Ônibus mais próximo de ${progress.nearest.pointName}`;
    $('etaText').textContent = `${progress.nextPoint.displayName}: ${progress.nextPoint.etaText}`;
    $('carro').textContent = `Carro ${vehicle.prefix || vehicle.id} · GPS ${API.formatGpsAge(progress)}`;
  }
  $('saida').textContent = line.defaultDeparture;
  $('servico').textContent = line.service;
  $('tripType').textContent = line.tripType;
  renderTimeline(line, progress || { passed: [], currentIndex: -1 });
}
async function tick() {
  try { renderPhone(await API.state()); } catch (err) { console.error(err); }
}
document.addEventListener('DOMContentLoaded', () => { tick(); setInterval(tick, 5000); });
