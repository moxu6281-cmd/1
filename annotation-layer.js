/* 页面批注层（开发用）
 *
 * 用途：在预览里直接点选页面元素，写下"这里要怎么改"，批注会存到服务端
 * data/dev-annotations.json，AI 读这个文件就能定位到代码并修改。
 *
 * 发送：抽屉里点「发送给 AI」，当前页批注会打包成一条投递记录写进
 * data/dev-annotations.inbox.json（带批次编号 b-xxxx）。AI 读这个收件箱拿到
 * 整批批注，改完把批次标记为已处理，页面上的角标会变成「已处理」。
 *
 * 安全：生产环境服务端返回 enabled=false，本脚本不会构建任何 UI。
 */
(function () {
  "use strict";
  if (window.__esbAnnotateLayerReady) return;
  window.__esbAnnotateLayerReady = true;

  var ENDPOINT = "/api/dev-annotations";
  var STORE_KEY = "esb:annotations:v1";
  var PAGE = location.pathname.replace(/^\//, "") || "admin.html";
  var MAX_TEXT = 90;
  var MAX_HTML = 340;

  var state = { notes: [], mode: false, enabled: null, pending: null, listOpen: false, batches: [], sending: false };
  var ui = {};

  /* ---------------------------------------------------------------- 存储 */

  function saveLocal() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state.notes));
    } catch (error) { /* 隐私模式等场景忽略 */ }
  }

  function newId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function upsert(note) {
    for (var i = 0; i < state.notes.length; i += 1) {
      if (state.notes[i].id === note.id) { state.notes[i] = note; return; }
    }
    state.notes.push(note);
  }

  function pushRemote(notes) {
    if (state.enabled !== true) return;
    if (typeof window.fetch !== "function") return;
    try {
      window.fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes })
      })["catch"](function () { /* 离线时本地仍然保留 */ });
    } catch (error) { /* 忽略 */ }
  }

  function deleteRemote(id) {
    if (state.enabled !== true || typeof window.fetch !== "function") return;
    try {
      window.fetch(ENDPOINT + "?id=" + encodeURIComponent(id), { method: "DELETE" })["catch"](function () {});
    } catch (error) { /* 忽略 */ }
  }

  function clearRemote(page) {
    if (state.enabled !== true || typeof window.fetch !== "function") return;
    try {
      window.fetch(ENDPOINT + "?page=" + encodeURIComponent(page), { method: "DELETE" })["catch"](function () {});
    } catch (error) { /* 忽略 */ }
  }

  // 把这一页的批注打包投递给 AI：服务端写入 data/dev-annotations.inbox.json
  // 请求里同时带上批注内容，避免"上传还没到、发送先到"的空发竞态
  function sendRemote(page, ids, notes) {
    if (state.enabled !== true || typeof window.fetch !== "function") return null;
    var payload = { page: page };
    if (ids && ids.length) payload.ids = ids.slice();
    if (notes && notes.length) payload.notes = notes;
    try {
      return window.fetch(ENDPOINT + "/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      return null;
    }
  }

  function statusRemote(id, status) {
    if (state.enabled !== true || typeof window.fetch !== "function") return;
    try {
      window.fetch(ENDPOINT + "/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, status: status })
      })["catch"](function () {});
    } catch (error) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 定位信息 */

  function isUi(node) {
    var el = node;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute("data-esb-ui") === "1") return true;
      el = el.parentElement;
    }
    return false;
  }

  function cssPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift("#" + node.id);
        break;
      }
      var sel = String(node.nodeName || "").toLowerCase();
      var classes = [];
      if (node.classList) {
        for (var i = 0; i < node.classList.length; i += 1) {
          var cls = node.classList[i];
          if (/^[A-Za-z][\w-]*$/.test(cls) && classes.length < 2) classes.push(cls);
        }
      }
      if (classes.length) sel += "." + classes.join(".");
      var parent = node.parentElement;
      if (parent) {
        var sameTag = [];
        for (var j = 0; j < parent.children.length; j += 1) {
          if (parent.children[j].nodeName === node.nodeName) sameTag.push(parent.children[j]);
        }
        if (sameTag.length > 1) sel += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function snippet(text, limit) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > limit ? value.slice(0, limit) + "…" : value;
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var attrs = {};
    var kept = 0;
    if (el.attributes) {
      for (var i = 0; i < el.attributes.length && kept < 6; i += 1) {
        var name = el.attributes[i].name;
        if (name === "class" || name === "style") continue;
        attrs[name] = snippet(el.attributes[i].value, 60);
        kept += 1;
      }
    }
    var rect = { x: 0, y: 0, w: 0, h: 0 };
    try {
      var box = el.getBoundingClientRect();
      rect = { x: Math.round(box.left), y: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) };
    } catch (error) { /* 忽略 */ }
    var root = document.documentElement;
    return {
      page: PAGE,
      url: location.pathname + location.search,
      selector: cssPath(el),
      tag: String(el.nodeName || "").toLowerCase(),
      classes: el.className && typeof el.className === "string" ? snippet(el.className, 120) : "",
      text: snippet(el.textContent, MAX_TEXT),
      html: snippet(el.outerHTML, MAX_HTML),
      attrs: attrs,
      rect: rect,
      viewport: { w: window.innerWidth || (root ? root.clientWidth : 0), h: window.innerHeight || (root ? root.clientHeight : 0) }
    };
  }

  /* ---------------------------------------------------------------- 样式 */

  var CSS = [
    ".esb-annotate-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:6px;",
    "padding:9px 14px;border:0;border-radius:999px;background:#4f46e5;color:#fff;cursor:pointer;",
    "font:600 13px/1.2 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;",
    "box-shadow:0 8px 24px rgba(79,70,229,.35)}",
    ".esb-annotate-btn.is-on{background:#0f172a;box-shadow:0 8px 24px rgba(15,23,42,.4)}",
    ".esb-annotate-btn b{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#fff;color:#4f46e5;",
    "font:700 11px/18px sans-serif;text-align:center}",
    ".esb-annotate-btn.is-on b{color:#0f172a}",
    ".esb-annotate-hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483000;",
    "padding:8px 16px;border-radius:999px;background:rgba(15,23,42,.92);color:#fff;pointer-events:none;",
    "font:500 12px/1.4 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
    ".esb-annotate-box{position:fixed;z-index:2147482998;border:2px solid #4f46e5;border-radius:4px;",
    "background:rgba(79,70,229,.08);pointer-events:none;transition:all .05s linear}",
    ".esb-annotate-box-label{position:absolute;left:-2px;top:-24px;max-width:60vw;overflow:hidden;white-space:nowrap;",
    "padding:3px 8px;border-radius:4px 4px 0 0;background:#4f46e5;color:#fff;",
    "font:600 11px/1.3 ui-monospace,Menlo,Consolas,monospace}",
    ".esb-annotate-pop{position:fixed;z-index:2147483001;width:330px;padding:14px;border-radius:12px;",
    "background:#fff;border:1px solid #e2e8f0;box-shadow:0 18px 48px rgba(15,23,42,.22);",
    "font:400 13px/1.5 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a}",
    ".esb-annotate-pop h4{margin:0 0 8px;font-size:13px;font-weight:700}",
    ".esb-annotate-pop .esb-target{margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#f8fafc;",
    "font:400 11px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#475569;word-break:break-all}",
    ".esb-annotate-pop textarea{width:100%;box-sizing:border-box;height:88px;padding:9px 10px;resize:vertical;",
    "border:1px solid #cbd5e1;border-radius:8px;font:400 13px/1.5 inherit;color:#0f172a;background:#fff}",
    ".esb-annotate-pop textarea:focus{outline:2px solid rgba(79,70,229,.35);border-color:#4f46e5}",
    ".esb-annotate-pop-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}",
    ".esb-annotate-pop-foot button{padding:7px 14px;border:0;border-radius:8px;cursor:pointer;",
    "font:600 12px/1 inherit}",
    ".esb-annotate-save{background:#4f46e5;color:#fff}",
    ".esb-annotate-cancel{background:#f1f5f9;color:#475569}",
    ".esb-annotate-drawer{position:fixed;right:0;top:0;bottom:0;width:340px;max-width:92vw;z-index:2147483001;",
    "display:flex;flex-direction:column;background:#fff;border-left:1px solid #e2e8f0;",
    "box-shadow:-16px 0 40px rgba(15,23,42,.16);",
    "font:400 13px/1.5 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a}",
    ".esb-annotate-drawer header{display:flex;align-items:center;justify-content:space-between;gap:8px;",
    "padding:14px 16px;border-bottom:1px solid #e2e8f0;font-weight:700}",
    ".esb-annotate-drawer header button{border:0;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:#64748b}",
    ".esb-annotate-list{flex:1;overflow:auto;padding:12px 16px}",
    ".esb-annotate-item{padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;background:#fff}",
    ".esb-annotate-item .esb-idx{display:inline-block;min-width:18px;height:18px;margin-right:6px;border-radius:9px;",
    "background:#eef2ff;color:#4f46e5;font:700 11px/18px sans-serif;text-align:center}",
    ".esb-annotate-item .esb-what{font-weight:600}",
    ".esb-annotate-item .esb-where{margin-top:6px;color:#64748b;word-break:break-all;",
    "font:400 11px/1.5 ui-monospace,Menlo,Consolas,monospace}",
    ".esb-annotate-item .esb-actions{margin-top:8px;display:flex;gap:10px}",
    ".esb-annotate-item .esb-actions button{border:0;background:transparent;padding:0;cursor:pointer;",
    "color:#4f46e5;font:600 11px/1 inherit}",
    ".esb-annotate-item .esb-actions .esb-del{color:#e11d48}",
    ".esb-annotate-empty{color:#94a3b8;text-align:center;padding:24px 8px}",
    ".esb-annotate-drawer footer{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0}",
    ".esb-annotate-drawer footer button{flex:1;padding:9px 12px;border:0;border-radius:8px;cursor:pointer;",
    "font:600 12px/1 inherit}",
    ".esb-annotate-copy{background:#f1f5f9;color:#475569}",
    ".esb-annotate-clear{background:#f1f5f9;color:#94a3b8}",
    ".esb-annotate-drawer footer{flex-wrap:wrap}",
    ".esb-annotate-send{background:#4f46e5;color:#fff;flex:1 0 100%}",
    ".esb-annotate-send[disabled]{opacity:.6;cursor:default}",
    ".esb-annotate-banner{margin-bottom:12px;padding:10px 12px;border-radius:10px;background:#eef2ff;",
    "border:1px solid #c7d2fe;color:#3730a3;font:500 12px/1.6 inherit}",
    ".esb-annotate-banner b{font-weight:700}",
    ".esb-annotate-banner.is-done{background:#ecfdf5;border-color:#a7f3d0;color:#047857}",
    ".esb-annotate-banner code{display:block;margin-top:4px;color:#4338ca;",
    "font:600 11px/1.5 ui-monospace,Menlo,Consolas,monospace}",
    ".esb-annotate-banner .esb-banner-actions{display:flex;gap:10px;margin-top:6px}",
    ".esb-annotate-banner .esb-banner-actions button{border:0;background:transparent;padding:0;cursor:pointer;",
    "color:#4f46e5;font:600 11px/1 inherit}",
    ".esb-annotate-tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;",
    "background:#fef3c7;color:#92400e;font:600 10px/16px sans-serif;vertical-align:middle}",
    ".esb-annotate-tag.is-done{background:#d1fae5;color:#047857}",
    ".esb-annotate-toast{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:2147483002;",
    "max-width:86vw;padding:10px 18px;border-radius:999px;background:rgba(15,23,42,.94);color:#fff;",
    "text-align:center;box-shadow:0 12px 32px rgba(15,23,42,.3);",
    "font:500 13px/1.5 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
    ".esb-annotate-btn.is-pending::after{content:'';position:absolute;top:-3px;right:-3px;width:10px;height:10px;",
    "border-radius:50%;background:#f59e0b;border:2px solid #fff}"
  ].join("");

  function injectCss() {
    var style = document.createElement("style");
    style.setAttribute("data-esb-ui", "1");
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ UI */

  function build(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    el.setAttribute("data-esb-ui", "1");
    return el;
  }

  function mount() {
    injectCss();

    ui.button = build("button", "esb-annotate-btn");
    ui.button.type = "button";
    ui.button.setAttribute("title", "批注模式：点选页面元素写下修改意见（Alt+A）");
    refreshButton();
    ui.button.addEventListener("click", function () {
      if (state.mode) { stopMode(); openDrawer(); } else { stopDrawer(); startMode(); }
    });

    ui.hint = build("div", "esb-annotate-hint", "批注模式：点击要修改的元素 · Esc 退出");
    ui.hint.style.display = "none";

    ui.box = build("div", "esb-annotate-box");
    ui.boxLabel = build("span", "esb-annotate-box-label", "");
    ui.box.appendChild(ui.boxLabel);
    ui.box.style.display = "none";

    ui.pop = build("div", "esb-annotate-pop");
    ui.pop.style.display = "none";
    ui.pop.innerHTML = "";
    var popHead = build("h4", null, "写下要怎么改");
    ui.popTarget = build("div", "esb-target");
    ui.popInput = document.createElement("textarea");
    ui.popInput.setAttribute("data-esb-ui", "1");
    ui.popInput.placeholder = "例如：标题字号太小，放大到 20px；或者：这个按钮改成红色";
    var popFoot = build("div", "esb-annotate-pop-foot");
    var cancel = build("button", "esb-annotate-cancel", "取消");
    var save = build("button", "esb-annotate-cancel", "保存批注");
    var saveSend = build("button", "esb-annotate-save", "保存并发送");
    cancel.type = "button";
    save.type = "button";
    saveSend.type = "button";
    cancel.addEventListener("click", closePopover);
    save.addEventListener("click", function () { commitPopover(false); });
    saveSend.addEventListener("click", function () { commitPopover(true); });
    popFoot.appendChild(cancel);
    popFoot.appendChild(save);
    popFoot.appendChild(saveSend);
    ui.pop.appendChild(popHead);
    ui.pop.appendChild(ui.popTarget);
    ui.pop.appendChild(ui.popInput);
    ui.pop.appendChild(popFoot);

    ui.drawer = build("aside", "esb-annotate-drawer");
    ui.drawer.style.display = "none";
    var head = build("header");
    var title = build("span", null, "批注");
    ui.count = build("b", null, "0");
    title.appendChild(document.createTextNode(" "));
    title.appendChild(ui.count);
    var close = build("button", null, "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭批注列表");
    close.addEventListener("click", stopDrawer);
    head.appendChild(title);
    head.appendChild(close);
    ui.list = build("div", "esb-annotate-list");
    var foot = build("footer");
    ui.send = build("button", "esb-annotate-send", "发送给 AI");
    var copy = build("button", "esb-annotate-copy", "复制全部批注");
    var clear = build("button", "esb-annotate-clear", "清空本页批注");
    ui.send.type = "button";
    copy.type = "button";
    clear.type = "button";
    ui.send.addEventListener("click", sendAll);
    copy.addEventListener("click", copyAll);
    clear.addEventListener("click", clearAll);
    foot.appendChild(ui.send);
    foot.appendChild(copy);
    foot.appendChild(clear);
    ui.drawer.appendChild(head);
    ui.drawer.appendChild(ui.list);
    ui.drawer.appendChild(foot);

    document.body.appendChild(ui.button);
    document.body.appendChild(ui.hint);
    document.body.appendChild(ui.box);
    document.body.appendChild(ui.pop);
    document.body.appendChild(ui.drawer);
    renderList();

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (ui.pop.style.display !== "none") return closePopover();
        if (state.mode) return stopMode();
        if (state.listOpen) return stopDrawer();
      }
      if (event.altKey && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        if (state.mode) stopMode(); else startMode();
      }
    }, true);
  }

  function refreshButton() {
    if (!ui.button) return;
    ui.button.textContent = state.mode ? "✕ 退出批注" : "✎ 批注";
    var badge = document.createElement("b");
    badge.textContent = String(countForPage());
    ui.button.appendChild(badge);
    var waiting = pendingBatchForPage();
    ui.button.className = "esb-annotate-btn" + (state.mode ? " is-on" : "") + (waiting ? " is-pending" : "");
    ui.button.setAttribute("title", waiting
      ? "已发送 " + waiting.count + " 条批注（" + waiting.id + "），等待 AI 处理 · Alt+A"
      : "批注模式：点选页面元素写下修改意见（Alt+A）");
    if (ui.send) {
      var total = countForPage();
      ui.send.textContent = state.sending ? "发送中…" : "发送给 AI" + (total ? "（" + total + " 条）" : "");
      ui.send.disabled = state.sending === true;
    }
  }

  /* --------------------------------------------------------- 批注模式交互 */

  function drawBox(el) {
    if (!ui.box || !el) return;
    var box;
    try { box = el.getBoundingClientRect(); } catch (error) { return; }
    ui.box.style.display = "block";
    ui.box.style.left = box.left + "px";
    ui.box.style.top = box.top + "px";
    ui.box.style.width = box.width + "px";
    ui.box.style.height = box.height + "px";
    ui.boxLabel.textContent = cssPath(el);
  }

  function startMode() {
    if (state.mode) return;
    state.mode = true;
    document.documentElement.style.cursor = "crosshair";
    if (ui.hint) ui.hint.style.display = "block";
    refreshButton();
  }

  function stopMode() {
    state.mode = false;
    state.pending = null;
    document.documentElement.style.cursor = "";
    if (ui.hint) ui.hint.style.display = "none";
    if (ui.box) ui.box.style.display = "none";
    closePopover();
    refreshButton();
  }

  function onMouseOver(event) {
    if (!state.mode || !event.target || isUi(event.target)) return;
    drawBox(event.target);
  }

  function onClick(event) {
    if (!state.mode) return;
    if (ui.pop && ui.pop.contains(event.target)) return;
    if (isUi(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    openPopover(event.target);
  }

  function onBlocked(event) {
    if (!state.mode) return;
    if (ui.pop && ui.pop.contains(event.target)) return;
    if (isUi(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function bindPageGuards() {
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mousedown", onBlocked, true);
    document.addEventListener("submit", onBlocked, true);
  }

  function openPopover(el) {
    var target = describe(el);
    if (!target) return;
    state.pending = { target: target, element: el };
    ui.popTarget.textContent = target.selector + "\n" + (target.text || "");
    ui.popInput.value = "";
    ui.pop.style.display = "block";
    var left = target.rect.x;
    var top = target.rect.y + target.rect.h + 8;
    var width = 330;
    var height = 240;
    var maxLeft = (window.innerWidth || 1024) - width - 12;
    var maxTop = (window.innerHeight || 768) - height - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < 12) left = 12;
    if (top > maxTop) top = target.rect.y - height - 8;
    if (top < 12) top = 12;
    ui.pop.style.left = left + "px";
    ui.pop.style.top = top + "px";
    try { ui.popInput.focus(); } catch (error) { /* 忽略 */ }
  }

  function closePopover() {
    if (!ui.pop || ui.pop.style.display === "none") return;
    ui.pop.style.display = "none";
    ui.popInput.value = "";
    state.pending = null;
  }

  function commitPopover(alsoSend) {
    if (!state.pending) return closePopover();
    var comment = String(ui.popInput.value || "").trim();
    if (!comment) {
      try { ui.popInput.focus(); } catch (error) { /* 忽略 */ }
      return;
    }
    var note = Object.assign({}, state.pending.target, {
      id: newId(),
      comment: comment,
      createdAt: new Date().toISOString()
    });
    upsert(note);
    saveLocal();
    pushRemote([note]);
    closePopover();
    renderList();
    refreshButton();
    if (alsoSend) {
      openDrawer();
      sendAll([note.id]);
      return;
    }
    openDrawer();
  }

  /* ------------------------------------------------------------- 列表 UI */

  function notesForPage() {
    return state.notes.filter(function (note) { return note.page === PAGE; });
  }

  function countForPage() {
    return notesForPage().length;
  }

  function findBatch(id) {
    for (var i = 0; i < state.batches.length; i += 1) {
      if (state.batches[i].id === id) return state.batches[i];
    }
    return null;
  }

  // 本页最近一批「已发送但还没被处理」的投递
  function pendingBatchForPage() {
    for (var i = state.batches.length - 1; i >= 0; i -= 1) {
      var batch = state.batches[i];
      if (batch.page === PAGE && batch.status !== "ack") return batch;
    }
    return null;
  }

  function noteTag(note) {
    if (!note.batchId) return null;
    var batch = findBatch(note.batchId);
    var done = batch ? batch.status === "ack" : false;
    return { text: done ? "已处理" : "已发送", done: done };
  }

  function toast(message, tone) {
    var node = build("div", "esb-annotate-toast", message);
    if (tone === "done") node.style.background = "rgba(4,120,87,.95)";
    document.body.appendChild(node);
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 4200);
  }

  function openDrawer() {
    if (!ui.drawer) return;
    state.listOpen = true;
    ui.drawer.style.display = "flex";
    ui.button.style.display = "none";
    renderList();
  }

  function stopDrawer() {
    if (!ui.drawer) return;
    state.listOpen = false;
    ui.drawer.style.display = "none";
    ui.button.style.display = "flex";
  }

  function latestBatchForPage() {
    for (var i = state.batches.length - 1; i >= 0; i -= 1) {
      if (state.batches[i].page === PAGE) return state.batches[i];
    }
    return null;
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    } catch (error) { /* 忽略 */ }
    if (window.console) console.log(text);
    toast("已复制：" + snippet(text, 36));
  }

  function ackBatch(batch) {
    if (typeof window.confirm === "function" && window.confirm("把这一批标记为已处理？") === false) return;
    batch.status = "ack";
    batch.ackedAt = new Date().toISOString();
    statusRemote(batch.id, "ack");
    renderList();
    refreshButton();
  }

  // 抽屉顶部的一条状态条：告诉用户这批批注发出去没有、AI 处理了没有
  function renderBanner() {
    var batch = latestBatchForPage();
    if (!batch) return null;
    var done = batch.status === "ack";
    var box = build("div", "esb-annotate-banner" + (done ? " is-done" : ""));
    box.appendChild(build("div", null, done
      ? "✓ 这一批 " + batch.count + " 条，AI 已处理"
      : "已发送 " + batch.count + " 条，等待 AI 处理"));
    box.appendChild(build("code", null, batch.id));
    var actions = build("div", "esb-banner-actions");
    var copyId = build("button", null, "复制编号");
    copyId.type = "button";
    copyId.addEventListener("click", function () {
      copyText("批注已发送：" + batch.id + "（" + PAGE + "，" + batch.count + " 条）");
    });
    actions.appendChild(copyId);
    if (!done) {
      var mark = build("button", null, "标记已处理");
      mark.type = "button";
      mark.addEventListener("click", function () { ackBatch(batch); });
      actions.appendChild(mark);
    }
    box.appendChild(actions);
    return box;
  }

  function renderList() {
    if (!ui.list) return;
    var list = notesForPage();
    if (ui.count) ui.count.textContent = String(list.length);
    ui.list.innerHTML = "";
    var banner = renderBanner();
    if (banner) ui.list.appendChild(banner);
    if (!list.length) {
      ui.list.appendChild(build("div", "esb-annotate-empty", banner
        ? "本页没有待改的批注了。点右下角「批注」继续标。"
        : "还没有批注。点右下角「批注」，再点页面上要改的地方。"));
      return;
    }
    list.forEach(function (note, index) {
      var item = build("div", "esb-annotate-item");
      var head = build("div");
      head.appendChild(build("span", "esb-idx", String(index + 1)));
      head.appendChild(build("span", "esb-what", note.comment));
      var tag = noteTag(note);
      if (tag) head.appendChild(build("span", "esb-annotate-tag" + (tag.done ? " is-done" : ""), tag.text));
      var where = build("div", "esb-where", note.selector + (note.text ? "\n「" + note.text + "」" : ""));
      var actions = build("div", "esb-actions");
      var sendOne = build("button", "esb-send-one", "只发这条");
      sendOne.type = "button";
      sendOne.addEventListener("click", function () { sendAll([note.id]); });
      var del = build("button", "esb-del", "删除");
      del.type = "button";
      del.addEventListener("click", function () {
        state.notes = state.notes.filter(function (x) { return x.id !== note.id; });
        saveLocal();
        deleteRemote(note.id);
        renderList();
        refreshButton();
      });
      actions.appendChild(sendOne);
      actions.appendChild(del);
      item.appendChild(head);
      item.appendChild(where);
      item.appendChild(actions);
      ui.list.appendChild(item);
    });
  }

  function toMarkdown() {
    var list = notesForPage();
    var lines = ["### 页面批注 · " + PAGE + "（共 " + list.length + " 条）"];
    list.forEach(function (note, index) {
      lines.push((index + 1) + ". `" + note.selector + "`" + (note.text ? " ——「" + note.text + "」" : ""));
      lines.push("   - 要改： " + note.comment);
    });
    return lines.join("\n");
  }

  // 发送：把这一页（或指定的几条）打包投递给 AI
  function sendAll(ids) {
    var mine = notesForPage();
    if (ids && ids.length) {
      mine = mine.filter(function (note) { return ids.indexOf(note.id) >= 0; });
    }
    if (!mine.length) {
      toast("这一页还没有批注。点右下角「批注」，再点页面上要改的地方。");
      return;
    }
    if (state.enabled !== true) {
      toast("批注服务没连上，先确认本地服务在跑。");
      return;
    }
    if (state.sending) return;
    state.sending = true;
    refreshButton();
    var request = sendRemote(PAGE, ids || null, mine);
    if (!request || typeof request.then !== "function") {
      state.sending = false;
      refreshButton();
      toast("浏览器不支持发送，请改用「复制全部批注」发给我。");
      return;
    }
    request.then(function (response) { return response.json(); }).then(function (data) {
      state.sending = false;
      if (!data || data.ok !== true || !data.batch) {
        refreshButton();
        toast((data && data.message) || "发送失败，稍后再试。");
        return;
      }
      state.batches.push(data.batch);
      mine.forEach(function (note) {
        note.submittedAt = data.batch.createdAt;
        note.batchId = data.batch.id;
      });
      saveLocal();
      renderList();
      refreshButton();
      toast("已发送 " + data.batch.count + " 条（" + data.batch.id + "）。回到对话里说「改吧」，我就来改。", "done");
    })["catch"](function () {
      state.sending = false;
      refreshButton();
      toast("发送失败：服务没连上，稍后再试。");
    });
  }

  function copyAll() {
    copyText(toMarkdown());
  }

  function clearAll() {
    var mine = notesForPage();
    if (!mine.length) return;
    if (typeof window.confirm === "function" && window.confirm("清空 " + PAGE + " 上的 " + mine.length + " 条批注？") === false) return;
    state.notes = state.notes.filter(function (note) { return note.page !== PAGE; });
    saveLocal();
    clearRemote(PAGE);
    renderList();
    refreshButton();
  }

  /* ----------------------------------------------------------------- 启动 */

  function boot() {
    var request = typeof window.fetch === "function"
      ? window.fetch(ENDPOINT, { headers: { Accept: "application/json" } })
      : null;
    if (!request || typeof request.then !== "function") return; // 无 fetch：静默不启用
    request.then(function (response) { return response.json(); }).then(function (data) {
      if (!data || data.enabled !== true) return; // 生产环境或未开启：不构建 UI
      state.enabled = true;
      if (Object.prototype.toString.call(data.notes) === "[object Array]") {
        data.notes.forEach(upsert);
        saveLocal();
      }
      if (Object.prototype.toString.call(data.batches) === "[object Array]") {
        state.batches = data.batches;
      }
      mount();
      bindPageGuards();
    })["catch"](function () { /* 服务端未连通：不启用，避免污染页面 */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
