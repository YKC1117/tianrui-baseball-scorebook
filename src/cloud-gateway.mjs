/**
 * TianRui v1.5 REST adapter for a dedicated Supabase backend.
 * Safe for a public static frontend: API URL + publishable key ONLY.
 * NEVER place passwords, refresh tokens, service_role or other secrets in GitHub.
 *
 * Writes accept a durable operation ID so a lost response can be retried safely.
 */
export class CloudError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'CloudError';
    this.code = code || 'UNKNOWN';
    this.status = status || 0;
  }
}

export class TianRuiCloud {
  constructor({ projectUrl, publishableKey, fetchImpl = (...args) => globalThis.fetch(...args), storage = (typeof sessionStorage === 'undefined' ? null : sessionStorage), timeoutMs = 15000 } = {}) {
    if (typeof projectUrl !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(projectUrl))
      throw new Error('Supabase project URL must be HTTPS');
    if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))
      throw new Error('Use a Supabase publishable key, never a service-role key');
    this.url = projectUrl.replace(/\/+$/, '');
    this.key = publishableKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.authGeneration = 0;
    this.storage = storage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    this.sessionKey = `TR_SECURE_AUTH_V15:${this.url}`;
    this.session = null;
    try { this.session = JSON.parse(this.storage.getItem(this.sessionKey) || 'null'); } catch {}
  }

  get signedIn() { return Boolean(this.session?.access_token); }
  get expiresAt() { return this.session?.expires_at || 0; }

  async _request(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, {cache:'no-store',...options, signal:controller.signal});
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
      return {response,payload};
    } catch {
      throw new CloudError('無法連線。資料尚未同步，請保留本機草稿。', 'OFFLINE');
    } finally { clearTimeout(timer); }
  }

  async _fetch(path, { method = 'GET', body, auth = true, accept, retry = true } = {}) {
    if (auth && !this.signedIn) throw new CloudError('必須先登入', 'NOT_SIGNED_IN', 401);
    if (auth && this.expiresAt && Date.now() >= this.expiresAt - 90_000) await this._refresh();
    const headers = {
      'apikey': this.key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accept ? { Accept: accept } : {}),
      ...(auth ? { Authorization: `Bearer ${this.session.access_token}` } : {})
    };
    const {response,payload} = await this._request(path, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    if (response.status === 401 && auth && retry && this.session?.refresh_token) {
      await this._refresh();
      return this._fetch(path, { method, body, auth, accept, retry: false });
    }
    if (!response.ok) {
      if (auth && path.startsWith('/auth/') && [401,403].includes(response.status)) {
        this.clearSession();
        throw new CloudError('登入已失效，請重新登入', 'SESSION_EXPIRED', response.status);
      }
      const detail = payload?.message || payload?.msg || payload?.error_description || payload?.error || '伺服器拒絕操作';
      const known = ['REVISION_CONFLICT','NOT_RECORDING_LEASE_HOLDER','ADMIN_REQUIRED','NOT_APPROVED','SESSION_REVOKED','OPERATION_ID_REUSED','RECORDER_REQUIRED'];
      const code = known.find(code => detail.includes(code)) || payload?.error_code || payload?.code || `HTTP_${response.status}`;
      throw new CloudError(detail, code, response.status);
    }
    return payload;
  }

  _storeSession(payload) {
    if (!payload?.access_token || !payload?.refresh_token) throw new CloudError('認證回應不完整', 'BAD_SESSION');
    this.session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: Date.now() + Number(payload.expires_in || 3600) * 1000
      , user_id: payload.user?.id || this.session?.user_id
    };
    this.storage.setItem(this.sessionKey, JSON.stringify(this.session));
    return true;
  }

  async _refresh() {
    if (!this.refreshing) this.refreshing = this._refreshOnce().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async _refreshOnce() {
    const generation = this.authGeneration;
    const token = this.session?.refresh_token;
    if (!token) throw new CloudError('登入已過期，請重新登入', 'SESSION_EXPIRED');
    const {response:reply,payload} = await this._request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': this.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token })
      });
    if(generation !== this.authGeneration) throw new CloudError('登入狀態已變更','SESSION_EXPIRED');
    if(reply.status>=500)throw new CloudError('認證服務暫時無法使用，保留本機登入與草稿','OFFLINE',reply.status);
    if (!reply.ok) {
      this.clearSession();
      throw new CloudError('登入已失效，請重新登入', 'SESSION_EXPIRED', reply.status);
    }
    return this._storeSession(payload);
  }

  clearSession() { this.authGeneration++; this.session = null; this.storage.removeItem(this.sessionKey); }

  async signIn(email, password) {
    this.clearSession();
    if (!email?.trim() || !password) throw new CloudError('請輸入共用帳號與密碼', 'CREDENTIALS_REQUIRED');
    const payload = await this._fetch('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false,
      body: { email: email.trim(), password }
    });
    this._storeSession(payload);
    try {
      const role = await this.memberRole();
      if (!['admin','recorder'].includes(role)) throw new CloudError('未核准帳號', 'NOT_APPROVED');
      return role;
    } catch (error) {
      this.clearSession();
      throw error;
    }
  }

  async verifySession() { return this._fetch('/auth/v1/user'); }
  async memberRole() { return this.rpc('tr_member_role', {}); }

  async signOut() {
    try { if (this.signedIn) await this._fetch('/auth/v1/logout?scope=local', { method: 'POST', retry: false }); }
    finally { this.clearSession(); }
  }

  async rpc(name, params) {
    const allowed = new Set(['tr_member_role','tr_save_document','tr_create_game','tr_acquire_lease','tr_release_lease','tr_save_game']);
    if (!allowed.has(name)) throw new CloudError('RPC not allowed', 'RPC_NOT_ALLOWED');
    return this._fetch(`/rest/v1/rpc/${name}`, { method: 'POST', body: params });
  }

  async getDocument(key) {
    if (!['roster','schedule'].includes(key)) throw new CloudError('Invalid key', 'BAD_KEY');
    const rows = await this._fetch(`/rest/v1/tr_documents?select=doc_key,document,revision,updated_at&doc_key=eq.${key}&limit=1`);
    return rows?.[0] || null;
  }

  async saveDocument(key, expectedRevision, document, recorderName, operation = 'EDIT', operationId = crypto.randomUUID()) {
    this._assertRecorder(recorderName);
    const rev = await this.rpc('tr_save_document', {
      p_key: key, p_expected_revision: expectedRevision, p_document: document,
      p_recorder_name: recorderName.trim(), p_operation_id: operationId, p_operation: operation
    });
    return Number(rev);
  }

  async listGames() {
    const all = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this._fetch(`/rest/v1/tr_games?select=game_id,revision,state,updated_at&order=game_id.asc&limit=100&offset=${offset}`);
      all.push(...page);
      if (page.length < 100) return all;
    }
  }

  async getGame(gameId) {
    const rows = await this._fetch(`/rest/v1/tr_games?select=game_id,revision,state,updated_at&game_id=eq.${encodeURIComponent(gameId)}&limit=1`);
    return rows?.[0] || null;
  }

  async createGame(game, recorderName, operationId = crypto.randomUUID(), holderToken) {
    this._assertRecorder(recorderName);
    if (!game?.id || !holderToken) throw new CloudError('Game ID and device lease token required', 'BAD_GAME');
    return this.rpc('tr_create_game', {
      p_game_id: game.id, p_state: game, p_recorder_name: recorderName.trim(),
      p_operation_id: operationId, p_holder_token: holderToken
    });
  }

  async acquireLease(gameId, token, recorderName) {
    this._assertRecorder(recorderName);
    return this.rpc('tr_acquire_lease', {
      p_game_id: gameId, p_holder_token: token,
      p_recorder_name: recorderName.trim()
    });
  }

  async releaseLease(gameId, token) {
    return this.rpc('tr_release_lease', { p_game_id: gameId, p_holder_token: token });
  }

  async saveGame(game, expectedRevision, token, recorderName, operation = 'EDIT', operationId = crypto.randomUUID()) {
    this._assertRecorder(recorderName);
    if (!game?.id || !token) throw new CloudError('Invalid save request', 'BAD_GAME');
    const nextRevision = await this.rpc('tr_save_game', {
      p_game_id: game.id, p_expected_revision: expectedRevision, p_state: game,
      p_recorder_name: recorderName.trim(), p_holder_token: token,
      p_operation_id: operationId, p_operation: operation
    });
    return Number(nextRevision);
  }

  _assertRecorder(name) {
    if (!name || !name.trim() || name.trim().length > 32)
      throw new CloudError('紀錄人員姓名必填（最多 32 字）', 'RECORDER_REQUIRED');
  }
}
