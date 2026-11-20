(function () {
  'use strict';
  // Entirely local scratchpad: does not certify an approval or change evidence.
  var container = document.getElementById('r194-source');
  var data;
  try { data = JSON.parse(container.textContent); } catch (_) { return; }
  var ids = data.controls;
  var progress = Object.assign(Object.create(null), data.progress);
  var history = [];
  var search = document.getElementById('r194-search');
  var filter = document.getElementById('r194-filter');
  var result = document.getElementById('r194-results');
  var status = document.getElementById('r194-status');
  var exportField = document.getElementById('r194-export-json');
  var importField = document.getElementById('r194-import-json');
  var cards = Array.prototype.slice.call(document.querySelectorAll('article.control'));
  var stateNames = {
    OPEN:'Не начато',
    IN_PROGRESS:'В работе',
    BLOCKED_LOCAL:'Есть препятствие',
    DONE_LOCAL:'Локальная задача завершена'
  };
  var actions = [
    ['START','В работу'],
    ['BLOCK','Препятствие'],
    ['COMPLETE','Выполнено локально'],
    ['REOPEN','Повторно открыть']
  ];
  var allowed = {
    START:['OPEN','BLOCKED_LOCAL'],
    BLOCK:['OPEN','IN_PROGRESS'],
    COMPLETE:['IN_PROGRESS'],
    REOPEN:['DONE_LOCAL','BLOCKED_LOCAL']
  };
  var outcome = {
    START:'IN_PROGRESS', BLOCK:'BLOCKED_LOCAL',
    COMPLETE:'DONE_LOCAL', REOPEN:'OPEN'
  };
  function message(value) {
    status.textContent = value;
  }
  function renderProgress() {
    cards.forEach(function (card) {
      var id = card.id.substring('control-'.length);
      var local = card.querySelector('.r194-progress');
      if (!local) { return; }
      local.textContent = 'Моя задача: ' + stateNames[progress[id]];
      Array.prototype.slice.call(card.querySelectorAll('button[data-r194-action]')).forEach(function (button) {
        var valid = allowed[button.dataset.r194Action].indexOf(progress[id]) !== -1;
        button.disabled = !valid;
        button.setAttribute('aria-disabled', valid ? 'false' : 'true');
      });
    });
  }
  function applyFilter() {
    var q = search.value.trim().toLocaleLowerCase('ru');
    var code = filter.value;
    var count = 0;
    cards.forEach(function (card) {
      var state = card.querySelector('.pill').classList;
      var id = card.id.substring('control-'.length);
      var matches = !q || card.textContent.toLocaleLowerCase('ru').indexOf(q) !== -1;
      var statusMatch = code === 'ALL' ||
        (code === 'BLOCKED' && state.contains('blocked')) ||
        (code === 'MISSING' && state.contains('missing')) ||
        (code === 'CLAIM_UNVERIFIED' && state.contains('claimed')) ||
        (code === 'OBSERVED_UNATTESTED' && state.contains('observed')) ||
        (code === 'LOCAL_DONE' && progress[id] === 'DONE_LOCAL');
      card.hidden = !(matches && statusMatch);
      if (!card.hidden) { count++; }
    });
    result.textContent = 'Показано направлений: ' + count + ' из ' + ids.length;
  }
  cards.forEach(function (card) {
    var id = card.id.substring('control-'.length);
    if (ids.indexOf(id) === -1) { return; }
    var row = document.createElement('div');
    row.className = 'r194-controls';
    var label = document.createElement('span');
    label.className = 'r194-progress';
    label.setAttribute('aria-live', 'polite');
    row.appendChild(label);
    var buttons = document.createElement('div');
    buttons.className = 'r194-buttons';
    actions.forEach(function (pair) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.r194Action = pair[0];
      button.className = 'r194-smallbtn';
      button.textContent = pair[1];
      button.addEventListener('click', function () {
        if (allowed[pair[0]].indexOf(progress[id]) < 0) { return; }
        var previous = progress[id];
        progress[id] = outcome[pair[0]];
        history.push({control:id,from:previous,to:progress[id],action:pair[0]});
        renderProgress();
        applyFilter();
        message('Сохранено только в памяти вкладки: ' + id + ' / ' + stateNames[progress[id]]);
      });
      buttons.appendChild(button);
    });
    row.appendChild(buttons);
    card.appendChild(row);
  });
  search.addEventListener('input', applyFilter);
  filter.addEventListener('change', applyFilter);
  document.getElementById('r194-export').addEventListener('click', function () {
    var output = {
      schemaVersion:1,kind:'R194_LOCAL_DRAFT',
      sourceCommit:data.commit,assessmentSha256:data.assessmentSha256,
      sourceMode:'LOCAL_UNTRUSTED',decision:'NO_GO',
      productionAuthorized:false,
      progress:progress,history:history
    };
    exportField.value = JSON.stringify(output, null, 2);
    exportField.focus();
    exportField.select();
    message('Черновик подготовлен. Скопируйте JSON вручную. Он не подтверждает согласование.');
  });
  document.getElementById('r194-import').addEventListener('click', function () {
    var x;
    try {
      if (importField.value.length < 2 || importField.value.length > 30000) { throw Error('length'); }
      x = JSON.parse(importField.value);
      if (!x || x.schemaVersion !== 1 || x.kind !== 'R194_LOCAL_DRAFT' ||
        x.sourceCommit !== data.commit || x.assessmentSha256 !== data.assessmentSha256 ||
        x.sourceMode !== 'LOCAL_UNTRUSTED' || x.decision !== 'NO_GO' ||
        x.productionAuthorized !== false ||
        !x.progress || typeof x.progress !== 'object' || Array.isArray(x.progress) ||
        !Array.isArray(x.history) || x.history.length > 200 ||
        Object.keys(x.progress).length !== ids.length ||
        !ids.every(function (id) { return Object.prototype.hasOwnProperty.call(x.progress,id) &&
          Object.prototype.hasOwnProperty.call(stateNames,x.progress[id]); })) {
        throw Error('schema');
      }
      if (!x.history.every(function (event) {
        return event && ids.indexOf(event.control) !== -1 &&
          Object.prototype.hasOwnProperty.call(stateNames,event.from) &&
          Object.prototype.hasOwnProperty.call(stateNames,event.to) &&
          actions.some(function (a) { return a[0] === event.action; });
      })) { throw Error('history'); }
      progress = Object.assign(Object.create(null),x.progress);
      history = x.history.slice();
      renderProgress();
      applyFilter();
      message('Импортирован только локальный черновик. Внешние свидетельства не изменились.');
    } catch (_) {
      message('Файл отклонён: неверная схема, источник или размер.');
    }
  });
  document.getElementById('r194-reset').addEventListener('click', function () {
    progress = Object.assign(Object.create(null),data.progress);
    history = [];
    exportField.value = '';
    importField.value = '';
    renderProgress();
    applyFilter();
    message('Локальный черновик сброшен. Исходные доказательства не изменены.');
  });
  renderProgress();
  applyFilter();
  message('Автономный режим. Никакие сведения не отправляются в сеть.');
})();
