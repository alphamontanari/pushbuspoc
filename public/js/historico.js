const $ = (id) => document.getElementById(id);
function fallbackItem(data) {
  if (!data.vehicle) {
    return {
      title: 'Aguardando ônibus real da Linha 001A',
      text: (data.warnings || [])[0] || 'A API real foi consultada, mas ainda não retornou veículo compatível.',
      createdAt: data.updatedAt
    };
  }
  return {
    title: data.progress?.event?.title || `Próximo ponto: ${data.progress?.nextPoint?.displayName || '-'}`,
    text: data.progress?.event?.text || `Carro ${data.vehicle?.prefix || '-'} · ${data.progress?.nearest?.distance || '-'} m do ponto mais próximo · GPS ${API.formatGpsAge(data.progress)} · ${API.formatClock(data.updatedAt)}`,
    createdAt: data.updatedAt
  };
}
function renderHistory(data) {
  $('modeText').textContent = data.source === 'flits' ? 'Geofence · FLITS REAL' : 'Geofence · mock';
  const items = (data.history && data.history.length) ? data.history : [fallbackItem(data)];
  $('historyFeed').innerHTML = items.map(item => `<article class="history-item">
    <h2>${item.title}</h2>
    <p>${API.formatClock(item.createdAt)} - ${item.text}</p>
  </article>`).join('');
}
async function tick() {
  try { renderHistory(await API.state()); } catch (err) { $('historyFeed').innerHTML = `<article class="history-item"><h2>Erro</h2><p>${err.message}</p></article>`; }
}
document.addEventListener('DOMContentLoaded', () => { tick(); setInterval(tick, 5000); });
