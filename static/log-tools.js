/* log-tools.js — shared toolbar for all log viewers (deploy + container)
 *
 * Usage: include this script before the module script, then call
 *   initLogToolbar('my-log-element-id')
 * for each log element on the page.
 *
 * Features added automatically (zero changes to existing poll functions):
 *   1. "Errors only" checkbox — filters log to show only error/warning lines
 *   2. "Auto-scroll" checkbox — toggles auto-scroll (default: on)
 *   3. "Copy" button — copies visible log text to clipboard
 */
(function () {
  'use strict';

  var _tcDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  var _stDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  var _registry = {};

  /* ── Error detection ─────────────────────────────────────────────── */
  var _errRe = /[\u2717\u2718\u00d7]|FATAL|ERROR|[Ee]rror[:\s]|[Ff]ail(?:ed|ure)?[:\s.\b]|\u26a0|WARN|panic|refused|timed?\s*out|denied|reject|Traceback|Exception/;
  function _isErr(t) { return t ? _errRe.test(t) : false; }

  /* ── Main API ────────────────────────────────────────────────────── */
  window.initLogToolbar = function (id) {
    var el = document.getElementById(id);
    if (!el || _registry[id]) return _registry[id] || null;

    var handle = {
      _as: true,   // auto-scroll
      _eo: false,  // errors-only
      _ft: (_tcDesc ? _tcDesc.get.call(el) : el.textContent) || ''
    };
    _registry[id] = handle;

    var cs = window.getComputedStyle(el);
    var r = parseInt(cs.borderTopLeftRadius) || 8;

    /* ── Build toolbar ─────────────────────────────────────────────── */
    var tb = document.createElement('div');
    tb.className = 'log-toolbar';
    tb.style.cssText =
      'display:flex;align-items:center;gap:12px;padding:5px 12px;' +
      'font-size:12px;color:var(--text-dim,#64748b);flex-wrap:wrap;' +
      'border:1px solid var(--border,#1e293b);' +
      'border-bottom:1px solid rgba(255,255,255,0.06);' +
      'border-radius:' + r + 'px ' + r + 'px 0 0;' +
      'background:' + (cs.backgroundColor || '#0c0f1a');

    function _mkLabel(text, checked) {
      var lbl = document.createElement('label');
      lbl.style.cssText =
        'display:flex;align-items:center;gap:4px;cursor:pointer;' +
        'user-select:none;font-family:DM Sans,sans-serif;font-size:12px';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!checked;
      cb.style.cssText = 'accent-color:var(--cyan,#06b6d4);margin:0';
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + text));
      return { lbl: lbl, cb: cb };
    }

    var errCtl = _mkLabel('Errors only', false);
    tb.appendChild(errCtl.lbl);

    var scrCtl = _mkLabel('Auto-scroll', true);
    tb.appendChild(scrCtl.lbl);

    var sp = document.createElement('div');
    sp.style.flex = '1';
    tb.appendChild(sp);

    var cpBtn = document.createElement('button');
    cpBtn.style.cssText =
      'background:none;border:1px solid var(--border,#1e293b);' +
      'color:var(--text-dim,#64748b);padding:2px 10px;border-radius:4px;' +
      'cursor:pointer;font-size:11px;font-family:DM Sans,sans-serif;transition:all .15s';
    cpBtn.textContent = '\u2398 Copy';
    cpBtn.onmouseenter = function () {
      cpBtn.style.color = 'var(--text-secondary,#94a3b8)';
      cpBtn.style.borderColor = 'var(--text-dim,#64748b)';
    };
    cpBtn.onmouseleave = function () {
      if (!cpBtn._ok) {
        cpBtn.style.color = 'var(--text-dim,#64748b)';
        cpBtn.style.borderColor = 'var(--border,#1e293b)';
      }
    };
    tb.appendChild(cpBtn);

    /* insert toolbar before the log element */
    el.parentNode.insertBefore(tb, el);
    el.style.borderTopLeftRadius = '0';
    el.style.borderTopRightRadius = '0';
    el.style.borderTop = 'none';

    /* sync visibility when log element starts hidden */
    if (cs.display === 'none') {
      tb.style.display = 'none';
      var _vo = new MutationObserver(function () {
        tb.style.display =
          window.getComputedStyle(el).display === 'none' ? 'none' : 'flex';
      });
      _vo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    /* ── scrollTop override ────────────────────────────────────────── */
    if (_stDesc && _stDesc.set && _stDesc.get) {
      Object.defineProperty(el, 'scrollTop', {
        set: function (v) { if (handle._as) _stDesc.set.call(this, v); },
        get: function () { return _stDesc.get.call(this); },
        configurable: true
      });
    }

    scrCtl.cb.onchange = function () {
      handle._as = scrCtl.cb.checked;
      if (handle._as && _stDesc) _stDesc.set.call(el, el.scrollHeight);
    };

    /* ── textContent override (for textContent-based logs) ─────────── */
    if (_tcDesc && _tcDesc.set && _tcDesc.get) {
      Object.defineProperty(el, 'textContent', {
        set: function (v) {
          handle._ft = v;
          if (handle._eo) {
            var f = v.split('\n').filter(_isErr);
            _tcDesc.set.call(this, f.length ? f.join('\n') : '');
          } else {
            _tcDesc.set.call(this, v);
          }
        },
        get: function () {
          return handle._eo ? (handle._ft || '') : _tcDesc.get.call(this);
        },
        configurable: true
      });
    }

    /* ── MutationObserver (for div-based logs) ─────────────────────── */
    var _mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1 || n.hasAttribute('data-log-line')) continue;
          var tag = n.tagName;
          if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
              tag === 'SELECT' || tag === 'FORM') continue;
          if (n.children.length > 0) continue;
          if (!n.textContent || !n.textContent.trim()) continue;
          n.setAttribute('data-log-line', '1');
          if (_isErr(n.textContent)) n.setAttribute('data-log-error', '1');
          if (handle._eo && !n.hasAttribute('data-log-error')) {
            n.style.display = 'none';
          }
        }
      }
    });
    _mo.observe(el, { childList: true });

    /* tag existing child elements */
    for (var i = 0; i < el.children.length; i++) {
      var ch = el.children[i];
      if (ch.children.length === 0 && ch.textContent && ch.textContent.trim() &&
          !ch.hasAttribute('data-log-line')) {
        var ctag = ch.tagName;
        if (ctag === 'BUTTON' || ctag === 'A' || ctag === 'INPUT') continue;
        ch.setAttribute('data-log-line', '1');
        if (_isErr(ch.textContent)) ch.setAttribute('data-log-error', '1');
      }
    }

    /* ── Errors-only toggle ────────────────────────────────────────── */
    errCtl.cb.onchange = function () {
      handle._eo = errCtl.cb.checked;

      var taggedLines = el.querySelectorAll('[data-log-line]');

      if (taggedLines.length > 0) {
        /* div-based log: toggle visibility on tagged divs */
        for (var m = 0; m < taggedLines.length; m++) {
          taggedLines[m].style.display =
            (handle._eo && !taggedLines[m].hasAttribute('data-log-error')) ? 'none' : '';
        }
      } else if (_tcDesc) {
        /* textContent-based log: rewrite from stored full text */
        if (handle._eo) {
          var f = (handle._ft || '').split('\n').filter(_isErr);
          _tcDesc.set.call(el, f.length ? f.join('\n') : '');
        } else {
          _tcDesc.set.call(el, handle._ft || '');
        }
      }
    };

    /* ── Copy button ───────────────────────────────────────────────── */
    function _cpDone() {
      cpBtn.textContent = '\u2713 Copied';
      cpBtn.style.color = 'var(--green,#10b981)';
      cpBtn.style.borderColor = 'var(--green,#10b981)';
      cpBtn._ok = true;
      setTimeout(function () {
        cpBtn.textContent = '\u2398 Copy';
        cpBtn.style.color = 'var(--text-dim,#64748b)';
        cpBtn.style.borderColor = 'var(--border,#1e293b)';
        cpBtn._ok = false;
      }, 2000);
    }

    cpBtn.onclick = function () {
      var text;
      var tagged = el.querySelectorAll('[data-log-line]');
      if (tagged.length > 0) {
        var parts = [];
        for (var p = 0; p < tagged.length; p++) {
          if (tagged[p].style.display !== 'none') parts.push(tagged[p].textContent);
        }
        text = parts.join('\n');
      } else {
        text = (_tcDesc ? _tcDesc.get.call(el) : el.textContent) || '';
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(_cpDone).catch(function () {
          _cpFallback(text);
        });
      } else {
        _cpFallback(text);
      }
    };

    function _cpFallback(t) {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); _cpDone(); } catch (e) { /* silent */ }
      document.body.removeChild(ta);
    }

    return handle;
  };
})();
