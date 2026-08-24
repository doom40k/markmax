/**
 * markmax 插件 API 客户端：直连服务端 REST API。
 *
 * 配置（server + token）存于 chrome.storage.local。
 * 错误码约定：NOT_CONFIGURED（未配置）、UNAUTHORIZED（token 无效）、其余为服务端错误消息。
 */
const markmaxApi = (() => {
  let config = null; // { server, token }

  async function loadConfig() {
    if (config) return config;
    const data = await chrome.storage.local.get(['server', 'token']);
    config = {
      server: (data.server || '').trim().replace(/\/+$/, ''),
      token: (data.token || '').trim(),
    };
    return config;
  }

  async function saveConfig(server, token) {
    config = { server: server.trim().replace(/\/+$/, ''), token: token.trim() };
    await chrome.storage.local.set({ server: config.server, token: config.token });
  }

  async function clearConfig() {
    config = null;
    await chrome.storage.local.remove(['server', 'token']);
  }

  async function req(path, init = {}) {
    const cfg = await loadConfig();
    if (!cfg.server || !cfg.token) throw new Error('NOT_CONFIGURED');
    let res;
    try {
      res = await fetch(cfg.server + path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.token}`,
          ...(init.headers || {}),
        },
      });
    } catch {
      throw new Error('NETWORK_ERROR');
    }
    if (res.status === 401) throw new Error('UNAUTHORIZED');
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.error) message = body.error;
      } catch {
        /* 保留状态码提示 */
      }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    loadConfig,
    saveConfig,
    clearConfig,
    health: () => req('/api/health'),
    list: () => req('/api/bookmarks?deleted=0&limit=5000'),
    create: (b) => req('/api/bookmarks', { method: 'POST', body: JSON.stringify(b) }),
    update: (id, b) => req(`/api/bookmarks/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id) => req(`/api/bookmarks/${id}`, { method: 'DELETE' }),
    folders: () => req('/api/folders'),
  };
})();
