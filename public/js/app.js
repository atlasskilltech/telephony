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

// ---- Dashboard page component ----
window.dashboardPage = function dashboardPage() {
  return {
    stats: {},
    loading: true,
    async init() {
      const res = await api.get('/api/v1/dashboard');
      this.stats = res.data.stats;
      this.loading = false;
      this.renderFunnel(res.data.funnel);
      this.renderTrend(res.data.callTrend);
    },
    renderFunnel(funnel) {
      const ctx = document.getElementById('funnelChart');
      if (!ctx) return;
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: funnel.map((f) => f.stage.replace(/_/g, ' ')),
          datasets: [{ label: 'Leads', data: funnel.map((f) => f.count), backgroundColor: '#6366f1', borderRadius: 6 }],
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    },
    renderTrend(trend) {
      const ctx = document.getElementById('trendChart');
      if (!ctx) return;
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: trend.map((t) => t.date),
          datasets: [
            { label: 'Total', data: trend.map((t) => t.total), borderColor: '#8b5cf6', tension: 0.3 },
            { label: 'Connected', data: trend.map((t) => t.connected), borderColor: '#22c55e', tension: 0.3 },
          ],
        },
        options: { plugins: { legend: { position: 'bottom' } } },
      });
    },
  };
};

// ---- Leads page component ----
window.leadsPage = function leadsPage() {
  return {
    leads: [],
    meta: {},
    filters: { search: '', pipeline_stage: '', page: 1 },
    loading: true,
    showCreate: false,
    form: { first_name: '', phone: '', email: '', course: '', city: '' },
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
    },
    async load() {
      this.loading = true;
      const q = new URLSearchParams(
        Object.entries(this.filters).filter(([, v]) => v !== '' && v != null)
      ).toString();
      const res = await api.get(`/api/v1/leads?${q}`);
      this.leads = res.data;
      this.meta = res.meta;
      this.loading = false;
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
