/* ─────────────────────────────────────────────────────────────
   Dashboard Panel Customizer
   Resize columns, drag-reorder trade cards, show/hide panels,
   resize card heights. State persists in localStorage.
   ───────────────────────────────────────────────────────────── */
;(function () {
  'use strict';

  var STORAGE_KEY = 'yamato_dashboard_layout';
  var MIN_COL = 180;
  var MAX_COL = 450;

  /* ── Inject CSS ─────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = [
    /* Edit button in header */
    '.dashboard-edit-btn{',
    '  width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.08);',
    '  background:var(--surface);color:var(--text-secondary);cursor:pointer;',
    '  display:flex;align-items:center;justify-content:center;transition:.2s;',
    '}',
    '.dashboard-edit-btn:hover{background:var(--accent-primary);color:#fff;border-color:var(--accent-primary);}',
    'body.dashboard-edit-mode .dashboard-edit-btn{background:var(--accent-primary);color:#fff;border-color:var(--accent-primary);}',

    /* Edit-mode outlines */
    'body.dashboard-edit-mode .market-panel,',
    'body.dashboard-edit-mode .chart-panel,',
    'body.dashboard-edit-mode .trade-panel>[data-panel-id]{',
    '  outline:2px dashed rgba(16,185,129,.35);outline-offset:-2px;',
    '  transition:outline-color .2s;',
    '}',

    /* Column resize gutters */
    '.dc-gutter{',
    '  position:fixed;top:0;width:12px;height:100vh;cursor:col-resize;z-index:100;',
    '  display:none;',
    '}',
    '.dc-gutter::after{',
    '  content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
    '  width:4px;height:40px;border-radius:2px;background:var(--accent-primary);opacity:.5;transition:opacity .15s;',
    '}',
    '.dc-gutter:hover::after,.dc-gutter.active::after{opacity:1;}',
    'body.dashboard-edit-mode .dc-gutter{display:block;}',

    /* Drag handles */
    '.dc-drag-handle{',
    '  display:none;cursor:grab;padding:4px;color:var(--text-tertiary);flex-shrink:0;',
    '  margin-right:6px;transition:color .15s;',
    '}',
    '.dc-drag-handle:hover{color:var(--text-primary);}',
    'body.dashboard-edit-mode .dc-drag-handle{display:flex;align-items:center;}',

    /* Dragging states */
    '.dc-dragging{opacity:.4;outline:2px dashed var(--accent-primary)!important;}',
    '.dc-drag-over{outline:2px solid var(--accent-primary)!important;outline-offset:-2px;}',

    /* Eye toggle (card visibility) */
    '.dc-eye-btn{',
    '  display:none;cursor:pointer;padding:4px;color:var(--text-tertiary);flex-shrink:0;',
    '  margin-left:auto;background:none;border:none;transition:color .15s;',
    '}',
    '.dc-eye-btn:hover{color:var(--text-primary);}',
    'body.dashboard-edit-mode .dc-eye-btn{display:flex;align-items:center;}',

    /* Hidden card: ghost in edit mode, gone in normal */
    '.dc-card-hidden{display:none!important;}',
    'body.dashboard-edit-mode .dc-card-hidden{',
    '  display:flex!important;height:48px!important;min-height:48px!important;',
    '  max-height:48px!important;flex:0 0 48px!important;overflow:hidden;',
    '  opacity:.35;position:relative;',
    '}',
    'body.dashboard-edit-mode .dc-card-hidden>*:not(.dc-card-header-bar){opacity:.3;}',

    /* Card header bar (holds drag handle + eye) */
    '.dc-card-header-bar{',
    '  display:flex;align-items:center;flex-shrink:0;',
    '}',

    /* Card height resize handle */
    '.dc-height-handle{',
    '  display:none;height:8px;cursor:row-resize;position:relative;flex-shrink:0;',
    '}',
    '.dc-height-handle::after{',
    '  content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
    '  width:32px;height:3px;border-radius:2px;background:var(--accent-primary);opacity:.4;transition:opacity .15s;',
    '}',
    '.dc-height-handle:hover::after,.dc-height-handle.active::after{opacity:1;}',
    'body.dashboard-edit-mode .dc-height-handle{display:block;}',

    /* Settings popover */
    '.dc-popover{',
    '  position:fixed;z-index:1000;background:var(--surface);border:1px solid rgba(255,255,255,.08);',
    '  border-radius:16px;padding:16px;min-width:220px;box-shadow:0 12px 40px rgba(0,0,0,.5);',
    '  display:none;',
    '}',
    '.dc-popover.open{display:block;}',
    '.dc-popover h4{font-size:13px;font-weight:700;margin:0 0 12px;color:var(--text-primary);}',
    '.dc-popover-row{',
    '  display:flex;align-items:center;justify-content:space-between;padding:8px 0;',
    '}',
    '.dc-popover-row span{font-size:12px;color:var(--text-secondary);}',
    '.dc-popover-sep{height:1px;background:rgba(255,255,255,.06);margin:8px 0;}',

    /* Toggle switch */
    '.dc-toggle{',
    '  position:relative;width:36px;height:20px;border-radius:10px;cursor:pointer;',
    '  background:var(--surface-secondary);border:1px solid rgba(255,255,255,.08);transition:.2s;flex-shrink:0;',
    '}',
    '.dc-toggle.on{background:var(--accent-primary);border-color:var(--accent-primary);}',
    '.dc-toggle::after{',
    '  content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;',
    '  background:#fff;transition:.2s;',
    '}',
    '.dc-toggle.on::after{left:18px;}',

    /* Reset button */
    '.dc-reset-btn{',
    '  width:100%;margin-top:12px;padding:8px;border-radius:8px;border:1px solid rgba(239,68,68,.3);',
    '  background:rgba(239,68,68,.08);color:#EF4444;font-size:12px;font-weight:600;',
    '  cursor:pointer;font-family:inherit;transition:.15s;',
    '}',
    '.dc-reset-btn:hover{background:rgba(239,68,68,.15);}',

    /* Disable transitions during resize drag */
    'body.dc-resizing .app-container{transition:none!important;}',
    'body.dc-resizing *{user-select:none!important;}',

    /* Smooth grid transitions when not dragging */
    '.app-container{transition:grid-template-columns .25s ease;}',

    /* Hide customizer on mobile */
    '@media(max-width:768px){',
    '  .dashboard-edit-btn{display:none!important;}',
    '  .dc-gutter,.dc-drag-handle,.dc-eye-btn,.dc-height-handle,.dc-popover{display:none!important;}',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  /* ── Helpers ────────────────────────────────────────────── */
  var appContainer, tradePanel, marketPanel, chartPanel;
  var editMode = false;
  var popoverEl = null;
  var gutterLeft = null;
  var gutterRight = null;

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function fireResize() {
    window.dispatchEvent(new Event('resize'));
  }

  /* ── Storage ────────────────────────────────────────────── */
  function loadLayout() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveLayout() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentLayout));
  }

  var currentLayout = {};

  /* ── SVG icons ──────────────────────────────────────────── */
  var DRAG_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="2" r="1"/><circle cx="8" cy="2" r="1"/><circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/><circle cx="4" cy="10" r="1"/><circle cx="8" cy="10" r="1"/></svg>';
  var EYE_OPEN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_CLOSED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    appContainer = qs('.app-container');
    tradePanel = qs('.trade-panel');
    marketPanel = qs('.market-panel');
    chartPanel = qs('.chart-panel');
    if (!appContainer || !tradePanel) return;

    currentLayout = loadLayout();

    // Create gutters
    createGutters();

    // Inject drag handles + eye buttons into trade cards
    injectCardControls();

    // Create popover
    createPopover();

    // Apply saved layout
    applyLayout();

    // Edit button
    var editBtn = document.getElementById('dashboardEditBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleEditMode();
      });
    }

    // ESC exits edit mode
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && editMode) toggleEditMode(false);
    });

    // Close popover on outside click
    document.addEventListener('click', function (e) {
      if (popoverEl && popoverEl.classList.contains('open')) {
        if (!popoverEl.contains(e.target) && e.target.id !== 'dashboardEditBtn') {
          popoverEl.classList.remove('open');
        }
      }
    });
  }

  /* ── Edit mode ──────────────────────────────────────────── */
  function toggleEditMode(force) {
    editMode = force !== undefined ? force : !editMode;
    document.body.classList.toggle('dashboard-edit-mode', editMode);
    positionGutters();
    if (!editMode && popoverEl) popoverEl.classList.remove('open');
  }

  /* ── Apply saved layout ─────────────────────────────────── */
  function applyLayout() {
    var L = currentLayout;

    // Column widths
    if (L.colMarket) appContainer.style.setProperty('--col-market', L.colMarket + 'px');
    if (L.colTrade) appContainer.style.setProperty('--col-trade', L.colTrade + 'px');

    // Panel visibility
    if (L.hideMarket) appContainer.classList.add('hide-market');
    if (L.hideTrade) appContainer.classList.add('hide-trade');

    // Card order
    if (L.cardOrder && L.cardOrder.length) {
      var cards = qsa('[data-panel-id]', tradePanel);
      var map = {};
      cards.forEach(function (c) { map[c.getAttribute('data-panel-id')] = c; });
      // Also collect height handles between cards
      var handles = qsa('.dc-height-handle', tradePanel);
      // Remove all cards and handles first
      cards.forEach(function (c) { c.remove(); });
      handles.forEach(function (h) { h.remove(); });
      // Re-insert in order
      L.cardOrder.forEach(function (id) {
        if (map[id]) tradePanel.appendChild(map[id]);
      });
      // Re-add any cards not in the saved order
      cards.forEach(function (c) {
        if (!c.parentNode) tradePanel.appendChild(c);
      });
      // Re-inject height handles
      injectHeightHandles();
    }

    // Card visibility
    if (L.hiddenCards) {
      L.hiddenCards.forEach(function (id) {
        var card = qs('[data-panel-id="' + id + '"]', tradePanel);
        if (card) card.classList.add('dc-card-hidden');
      });
      updateEyeButtons();
    }

    // Card heights
    if (L.cardHeights) {
      Object.keys(L.cardHeights).forEach(function (id) {
        var card = qs('[data-panel-id="' + id + '"]', tradePanel);
        if (card) card.style.flex = '0 0 ' + L.cardHeights[id] + 'px';
      });
      // Last visible card gets flex:1
      ensureLastCardFlexible();
    }

    fireResize();
  }

  /* ── Column Resize Gutters ──────────────────────────────── */
  function createGutters() {
    gutterLeft = document.createElement('div');
    gutterLeft.className = 'dc-gutter dc-gutter-left';
    document.body.appendChild(gutterLeft);

    gutterRight = document.createElement('div');
    gutterRight.className = 'dc-gutter dc-gutter-right';
    document.body.appendChild(gutterRight);

    setupGutterDrag(gutterLeft, 'market');
    setupGutterDrag(gutterRight, 'trade');

    // Reposition on window resize
    window.addEventListener('resize', positionGutters);
  }

  function positionGutters() {
    if (!gutterLeft || !gutterRight) return;
    if (!editMode) return;

    if (marketPanel && !appContainer.classList.contains('hide-market')) {
      var mRect = marketPanel.getBoundingClientRect();
      gutterLeft.style.left = (mRect.right - 6) + 'px';
      gutterLeft.style.display = '';
    } else {
      gutterLeft.style.display = 'none';
    }

    if (tradePanel && !appContainer.classList.contains('hide-trade')) {
      var tRect = tradePanel.getBoundingClientRect();
      gutterRight.style.left = (tRect.left - 6) + 'px';
      gutterRight.style.display = '';
    } else {
      gutterRight.style.display = 'none';
    }
  }

  function setupGutterDrag(gutter, side) {
    var startX, startWidth;

    gutter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      document.body.classList.add('dc-resizing');
      gutter.classList.add('active');
      startX = e.clientX;

      if (side === 'market' && marketPanel) {
        startWidth = marketPanel.getBoundingClientRect().width;
      } else if (side === 'trade' && tradePanel) {
        startWidth = tradePanel.getBoundingClientRect().width;
      }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var newW;
        if (side === 'market') {
          newW = clamp(startWidth + dx, MIN_COL, MAX_COL);
          appContainer.style.setProperty('--col-market', newW + 'px');
          currentLayout.colMarket = newW;
        } else {
          newW = clamp(startWidth - dx, MIN_COL, MAX_COL);
          appContainer.style.setProperty('--col-trade', newW + 'px');
          currentLayout.colTrade = newW;
        }
        positionGutters();
        fireResize();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('dc-resizing');
        gutter.classList.remove('active');
        saveLayout();
        fireResize();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ── Card Controls (drag handle + eye) ──────────────────── */
  function injectCardControls() {
    var cards = qsa('[data-panel-id]', tradePanel);
    cards.forEach(function (card) {
      // Find or create header bar
      var headerBar = qs('.dc-card-header-bar', card);
      if (headerBar) return; // already injected

      headerBar = document.createElement('div');
      headerBar.className = 'dc-card-header-bar';

      // Drag handle
      var drag = document.createElement('span');
      drag.className = 'dc-drag-handle';
      drag.innerHTML = DRAG_SVG;
      headerBar.appendChild(drag);

      // Eye toggle
      var eye = document.createElement('button');
      eye.className = 'dc-eye-btn';
      eye.innerHTML = EYE_OPEN_SVG;
      eye.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = card.getAttribute('data-panel-id');
        card.classList.toggle('dc-card-hidden');
        updateHiddenCards();
        updateEyeButtons();
        ensureLastCardFlexible();
        saveLayout();
      });
      headerBar.appendChild(eye);

      card.insertBefore(headerBar, card.firstChild);

      // Make card draggable
      card.setAttribute('draggable', 'false'); // only from handle
      setupCardDrag(card, drag);
    });

    // Inject height handles
    injectHeightHandles();
  }

  function updateEyeButtons() {
    qsa('[data-panel-id]', tradePanel).forEach(function (card) {
      var eye = qs('.dc-eye-btn', card);
      if (eye) {
        eye.innerHTML = card.classList.contains('dc-card-hidden') ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
      }
    });
  }

  function updateHiddenCards() {
    var hidden = [];
    qsa('[data-panel-id]', tradePanel).forEach(function (card) {
      if (card.classList.contains('dc-card-hidden')) {
        hidden.push(card.getAttribute('data-panel-id'));
      }
    });
    currentLayout.hiddenCards = hidden;
  }

  /* ── Card Drag & Drop ───────────────────────────────────── */
  function setupCardDrag(card, handle) {
    handle.addEventListener('mousedown', function () {
      if (!editMode) return;
      card.setAttribute('draggable', 'true');
    });

    card.addEventListener('dragstart', function (e) {
      if (!editMode) { e.preventDefault(); return; }
      card.classList.add('dc-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.getAttribute('data-panel-id'));
    });

    card.addEventListener('dragend', function () {
      card.classList.remove('dc-dragging');
      card.setAttribute('draggable', 'false');
      qsa('[data-panel-id]', tradePanel).forEach(function (c) {
        c.classList.remove('dc-drag-over');
      });
    });

    card.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!card.classList.contains('dc-dragging')) {
        card.classList.add('dc-drag-over');
      }
    });

    card.addEventListener('dragleave', function () {
      card.classList.remove('dc-drag-over');
    });

    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('dc-drag-over');
      var draggedId = e.dataTransfer.getData('text/plain');
      var dragged = qs('[data-panel-id="' + draggedId + '"]', tradePanel);
      if (!dragged || dragged === card) return;

      // Determine position: insert before or after
      var cardRect = card.getBoundingClientRect();
      var midY = cardRect.top + cardRect.height / 2;
      if (e.clientY < midY) {
        tradePanel.insertBefore(dragged, card);
      } else {
        tradePanel.insertBefore(dragged, card.nextSibling);
      }

      // Re-inject height handles
      injectHeightHandles();

      // Save new order
      currentLayout.cardOrder = qsa('[data-panel-id]', tradePanel).map(function (c) {
        return c.getAttribute('data-panel-id');
      });
      saveLayout();
    });
  }

  /* ── Card Height Resize Handles ─────────────────────────── */
  function injectHeightHandles() {
    // Remove existing handles
    qsa('.dc-height-handle', tradePanel).forEach(function (h) { h.remove(); });

    var cards = qsa('[data-panel-id]', tradePanel);
    // Insert handle between each pair of cards (not after last)
    for (var i = 0; i < cards.length - 1; i++) {
      var handle = document.createElement('div');
      handle.className = 'dc-height-handle';
      cards[i].after(handle);
      setupHeightDrag(handle, cards[i]);
    }
  }

  function setupHeightDrag(handle, cardAbove) {
    handle.addEventListener('mousedown', function (e) {
      if (!editMode) return;
      e.preventDefault();
      document.body.classList.add('dc-resizing');
      handle.classList.add('active');
      var startY = e.clientY;
      var startH = cardAbove.getBoundingClientRect().height;

      function onMove(ev) {
        var dy = ev.clientY - startY;
        var newH = Math.max(60, startH + dy);
        cardAbove.style.flex = '0 0 ' + newH + 'px';

        if (!currentLayout.cardHeights) currentLayout.cardHeights = {};
        currentLayout.cardHeights[cardAbove.getAttribute('data-panel-id')] = newH;
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('dc-resizing');
        handle.classList.remove('active');
        ensureLastCardFlexible();
        saveLayout();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function ensureLastCardFlexible() {
    var cards = qsa('[data-panel-id]', tradePanel);
    var visible = cards.filter(function (c) { return !c.classList.contains('dc-card-hidden'); });
    if (!visible.length) return;
    var last = visible[visible.length - 1];
    // Only force flex:1 on the last visible card if it doesn't have a saved height
    // or if it IS the last one
    last.style.flex = '1';
    // Remove its saved height so it fills remaining space
    if (currentLayout.cardHeights) {
      delete currentLayout.cardHeights[last.getAttribute('data-panel-id')];
    }
  }

  /* ── Settings Popover ───────────────────────────────────── */
  function createPopover() {
    popoverEl = document.createElement('div');
    popoverEl.className = 'dc-popover';
    popoverEl.innerHTML = [
      '<h4>Панелі</h4>',
      '<div class="dc-popover-row">',
      '  <span>Ринки (зліва)</span>',
      '  <div class="dc-toggle' + (currentLayout.hideMarket ? '' : ' on') + '" data-col="market"></div>',
      '</div>',
      '<div class="dc-popover-row">',
      '  <span>Торгівля (справа)</span>',
      '  <div class="dc-toggle' + (currentLayout.hideTrade ? '' : ' on') + '" data-col="trade"></div>',
      '</div>',
      '<div class="dc-popover-sep"></div>',
      '<h4>Картки торгівлі</h4>',
      buildCardToggleRows(),
      '<div class="dc-popover-sep"></div>',
      '<button class="dc-reset-btn">Скинути макет</button>',
    ].join('');
    document.body.appendChild(popoverEl);

    // Toggle handlers for columns
    qsa('.dc-toggle[data-col]', popoverEl).forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        toggle.classList.toggle('on');
        var col = toggle.getAttribute('data-col');
        if (col === 'market') {
          var hide = !toggle.classList.contains('on');
          appContainer.classList.toggle('hide-market', hide);
          currentLayout.hideMarket = hide;
        } else if (col === 'trade') {
          var hide2 = !toggle.classList.contains('on');
          appContainer.classList.toggle('hide-trade', hide2);
          currentLayout.hideTrade = hide2;
        }
        positionGutters();
        saveLayout();
        fireResize();
      });
    });

    // Toggle handlers for cards
    qsa('.dc-toggle[data-card]', popoverEl).forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        toggle.classList.toggle('on');
        var cardId = toggle.getAttribute('data-card');
        var card = qs('[data-panel-id="' + cardId + '"]', tradePanel);
        if (card) {
          card.classList.toggle('dc-card-hidden', !toggle.classList.contains('on'));
          updateHiddenCards();
          updateEyeButtons();
          ensureLastCardFlexible();
          saveLayout();
        }
      });
    });

    // Reset button
    qs('.dc-reset-btn', popoverEl).addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    // Open popover from edit button (right-click or long press = popover, click = toggle edit mode)
    var editBtn = document.getElementById('dashboardEditBtn');
    if (editBtn) {
      editBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        openPopover(editBtn);
      });
      // Also show popover when in edit mode and clicking the button
      var origClick = editBtn.onclick;
      editBtn.addEventListener('click', function (e) {
        if (editMode) {
          // If already in edit mode, toggle popover
          if (popoverEl.classList.contains('open')) {
            popoverEl.classList.remove('open');
          } else {
            openPopover(editBtn);
          }
          e.stopPropagation();
        }
      });
    }
  }

  function buildCardToggleRows() {
    var labels = {
      wallet: 'Баланс',
      orderForm: 'Ордер',
      orderBook: 'Книга ордерів',
      infoPanel: 'Інфо'
    };
    var hidden = currentLayout.hiddenCards || [];
    var html = '';
    qsa('[data-panel-id]', tradePanel).forEach(function (card) {
      var id = card.getAttribute('data-panel-id');
      var isOn = hidden.indexOf(id) === -1;
      html += '<div class="dc-popover-row">';
      html += '  <span>' + (labels[id] || id) + '</span>';
      html += '  <div class="dc-toggle' + (isOn ? ' on' : '') + '" data-card="' + id + '"></div>';
      html += '</div>';
    });
    return html;
  }

  function openPopover(anchor) {
    // Refresh card toggle states
    var hidden = currentLayout.hiddenCards || [];
    qsa('.dc-toggle[data-card]', popoverEl).forEach(function (t) {
      var id = t.getAttribute('data-card');
      t.classList.toggle('on', hidden.indexOf(id) === -1);
    });
    // Refresh column toggle states
    qs('.dc-toggle[data-col="market"]', popoverEl).classList.toggle('on', !currentLayout.hideMarket);
    qs('.dc-toggle[data-col="trade"]', popoverEl).classList.toggle('on', !currentLayout.hideTrade);

    // Position popover
    var rect = anchor.getBoundingClientRect();
    popoverEl.style.top = (rect.bottom + 8) + 'px';
    popoverEl.style.right = (window.innerWidth - rect.right) + 'px';
    popoverEl.style.left = 'auto';
    popoverEl.classList.add('open');
  }

  /* ── Boot ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
