const API = {
  async state() {
    const res = await fetch('/api/poc/001A/state', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  async line() {
    const res = await fetch('/api/lines/001A', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  formatClock(value) {
    if (!value) return '--:--';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(11, 16) || '--:--';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },
  formatGpsAge(progress) {
    const gps = progress?.gps || {};
    if (gps.status === 'no_vehicle') return 'sem veículo';
    if (gps.ageSeconds == null) return 'GPS sem horário';
    if (gps.ageSeconds < 60) return `${gps.ageSeconds}s atrás`;
    return `${Math.round(gps.ageSeconds / 60)}min atrás`;
  },
  titleCase(str) {
    return String(str || '').toLowerCase().replace(/(^|\s|\(|-)([a-záéíóúâêôãõç])/g, (m, sep, l) => sep + l.toUpperCase());
  }
};
