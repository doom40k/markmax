/* markmax 插件设置页：配置服务端地址与 token，展示书签概况。 */

const $ = (sel) => document.querySelector(sel);

async function load() {
  const cfg = await markmaxApi.loadConfig();
  $('#cfg-server').value = cfg.server || 'http://localhost:8080';
  $('#cfg-token').value = cfg.token || '';
}

async function showInfo() {
  const info = $('#info');
  try {
    const res = await markmaxApi.list();
    const count = (res.bookmarks || []).filter((b) => !b.deleted).length;
    info.innerHTML = `
      <p class="micro-label" style="margin-bottom: 10px">书签概况</p>
      <p class="status-note"><span class="ok-dot"></span>已连接服务端，共 ${count} 条书签</p>`;
  } catch (e) {
    info.innerHTML = `
      <p class="micro-label" style="margin-bottom: 10px">书签概况</p>
      <p class="hint" style="margin-top: 0">${e.message === 'UNAUTHORIZED' ? 'token 无效，请检查配置。' : '暂时无法连接服务端。'}</p>`;
  }
}

async function save() {
  const server = $('#cfg-server').value.trim();
  const token = $('#cfg-token').value.trim();
  const errEl = $('#error');
  const statusEl = $('#status');
  errEl.textContent = '';
  statusEl.textContent = '';
  if (!server || !token) {
    errEl.textContent = '请填写服务端地址和 token';
    return;
  }
  await markmaxApi.saveConfig(server, token);
  statusEl.textContent = '正在连接…';
  try {
    const health = await markmaxApi.health();
    statusEl.innerHTML = `<span class="ok-dot"></span>连接成功（markmax-server v${health.version}）`;
    await showInfo();
  } catch (e) {
    statusEl.textContent = '';
    if (e.message === 'UNAUTHORIZED') errEl.textContent = 'token 无效，请检查服务端地址与 token';
    else if (e.message === 'NETWORK_ERROR') errEl.textContent = '无法连接服务端，请检查地址与网络';
    else errEl.textContent = e.message || '连接失败';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-save').addEventListener('click', save);
  $('#btn-clear').addEventListener('click', async () => {
    if (!window.confirm('清除服务端配置？')) return;
    await markmaxApi.clearConfig();
    $('#cfg-token').value = '';
    $('#status').textContent = '已清除配置';
    $('#info').innerHTML = `
      <p class="micro-label" style="margin-bottom: 10px">书签概况</p>
      <p class="hint" style="margin-top: 0">连接后显示。</p>`;
  });
  void load();
  void showInfo();
});
