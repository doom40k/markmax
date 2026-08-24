/* markmax 插件主界面：书签列表 + 增删改查（直连服务端 API） */

const $ = (sel) => document.querySelector(sel);
const app = () => document.getElementById('app');

const state = {
  bookmarks: [],
  folders: [],
  allTags: [],
  filterFolder: null, // null = 全部
  filterTag: null,
  currentTab: null, // 当前标签页 { url, title }，新建书签时预填
  query: '',
  view: 'loading', // loading | config | error | list | form
  error: '',
  editing: null,
  form: { title: '', url: '', folder: '', tags: '' },
};

/* ---------- 工具 ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function initialOf(b) {
  const t = (b.title || '').trim();
  if (t) return t[0].toUpperCase();
  return (hostOf(b.url) || '·')[0].toUpperCase();
}

function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

let toastTimer = null;
function toast(message) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------- 生命周期 ---------- */

async function init() {
  // 预取当前标签页（新建书签时默认填充标题与网址）
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:/i.test(tab.url)) {
      state.currentTab = { url: tab.url, title: tab.title || '' };
    }
  } catch {
    /* 忽略 */
  }
  try {
    const cfg = await markmaxApi.loadConfig();
    if (!cfg.server || !cfg.token) {
      state.view = 'config';
      render();
      return;
    }
    await refresh();
  } catch {
    /* 不达 */
  }
}

