/* global Alpine, io, Chart */
// Shared front-end helpers for the server-rendered dashboard. Auth uses the
// httpOnly access_token cookie, so fetch just needs credentials: 'include'.

const api = {
  async request(method, url, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      // Try a refresh once, then bounce to login.
      const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (r.ok) return api.request(method, url, body);
      window.location.href = '/login';
      return null;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Request failed');
    return json;
  },
  get: (u) => api.request('GET', u),
  post: (u, b) => api.request('POST', u, b),
  put: (u, b) => api.request('PUT', u, b),
  del: (u) => api.request('DELETE', u),
  // Multipart upload (FormData). Don't set Content-Type — the browser adds the
  // multipart boundary. Mirrors request()'s 401-refresh-then-retry behaviour.
  async upload(url, formData) {
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
    if (res.status === 401) {
      const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (r.ok) return api.upload(url, formData);
      window.location.href = '/login';
      return null;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Upload failed');
    return json;
  },
};
window.api = api;

const fmt = {
  duration(sec) {
    sec = Number(sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  },
  date(d) {
    return d ? new Date(d).toLocaleString() : '—';
  },
};
window.fmt = fmt;

// Realtime socket — pushes notifications/toasts.
let socket;
function getSocket() {
  if (!socket) socket = io({ withCredentials: true });
  return socket;
}
window.getSocket = getSocket;

// Notification bell Alpine component.
window.notifBell = function notifBell() {
  return {
    items: [],
    unread: 0,
    async init() {
      await this.load();
      getSocket().on('notification', (n) => {
        this.items.unshift(n);
        this.unread += 1;
      });
    },
    async load() {
      const res = await api.get('/api/v1/notifications');
      this.items = res.data || [];
      this.unread = (res.meta && res.meta.unread) || 0;
    },
  };
};

// ---- Call analysis dashboard component ----
window.dashboardPage = function dashboardPage() {
  // Keep Chart instances OUT of Alpine's reactive state — proxying a Chart (and
  // its canvas) breaks Chart.js internals ("Cannot read ... 'ownerDocument'").
  let charts = {};
  return {
    d: {},
    loading: true,
    metricCards: [],
    filters: { range: '30d', from: '', to: '' },
    scoreColor(s) { return s >= 80 ? '#10b981' : s >= 60 ? '#f59e0b' : '#f43f5e'; },
    scoreBg(s) { return s >= 80 ? 'rgba(16,185,129,.12)' : s >= 60 ? 'rgba(245,158,11,.12)' : 'rgba(244,63,94,.12)'; },
    async init() {
      await this.load();
    },
    rangeLabel() {
      const map = { today: 'today', yesterday: 'yesterday', '7d': 'last 7 days', '30d': 'last 30 days', all: 'all time' };
      if (this.filters.range === 'custom') {
        return this.filters.from && this.filters.to ? `${this.filters.from} → ${this.filters.to}` : 'custom range';
      }
      return map[this.filters.range] || 'last 30 days';
    },
    computeRange() {
      const now = new Date();
      const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const endOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      switch (this.filters.range) {
        case 'today': return { from: startOf(now), to: now };
        case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: startOf(y), to: endOf(y) }; }
        case '7d': { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: startOf(f), to: now }; }
        case 'all': return { all: true };
        case 'custom': return {
          from: this.filters.from ? new Date(`${this.filters.from}T00:00:00`) : null,
          to: this.filters.to ? new Date(`${this.filters.to}T23:59:59`) : null,
        };
        default: { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: startOf(f), to: now }; }
      }
    },
    onRangeChange() { if (this.filters.range !== 'custom') this.load(); },
    async load() {
      this.loading = true;
      const r = this.computeRange();
      const q = new URLSearchParams();
      if (r.all) { q.set('from', ''); q.set('to', ''); }
      else { if (r.from) q.set('from', r.from.toISOString()); if (r.to) q.set('to', r.to.toISOString()); }
      const res = await api.get(`/api/v1/dashboard/call-analytics?${q.toString()}`);
      this.d = res.data || {};
      this.buildCards();
      this.loading = false;
      this.$nextTick(() => this.renderCharts());
    },
    buildCards() {
      const m = this.d.metrics || {};
      const delta = (x, suffix = '') => {
        const v = (x && x.delta) || 0;
        if (!v) return '';
        return `${v > 0 ? '+' : ''}${v}${suffix} vs prev`;
      };
      this.metricCards = [
        { key: 'totalCalls', label: 'Total calls', display: (m.totalCalls?.value ?? 0).toLocaleString(), dir: m.totalCalls?.dir, deltaText: delta(m.totalCalls) },
        { key: 'avgScore', label: 'Avg score', display: `${m.avgScore?.value ?? 0}/100`, dir: m.avgScore?.dir, deltaText: delta(m.avgScore, ' pts') },
        { key: 'handle', label: 'Avg handle time', display: fmt.duration(m.avgHandleSeconds?.value || 0), dir: m.avgHandleSeconds?.dir, deltaText: delta(m.avgHandleSeconds, 's') },
        { key: 'csat', label: 'CSAT proxy', display: `${m.csat?.value ?? 0}%`, dir: m.csat?.dir, deltaText: delta(m.csat, '%') },
        { key: 'resolution', label: 'Resolution', display: `${m.resolution?.value ?? 0}%`, dir: m.resolution?.dir, deltaText: delta(m.resolution, '%') },
      ];
    },
    renderCharts() {
      if (!window.Chart) { setTimeout(() => this.renderCharts(), 80); return; }
      Object.values(charts).forEach((c) => c && c.destroy());
      charts = {};
      const mk = (ref, cfg) => {
        const el = this.$refs[ref];
        if (!el) return;
        try { charts[ref] = new Chart(el, cfg); } catch (e) { console.error('chart', ref, e); }
      };

      const t = this.d.scoreTrend || [];
      mk('trend', {
        data: {
          labels: t.map((x) => x.label),
          datasets: [
            { type: 'bar', label: 'Calls', data: t.map((x) => x.calls), backgroundColor: 'rgba(136,135,128,0.35)', yAxisID: 'y1', order: 2 },
            { type: 'line', label: 'Avg score', data: t.map((x) => x.avgScore), borderColor: '#378ADD', backgroundColor: '#378ADD', tension: 0.35, yAxisID: 'y', pointRadius: 3, spanGaps: true, order: 1 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } },
          scales: { y: { position: 'left', min: 0, max: 100, title: { display: true, text: 'Score' } }, y1: { position: 'right', grid: { display: false }, beginAtZero: true, title: { display: true, text: 'Volume' } } },
        },
      });

      const s = (this.d.sentimentSplit && this.d.sentimentSplit.percent) || { positive: 0, neutral: 0, negative: 0 };
      mk('sent', {
        type: 'doughnut',
        data: { labels: ['Positive', 'Neutral', 'Negative'], datasets: [{ data: [s.positive, s.neutral, s.negative], backgroundColor: ['#10b981', '#888780', '#f43f5e'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false } } },
      });

      const q = this.d.qaRadar || [];
      mk('radar', {
        type: 'radar',
        data: { labels: q.map((x) => x.label), datasets: [{ label: 'Team avg', data: q.map((x) => x.value), borderColor: '#378ADD', backgroundColor: 'rgba(55,138,221,0.18)', pointRadius: 2, pointBackgroundColor: '#378ADD' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 } }, pointLabels: { font: { size: 11 } } } } },
      });
    },
  };
};

