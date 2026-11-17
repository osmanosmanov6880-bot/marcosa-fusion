/* MARCOSA R141: public-source directory, not a live deployment registry.
 * Fetches only the same-origin, reviewed static JSON. No cookies, auth or tracking.
 */
(function () {
  'use strict';
  const SCHEMA = 'marcosa-ecosystem-public-sources/v1';
  const LABELS = Object.freeze({
    platform: 'ПЛАТФОРМА', business: 'БИЗНЕС', worlds: 'МИРЫ',
    cinema: 'КИНО', research: 'ИССЛЕДОВАНИЯ'
  });
  const STATUS = Object.freeze({
    source: 'ИСТОЧНИК', docs: 'ДОКУМЕНТАЦИЯ', stub: 'БЕЗ ПРИЛОЖЕНИЯ'
  });
  const doc = document;
  const grid = doc.getElementById('ec-grid');
  const result = doc.getElementById('ec-result');
  const search = doc.getElementById('ec-search');
  const filters = Array.from(doc.querySelectorAll('[data-ec-filter]'));
  const total = doc.getElementById('ec-count');
  const code = doc.getElementById('ec-code');
  const live = doc.getElementById('ec-live-count');
  if (!grid || !result || !search || !total || !code || !live) return;
  let entries = [];
  let selected = 'all';

  function verifiedSourceLink(entry) {
    if (typeof entry.repository !== 'string' || !/^[A-Za-z0-9._-]{1,90}$/.test(entry.repository)) return null;
    if (entry.sourceUrl !== 'https://github.com/osmanosmanov6880-bot/' + entry.repository) return null;
    return entry.sourceUrl;
  }

  function validate(manifest) {
    if (!manifest || manifest.schema !== SCHEMA ||
        manifest.productionAuthorized !== false ||
        manifest.legacyReplacementAuthorized !== false ||
        manifest.integratedProductionAppsVerified !== 0 ||
        !Array.isArray(manifest.entries) ||
        manifest.repositoryCount !== manifest.entries.length ||
        manifest.entries.length < 1 || manifest.entries.length > 100) {
      throw new Error('Недоверенный каталог источников');
    }
    const names = new Set();
    for (const item of manifest.entries) {
      if (!item || names.has(item.repository) || !verifiedSourceLink(item) ||
          !Object.hasOwn(LABELS, item.category) ||
          !Object.hasOwn(STATUS, item.sourceStatus) ||
          typeof item.title !== 'string' || item.title.length > 100 ||
          item.productionVerified !== false ||
          item.marcosaRuntimeIntegrated !== false) {
        throw new Error('Запись проекта не прошла проверку');
      }
      names.add(item.repository);
    }
    return manifest.entries;
  }

  function card(item) {
    const article = doc.createElement('article');
    article.className = 'ec-card';
    const head = doc.createElement('div');
    head.className = 'ec-card-head';
    const kind = doc.createElement('span');
    kind.className = 'ec-card-kind';
    kind.textContent = LABELS[item.category];
    const state = doc.createElement('span');
    state.className = 'ec-card-state';
    state.textContent = STATUS[item.sourceStatus];
    head.append(kind, state);

    const h = doc.createElement('h3');
    h.textContent = item.title;
    const note = doc.createElement('p');
    note.textContent = 'Исходный репозиторий · публикация в MARCOSA не подтверждена.';
    const a = doc.createElement('a');
    a.href = verifiedSourceLink(item);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Открыть исходники ↗';
    article.append(head, h, note, a);
    return article;
  }

  function render() {
    const phrase = search.value.trim().toLocaleLowerCase('ru').slice(0, 100);
    const list = entries.filter(item =>
      (selected === 'all' || item.category === selected) &&
      (!phrase || (item.title + ' ' + item.repository + ' ' + LABELS[item.category])
        .toLocaleLowerCase('ru').includes(phrase))
    );
    const fragment = doc.createDocumentFragment();
    for (const item of list) fragment.append(card(item));
    grid.replaceChildren(fragment);
    result.textContent = list.length
      ? 'Найдено: ' + list.length + ' из ' + entries.length + ' публичных исходников'
      : 'Совпадений нет. Измените поиск или категорию.';
  }

  for (const button of filters) {
    button.addEventListener('click', () => {
      selected = button.getAttribute('data-ec-filter') || 'all';
      for (const b of filters) b.setAttribute('aria-pressed', String(b === button));
      render();
    });
  }
  search.addEventListener('input', render);

  fetch('./ecosystem-manifest.json', {cache: 'no-store', credentials: 'omit'})
    .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(manifest => {
      entries = validate(manifest);
      total.textContent = String(entries.length);
      code.textContent = String(entries.filter(item => item.sourceStatus === 'source').length);
      live.textContent = '0';
      render();
    })
    .catch(() => {
      grid.replaceChildren();
      result.textContent = 'Реестр не загружен или не прошёл проверку. Публикация проектов не подтверждена.';
      total.textContent = '—';
      code.textContent = '—';
      live.textContent = '0';
    });
})();