async function refresh() {
  try {
    const res = await markmaxApi.list();
    state.bookmarks = res.bookmarks || [];
    try {
      const f = await markmaxApi.folders();
      state.folders = (f.folders || []).map((x) => x.name);
    } catch {
      state.folders = [];
    }
    const m = new Map();
    for (const b of state.bookmarks) for (const t of b.tags || []) m.set(t, (m.get(t) || 0) + 1);
    state.allTags = [...m.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    state.view = 'list';
    render();
  } catch (e) {
    if (e.message === 'NOT_CONFIGURED') {
      state.view = 'config';
    } else if (e.message === 'UNAUTHORIZED') {
      state.view = 'config';
      state.error = 'token 无效，请重新配置';
    } else if (e.message === 'NETWORK_ERROR') {
      state.view = 'error';
      state.error = `无法连接服务端。请确认 markmax-server 已启动，并检查设置中的服务端地址。`;
    } else {
      state.view = 'error';
      state.error = e.message || String(e);
    }
    render();
  }
}

/* ---------- 渲染 ---------- */

function shell(inner) {
  return `
    <header class="top">
      <div class="brand">
        <span class="brand-mark">m</span>
        <span class="brand-name">markmax</span>
      </div>
      <div class="top-actions">
        <button class="btn-icon" data-act="settings" title="设置">⚙</button>
        <button class="btn-icon" data-act="refresh" title="刷新">↻</button>
      </div>
    </header>
    ${inner}
  `;
}

function render() {
  const el = app();
  switch (state.view) {
    case 'loading':
      el.innerHTML = `<div class="center mono" style="color:var(--text-muted);font-size:11px;letter-spacing:.2em">加载中…</div>`;
      break;
    case 'config':
      el.innerHTML = shell(configHtml());
      bindConfig();
      break;
    case 'error':
      el.innerHTML = shell(`
        <div class="center">
          <p class="hint">${esc(state.error)}</p>
          <button class="btn btn-ghost" data-act="settings">打开设置</button>
        </div>`);
      break;
    case 'form':
      el.innerHTML = shell(formHtml());
      bindForm();
      break;
    default:
      el.innerHTML = shell(listHtml());
      bindList();
      break;
  }
}

function configHtml() {
  return `
    <div class="center" style="justify-content:flex-start;padding-top:24px;gap:12px">
      <p class="hint" style="width:100%;text-align:left">
        首次使用请配置服务端：<br />
        服务端地址与 API token 可在服务端日志（<code>API token: …</code>）或
        <code>server/data/token</code> 中查看。
      </p>
      <div style="width:100%;text-align:left">
        <label class="field-label">服务端地址</label>
        <input id="cfg-server" class="input" placeholder="http://localhost:8080" spellcheck="false" value="http://localhost:8080" />
      </div>
      <div style="width:100%;text-align:left">
        <label class="field-label">API token</label>
        <input id="cfg-token" class="input" type="password" placeholder="粘贴 token" spellcheck="false" />
      </div>
      <p id="cfg-error" class="form-error" style="width:100%;text-align:left"></p>
      <div style="display:flex;gap:8px;width:100%">
        <button class="btn btn-primary" data-act="save-config" style="flex:1">连接</button>
      </div>
    </div>
  `;
}

function bindConfig() {
  const token = $('#cfg-token');
  if (token) token.focus();
}

function listHtml() {
  return `
    <div class="content">
      <div class="toolbar">
        <div class="search-wrap">
          <span class="slash">/</span>
          <input id="search" class="input search" placeholder="搜索标题、网址、标签…" spellcheck="false" />
        </div>
        <button class="btn btn-primary" data-act="new" title="新建书签">＋</button>
      </div>
      <div class="filters">
        <div class="fselect filter-dd" id="dd-folder">
          <button type="button" class="input fselect-trigger">
            <span class="dd-label" data-placeholder="文件夹"></span>
            <span class="fselect-arrow">▾</span>
          </button>
          <div class="fselect-panel hidden"><div class="fselect-options"></div></div>
        </div>
        <div class="fselect filter-dd" id="dd-tag">
          <button type="button" class="input fselect-trigger">
            <span class="dd-label" data-placeholder="标签"></span>
            <span class="fselect-arrow">▾</span>
          </button>
          <div class="fselect-panel hidden"><div class="fselect-options"></div></div>
        </div>
      </div>
      <div id="list-body" class="list"></div>
      <div class="footer">
        <span id="count-label"></span>
        <span>同步至服务端</span>
      </div>
    </div>
  `;
}

function visibleBookmarks() {
  const q = state.query.trim().toLowerCase();
  return state.bookmarks
    .filter((b) => !b.deleted)
    .filter((b) => {
      // 文件夹：含子文件夹的前缀匹配
      if (state.filterFolder) {
        return b.folder === state.filterFolder || b.folder.startsWith(state.filterFolder + '/');
      }
      return true;
    })
    .filter((b) => !state.filterTag || b.tags.includes(state.filterTag))
    .filter((b) => {
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.folder.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.updated_at - a.updated_at);
}

function renderList() {
  const list = $('#list-body');
  if (!list) return;
  const items = visibleBookmarks();
  $('#count-label').textContent = `${items.length} 条书签`;
  if (items.length === 0) {
    list.innerHTML = `<div class="list-note">${state.query ? '没有匹配的书签' : '还没有书签，点 ＋ 新建一个'}</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (b) => `
      <div class="row" data-id="${esc(b.id)}">
        <div class="row-icon">${esc(initialOf(b))}</div>
        <div class="row-body">
          <a class="row-title" href="${esc(b.url)}" target="_blank" rel="noreferrer" title="${esc(b.title || b.url)}">${esc(b.title || hostOf(b.url))}</a>
          <div class="row-meta mono">${esc(hostOf(b.url))}${b.folder ? ` · ${esc(b.folder)}` : ''}</div>
        </div>
        <div class="row-actions">
          <button class="btn-icon" data-act="copy" title="复制链接">⧉</button>
          <button class="btn-icon" data-act="edit" title="编辑">✎</button>
          <button class="btn-danger-text" data-act="delete" title="删除">✕</button>
        </div>
      </div>`,
    )
    .join('');
}

function bindList() {
  const search = $('#search');
  if (search) {
    search.focus();
    search.oninput = (e) => {
      state.query = e.target.value;
      renderList();
    };
    search.onkeydown = (e) => {
      if (e.key === 'Escape') {
        state.query = '';
        search.value = '';
        renderList();
      }
    };
  }

  /** 通用筛选下拉：items 返回 [{value,label}]，value 为 null/'' 表示“全部”。 */
  function setupDropdown(rootSel, getItems, getValue, setValue) {
    const root = $(rootSel);
    const trigger = root.querySelector('.fselect-trigger');
    const panel = root.querySelector('.fselect-panel');
    const labelEl = trigger.querySelector('.dd-label');

    function syncLabel() {
      const v = getValue();
      labelEl.textContent = v || labelEl.dataset.placeholder;
      trigger.classList.toggle('active', !!v);
    }
    function renderOptions() {
      const cur = getValue();
      const items = [
        { value: '', label: labelEl.dataset.placeholder },
        ...getItems().map((name) => ({ value: name, label: name })),
      ];
      panel.querySelector('.fselect-options').innerHTML = items
        .map(
          (i) => `
          <div class="fselect-option${i.value === cur ? ' selected' : ''}" data-value="${esc(i.value)}">
            <span>${esc(i.label)}</span>
            ${i.value === cur ? '<span class="mono" style="margin-left:auto;font-size:10px">✓</span>' : ''}
          </div>`,
        )
        .join('');
    }
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = panel.classList.contains('hidden');
      closeAllDropdowns();
      if (willOpen) {
        renderOptions();
        panel.classList.remove('hidden');
      }
    });
    panel.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-value]');
      if (!opt) return;
      e.stopPropagation();
      setValue(opt.dataset.value || null);
      syncLabel();
      closeAllDropdowns();
      renderList();
    });
    syncLabel();
  }

  setupDropdown(
    '#dd-folder',
    () => state.folders,
    () => state.filterFolder,
    (v) => {
      state.filterFolder = v;
    },
  );
  setupDropdown(
    '#dd-tag',
    () => state.allTags,
    () => state.filterTag,
    (v) => {
      state.filterTag = v;
    },
  );

  renderList();
}

function closeAllDropdowns() {
  document.querySelectorAll('.fselect-panel').forEach((p) => p.classList.add('hidden'));
}

function formHtml() {
  const f = state.form;
  const isEdit = !!state.editing;
  return `
    <div class="form">
      <div class="form-title">
        <span>${isEdit ? '编辑书签' : '新建书签'}</span>
        <button class="btn-icon" data-act="cancel" title="返回">✕</button>
      </div>
      <div>
        <label class="field-label">标题</label>
        <input id="form-title" class="input" placeholder="示例文档" spellcheck="false" value="${esc(f.title)}" />
      </div>
      <div>
        <label class="field-label">网址 *</label>
        <input id="form-url" class="input" placeholder="https://example.com" spellcheck="false" value="${esc(f.url)}" />
      </div>
      <div>
        <label class="field-label">文件夹</label>
        ${folderSelectHtml(f.folder)}
      </div>
      <div>
        <label class="field-label">标签</label>
        ${tagPickerHtml()}
        <div class="tagpicker-suggest" id="tag-suggest"></div>
      </div>
      <p id="form-error" class="form-error"></p>
      <div class="btn-row">
        <button class="btn btn-ghost" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="save">${isEdit ? '保存修改' : '创建'}</button>
      </div>
    </div>
  `;
}

function bindForm() {
  $('#form-title').focus();

  /* ---- 文件夹下拉 ---- */
  const trigger = $('#fselect-trigger');
  const panel = $('#fselect-panel');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (willOpen) {
      const search = $('#fselect-search');
      search.value = '';
      renderFolderOptions('');
      search.focus();
    }
  });
  $('#fselect-search').addEventListener('input', (e) => renderFolderOptions(e.target.value));
  $('#fselect-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const first = $('#fselect-options [data-value]');
      if (first) selectFolder(first.dataset.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFolderPanel();
    }
  });
  $('#fselect-options').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-value]');
    if (opt) {
      e.stopPropagation();
      selectFolder(opt.dataset.value);
    }
  });

  /* ---- 标签选择器 ---- */
  bindTagPicker();
}

/* ---------- 操作 ---------- */

/* ---------- 文件夹下拉选择器 ---------- */

function folderSelectHtml(value) {
  const has = !!value;
  return `
    <div class="fselect" id="fselect">
      <button type="button" class="input fselect-trigger" id="fselect-trigger">
        <span id="fselect-label" ${has ? '' : 'style="color:var(--text-faint)"'}>${esc(value || '选择或输入文件夹')}</span>
        <span class="fselect-arrow">▾</span>
      </button>
      <div class="fselect-panel hidden" id="fselect-panel">
        <input id="fselect-search" class="input fselect-search" placeholder="搜索或输入新名称…" spellcheck="false" />
        <div class="fselect-options" id="fselect-options"></div>
      </div>
    </div>
  `;
}

function renderFolderOptions(query = '') {
  const q = query.trim().toLowerCase();
  const opts = state.folders.filter((f) => !q || f.toLowerCase().includes(q));
  const input = query.trim();
  const showCreate = input !== '' && !state.folders.includes(input);

  let html = opts
    .map((name) => {
      const parts = name.split('/');
      const last = parts[parts.length - 1];
      const parent = parts.slice(0, -1).join('/');
      const selected = name === state.form.folder;
      return `
        <div class="fselect-option${selected ? ' selected' : ''}" data-value="${esc(name)}">
          ${parent ? `<span class="fselect-parent">${esc(parent)}/</span>` : ''}
          <span>${esc(last)}</span>
          ${selected ? '<span class="mono" style="margin-left:auto;font-size:10px">✓</span>' : ''}
        </div>`;
    })
    .join('');
  if (showCreate) {
    html += `<div class="fselect-option fselect-create" data-value="${esc(input)}">＋ 新建「${esc(input)}」</div>`;
  }
  if (!opts.length && !showCreate) {
    html += `<div class="fselect-empty">没有匹配的文件夹，输入后可新建</div>`;
  }
  $('#fselect-options').innerHTML = html;
}

function selectFolder(name) {
  state.form.folder = name;
  const trigger = $('#fselect-trigger');
  $('#fselect-label').textContent = name;
  $('#fselect-label').removeAttribute('style');
  trigger.classList.remove('placeholder');
  closeFolderPanel();
}

function closeFolderPanel() {
  $('#fselect-panel')?.classList.add('hidden');
}

/* ---------- 标签选择器 ---------- */

function tagPickerHtml() {
  return `<div class="tagpicker-box" id="tag-box"></div>`;
}

function bindTagPicker() {
  let tags = state.form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const box = $('#tag-box');
  const suggest = $('#tag-suggest');

  function sync() {
    state.form.tags = tags.join(', ');
    box.innerHTML =
      tags
        .map(
          (t) => `
          <span class="tag-chip">${esc(t)}<button type="button" class="tag-x" data-tag="${esc(t)}" title="移除">✕</button></span>`,
        )
        .join('') +
      `<input id="tag-input" class="tag-input" placeholder="${tags.length === 0 ? '输入后回车添加' : ''}" spellcheck="false" />`;
    renderSuggest();
    const input = $('#tag-input');
    input.focus();
    input.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        addFrom(e.target.value);
      } else if (e.key === 'Backspace' && !e.target.value && tags.length > 0) {
        tags.pop();
        sync();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
      }
    };
    input.onblur = () => addFrom(input.value);
  }

  function addFrom(raw) {
    const items = raw.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    let added = false;
    for (const item of items) {
      if (!tags.includes(item)) {
        tags.push(item);
        added = true;
      }
    }
    if (added) sync();
  }

  function renderSuggest() {
    const cands = state.allTags.filter((t) => !tags.includes(t)).slice(0, 12);
    suggest.innerHTML = cands.length
      ? cands.map((t) => `<button type="button" class="tag-suggest-item" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
      : '';
  }

  $('#tag-suggest').addEventListener('click', (e) => {
    const cand = e.target.closest('.tag-suggest-item');
    if (!cand) return;
    const t = cand.dataset.tag;
    if (!tags.includes(t)) tags.push(t);
    sync();
  });
  box.addEventListener('click', (e) => {
    const x = e.target.closest('.tag-x');
    if (!x) return;
    tags = tags.filter((t) => t !== x.dataset.tag);
    sync();
  });

  sync();
}

function openForm(bookmark) {
  state.editing = bookmark || null;
  if (bookmark) {
    state.form = {
      title: bookmark.title,
      url: bookmark.url,
      folder: bookmark.folder,
      tags: bookmark.tags.join(', '),
    };
  } else {
    // 新建：预填当前标签页的标题与网址
    const tab = state.currentTab;
    state.form = { title: tab?.title || '', url: tab?.url || '', folder: '', tags: '' };
  }
  state.view = 'form';
  render();
}

async function saveConfig() {
  const server = $('#cfg-server').value.trim();
  const token = $('#cfg-token').value.trim();
  const errEl = $('#cfg-error');
  if (!server || !token) {
    errEl.textContent = '请填写服务端地址和 token';
    return;
  }
  errEl.textContent = '';
  await markmaxApi.saveConfig(server, token);
  await refresh();
}

async function saveForm() {
  const title = $('#form-title').value.trim();
  const url = $('#form-url').value.trim();
  const folder = state.form.folder.trim();
  const tags = [...new Set(state.form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean))];
  const errEl = $('#form-error');
  if (!url) {
    errEl.textContent = '网址不能为空';
    return;
  }
  errEl.textContent = '';
  const isEdit = !!state.editing;
  try {
    if (isEdit) {
      await markmaxApi.update(state.editing.id, { title, url, folder, tags });
    } else {
      await markmaxApi.create({ title, url, folder, tags });
    }
    state.view = 'list';
    await refresh();
    toast(isEdit ? '书签已更新' : '书签已创建');
  } catch (e) {
    errEl.textContent = `保存失败：${e.message || e}`;
  }
}

async function deleteBookmark(id) {
  const b = state.bookmarks.find((x) => x.id === id);
  if (!b) return;
  if (!window.confirm(`将「${b.title || b.url}」移入回收站？`)) return;
  try {
    await markmaxApi.remove(id);
    state.bookmarks = state.bookmarks.filter((x) => x.id !== id);
    renderList();
    toast('已移入回收站');
  } catch (e) {
    toast(`删除失败：${e.message || e}`);
  }
}

/* ---------- 事件委托 ---------- */

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const row = btn.closest('.row');
  const id = row ? row.dataset.id : null;

  switch (act) {
    case 'settings':
      chrome.runtime.openOptionsPage();
      window.close();
      break;
    case 'refresh':
      await refresh();
      break;
    case 'save-config':
      await saveConfig();
      break;
    case 'new':
      openForm(null);
      break;
    case 'edit': {
      const b = state.bookmarks.find((x) => x.id === id);
      if (b) openForm(b);
      break;
    }
    case 'delete':
      await deleteBookmark(id);
      break;
    case 'copy': {
      const b = state.bookmarks.find((x) => x.id === id);
      if (!b) return;
      try {
        await navigator.clipboard.writeText(b.url);
        toast('链接已复制');
      } catch {
        toast('复制失败');
      }
      break;
    }
    case 'cancel':
      state.view = 'list';
      render();
      break;
    case 'save':
      await saveForm();
      break;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  app().addEventListener('click', onClick);
  // 点击任意下拉外部时收起所有浮层
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.fselect-panel').forEach((p) => {
      if (!p.parentElement.contains(e.target)) p.classList.add('hidden');
    });
  });
  void init();
});