// ---- Leads page component ----
window.leadsPage = function leadsPage() {
  return {
    leads: [],
    meta: {},
    filters: { search: '', pipeline_stage: '', assigned_to: '', called: '', min_interest: '', page: 1 },
    loading: true,
    showCreate: false,
    form: { first_name: '', phone: '', email: '', course: '', city: '' },
    // Assignment (single + bulk).
    selected: {},
    assignTo: '',
    assignees: [],
    assigning: false,
    // CSV / Excel import wizard state.
    imp: {
      show: false,
      file: null,
      preview: null,
      mapping: {},
      skipDuplicates: true,
      loading: false,
      report: null,
      error: '',
    },
    async init() {
      await this.load();
      this.loadAssignees();
    },
    async load() {
      this.loading = true;
      this.selected = {};
      const q = new URLSearchParams(
        Object.entries(this.filters).filter(([, v]) => v !== '' && v != null)
      ).toString();
      const res = await api.get(`/api/v1/leads?${q}`);
      this.leads = res.data;
      this.meta = res.meta;
      this.loading = false;
    },
    // Only succeeds for users with leads.assign — drives the assign UI.
    async loadAssignees() {
      try {
        this.assignees = (await api.get('/api/v1/leads/assignees')).data || [];
      } catch (e) {
        this.assignees = [];
      }
    },
    toggle(id) { this.selected[id] = !this.selected[id]; },
    toggleAll(e) {
      const v = e.target.checked;
      this.leads.forEach((l) => { this.selected[l.id] = v; });
    },
    allSelected() {
      return this.leads.length > 0 && this.leads.every((l) => this.selected[l.id]);
    },
    selectedIds() {
      return Object.keys(this.selected).filter((k) => this.selected[k]).map(Number);
    },
    selectedCount() { return this.selectedIds().length; },
    async assignSelected() {
      const ids = this.selectedIds();
      if (!ids.length || !this.assignTo) return;
      this.assigning = true;
      try {
        const res = await api.post('/api/v1/leads/assign-bulk', { ids, user_id: Number(this.assignTo) });
        const r = res.data || {};
        if (r.failed) alert(`Assigned ${r.assigned}, failed ${r.failed}.`);
        this.assignTo = '';
        await this.load();
      } catch (e) {
        alert(e.message);
      } finally {
        this.assigning = false;
      }
    },
    async create() {
      try {
        await api.post('/api/v1/leads', this.form);
        this.showCreate = false;
        this.form = { first_name: '', phone: '', email: '', course: '', city: '' };
        await this.load();
      } catch (e) {
        alert(e.message);
      }
    },
    async call(lead) {
      try {
        await api.post('/api/v1/calls/click-to-call', { lead_id: lead.id });
        alert('Call initiated');
      } catch (e) {
        alert(e.message);
      }
    },

    // ---- CSV/Excel import ----
    openImport() {
      this.imp = {
        show: true,
        file: null,
        preview: null,
        mapping: {},
        skipDuplicates: true,
        loading: false,
        report: null,
        error: '',
      };
    },
    async onImportFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      this.imp.file = file;
      this.imp.report = null;
      this.imp.error = '';
      this.imp.loading = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await api.upload('/api/v1/leads/import/preview', fd);
        this.imp.preview = res.data;
        this.imp.mapping = res.data.suggestedMapping || {};
      } catch (err) {
        this.imp.error = err.message;
      } finally {
        this.imp.loading = false;
      }
    },
    async runImport() {
      if (!this.imp.file) return;
      this.imp.loading = true;
      this.imp.error = '';
      try {
        const fd = new FormData();
        fd.append('file', this.imp.file);
        fd.append('mapping', JSON.stringify(this.imp.mapping));
        fd.append('skip_duplicates', this.imp.skipDuplicates ? 'true' : 'false');
        const res = await api.upload('/api/v1/leads/import', fd);
        this.imp.report = res.data;
        await this.load();
      } catch (err) {
        this.imp.error = err.message;
      } finally {
        this.imp.loading = false;
      }
    },
  };
};
