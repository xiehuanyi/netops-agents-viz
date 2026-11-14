(function () {
  const D = window.NETOPS;
  const T = (window.NETOPS_TRACES && window.NETOPS_TRACES.cases) || [];
  const $ = (id) => document.getElementById(id);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";

  const CASES = T;
  const pos = Object.fromEntries(D.fabric.devices.map((d) => [d.id, d]));

  let caseId = "link_down";
  let mode = "a2";
  let stepIdx = -1;
  let timer = null;
  let heat = {};
  let used = new Set();

  function caseOf() {
    return CASES.find((c) => c.id === caseId) || CASES[0];
  }
  function runOf() {
    const c = caseOf();
    const r = c && c[mode];
    if (r) return r;
    return c.a2;
  }
  function steps() {
    return (runOf() && runOf().steps) || [];
  }

  function setPanel(id) {
    if (id === "fabric" || id === "noc") id = "replay";
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.panel === id));
    if (id === "replay") drawFabric();
    history.replaceState(null, "", "#" + id);
  }

  document.querySelectorAll("nav a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setPanel(a.dataset.panel);
    });
  });

  $("timeline").innerHTML = D.timeline.map((t, i) => `
    <article class="tl ${i === 3 ? "now" : ""}">
      <div class="when">${t.when}</div>
      <div class="tag">${t.tag}</div>
      <h3>${t.title}</h3>
      <div class="score">${t.score}</div>
      <p>${t.note}</p>
    </article>
  `).join("");

  function fmtScore(n) {
    if (n === 1 || n === 1.0) return "1.0";
    if (n === 0 || n === 0.0) return "0.0";
    if (n == null) return "—";
    return String(n);
  }

  function toolFamily(tool) {
    if (["ping_test", "traceroute", "get_pingmesh_hotspots", "get_pingmesh_summary"].includes(tool)) return "data";
    if (/bgp|route|rib/i.test(tool)) return "ctrl";
    if (/config|acl|interface|logs|metrics/.test(tool)) return "cfg";
    return "misc";
  }

  function nodeBox(d) {
    const w = d.role === "client" ? 108 : 118;
    const h = 40;
    return { x: d.x - w / 2, y: d.y - h / 2, w, h };
  }

  function el(name, attrs, text) {
    const n = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    return n;
  }

  function drawFabric() {
    const svg = $("fabric-svg");
    svg.innerHTML = "";
    const c = caseOf();
    const gtLink = c && c.gt && c.gt.link;

    svg.appendChild(el("text", { x: 24, y: 28, fill: "#5b6470", "font-size": "12", "font-family": "IBM Plex Sans" }, "spines"));
    svg.appendChild(el("text", { x: 24, y: 210, fill: "#5b6470", "font-size": "12", "font-family": "IBM Plex Sans" }, "leaves"));
    svg.appendChild(el("text", { x: 24, y: 348, fill: "#5b6470", "font-size": "12", "font-family": "IBM Plex Sans" }, "clients"));

    const gLinks = el("g", { id: "g-links" });
    D.fabric.links.forEach((l) => {
      const a = pos[l.a], b = pos[l.b];
      const p = el("path", {
        id: "p-" + l.id,
        class: "link" + (gtLink === l.id ? " gt" : ""),
        d: `M${a.x} ${a.y} L${b.x} ${b.y}`,
      });
      gLinks.appendChild(p);
      const leafEnd = pos[l.a].role === "leaf" ? a : b;
      const other = leafEnd === a ? b : a;
      const leafIf = pos[l.a].role === "leaf" ? l.aIf : l.bIf;
      const lx = leafEnd.x * 0.62 + other.x * 0.38;
      const ly = leafEnd.y * 0.62 + other.y * 0.38;
      const lab = el("text", {
        id: "if-" + l.id,
        class: "if-label" + (gtLink === l.id ? " hot" : ""),
        x: lx + 10,
        y: ly - 4,
      }, leafIf);
      gLinks.appendChild(lab);
    });
    svg.appendChild(gLinks);
    svg.appendChild(el("g", { id: "g-pkts" }));

    const gNodes = el("g", { id: "g-nodes" });
    D.fabric.devices.forEach((d) => {
      const b = nodeBox(d);
      const g = el("g", { id: "n-" + d.id, class: "node " + d.role });
      g.appendChild(el("circle", { class: "scan", cx: d.x, cy: d.y, r: 8 }));
      g.appendChild(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 3 }));
      g.appendChild(el("text", { x: d.x, y: d.y - 2, "text-anchor": "middle" }, d.id));
      const sub = d.asn ? `AS ${d.asn}` : (d.ip || d.mgmt);
      g.appendChild(el("text", {
        x: d.x, y: d.y + 12, "text-anchor": "middle",
        style: "font-size:10px;font-weight:500;opacity:.85",
      }, sub));
      g.appendChild(el("text", {
        id: "h-" + d.id, class: "heat",
        x: b.x + b.w - 6, y: b.y - 4, "text-anchor": "end",
      }, ""));
      gNodes.appendChild(g);
    });
    svg.appendChild(gNodes);
    paintStep();
  }

  function lerpPath(pts, t) {
    if (pts.length === 1) return pts[0];
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x;
      const dy = pts[i + 1].y - pts[i].y;
      const len = Math.hypot(dx, dy) || 1;
      segs.push({ a: pts[i], b: pts[i + 1], len });
      total += len;
    }
    let dist = t * total;
    for (const s of segs) {
      if (dist <= s.len) {
        const u = dist / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u };
      }
      dist -= s.len;
    }
    return pts[pts.length - 1];
  }

  function spawnPackets(paths, lossy) {
    const layer = document.getElementById("g-pkts");
    if (!layer) return;
    layer.innerHTML = "";
    (paths || []).forEach((path) => {
      const pts = path.map((id) => pos[id]).filter(Boolean);
      if (pts.length < 2) return;
      const rest = lerpPath(pts, 0.62);
      const marker = el("circle", {
        class: "pkt" + (lossy ? " loss" : ""),
        r: 6, cx: rest.x, cy: rest.y,
      });
      layer.appendChild(marker);
      if (reduce) return;
      const c = el("circle", { class: "pkt" + (lossy ? " loss" : ""), r: 5, cx: pts[0].x, cy: pts[0].y });
      layer.appendChild(c);
      const start = performance.now();
      const ms = 820;
      function tick(now) {
        const t = Math.min(1, (now - start) / ms);
        const p = lerpPath(pts, t);
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        if (t < 1) requestAnimationFrame(tick);
        else c.remove();
      }
      requestAnimationFrame(tick);
    });
  }

  function clearProbe() {
    document.querySelectorAll(".node").forEach((n) => {
      n.classList.remove("probe", "data", "ctrl", "cfg", "misc", "hit", "miss");
    });
    document.querySelectorAll(".link").forEach((l) => {
      l.classList.remove("probe", "data", "ctrl", "cfg", "loss", "okflow");
    });
  }

  function markGt() {
    const c = caseOf();
    if (!c) return;
    if (c.gt.device) {
      const n = document.getElementById("n-" + c.gt.device);
      if (n) n.classList.add("gt");
    }
  }

  function paintHeat() {
    D.fabric.devices.forEach((d) => {
      const t = document.getElementById("h-" + d.id);
      if (!t) return;
      const n = heat[d.id] || 0;
      t.textContent = n ? String(n) : "";
    });
  }

  function applyVisual(step) {
    clearProbe();
    markGt();
    if (!step) {
      paintHeat();
      return;
    }
    const fam = toolFamily(step.tool);
    (step.devices || []).forEach((id) => {
      heat[id] = (heat[id] || 0) + 1;
      const n = document.getElementById("n-" + id);
      if (n) n.classList.add("probe", fam);
    });
    const lossy = typeof step.loss === "number" && step.loss > 0;
    (step.links || []).forEach((id) => {
      const p = document.getElementById("p-" + id);
      if (!p) return;
      p.classList.add("probe", fam);
      if (lossy) p.classList.add("loss");
      else if (fam === "data" && step.tool !== "ping_test") p.classList.add("okflow");
    });
    if (step.kind === "diagnosis") {
      const c = caseOf();
      const named = (step.devices || [])[0];
      (step.devices || []).forEach((id) => {
        const n = document.getElementById("n-" + id);
        if (!n) return;
        const ok = c.gt.device ? id === c.gt.device : /healthy|none/i.test(step.hint);
        n.classList.add(ok ? "hit" : "miss");
      });
      if (c.gt.device && named && named !== c.gt.device) {
        const g = document.getElementById("n-" + c.gt.device);
        if (g) g.classList.add("gt");
      }
    }
    paintHeat();
    if (step.paths && step.paths.length) spawnPackets(step.paths, lossy);
  }

  function uniqueTools(list) {
    const seen = [];
    list.forEach((s) => {
      if (s.kind !== "tool") return;
      if (!seen.includes(s.tool)) seen.push(s.tool);
    });
    return seen;
  }

  function paintStrip() {
    const tools = uniqueTools(steps());
    $("toolstrip").innerHTML = tools.map((t) => {
      const on = used.has(t) ? " on " + toolFamily(t) : "";
      const now = (stepIdx >= 0 && steps()[stepIdx] && steps()[stepIdx].tool === t) ? " now" : "";
      return `<span class="tpill${on}${now}" data-tool="${t}">${t.replace(/^get_/, "")}</span>`;
    }).join("");
  }

  function highlightDesk(id) {
    document.querySelectorAll(".desk").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-id") === id);
    });
  }

  function paintHead() {
    const c = caseOf();
    const r = runOf();
    const modeLabel = { a2: "A2 harness (single agent)", a3c: "A3 communicate", a3i: "A3 isolated" }[mode];
    $("replay-title").textContent = `${c.name} · ${c.gt.type}`;
    $("replay-sub").textContent = `${modeLabel} · ${r.tools} netops calls · ${r.n} events`;
    const gt = c.gt.device
      ? `${c.gt.type} · ${c.gt.device}${c.gt.iface ? " " + c.gt.iface : ""}`
      : (c.gt.type || "network_healthy");
    const ok = r.score === 1 || r.score === 1.0;
    $("diag").innerHTML = `
      <dt>Ground truth</dt><dd>${gt}</dd>
      <dt>This run</dt>
      <dd><span class="badge ${ok ? "ok" : "bad"}">${fmtScore(r.score)} · ${r.diagnosis}</span></dd>
      <dt>A2 harness / OpenCode</dt>
      <dd>${fmtScore(c.a2.score)} / ${fmtScore(c.oc.score)} · OC ${c.oc.diagnosis}</dd>
      <dt>A3 communicate / isolated</dt>
      <dd>${c.a3c ? fmtScore(c.a3c.score) : "—"} / ${c.a3i ? fmtScore(c.a3i.score) : "—"}</dd>
    `;
  }

  function renderLog() {
    const list = steps();
    const rows = list.slice(0, stepIdx + 1).map((s, i) => {
      const active = i === stepIdx ? " active" : "";
      const kind = ["dispatch", "handoff", "clarify", "diagnosis"].includes(s.kind) ? " cmd" : "";
      const fail = s.kind === "diagnosis" && (runOf().score === 0) ? " fail" : "";
      const who = s.desk === "single" ? "harness" : s.desk;
      return `<div class="row${active}${kind}${fail}">
        <div class="meta"><span class="type">${s.kind}</span> · ${s.t || "—"} · ${who}${s.tool && s.kind === "tool" ? " · " + s.tool : ""}</div>
        <div>${s.hint || ""}</div>
      </div>`;
    }).join("");
    $("log").innerHTML = rows || `<div class="row"><div class="meta">idle</div><div>Press Play. ${list.length} events from the frozen trajectory light the Clos.</div></div>`;
    $("log").scrollTop = $("log").scrollHeight;
  }

  function paintStep() {
    const list = steps();
    const step = stepIdx >= 0 ? list[stepIdx] : null;
    $("replay-status").textContent = stepIdx < 0 ? `ready · ${list.length}` : `${stepIdx + 1} / ${list.length}`;
    const now = $("now-tool");
    if (step) {
      now.textContent = step.kind === "tool"
        ? step.hint
        : (step.kind + (step.desk && step.desk !== "single" ? " · " + step.desk : ""));
      now.className = "now-tool hot" + ((step.kind === "diagnosis" && runOf().score === 0) ? " miss" : "");
      highlightDesk(step.desk === "single" ? null : step.desk);
      if (step.kind === "tool") used.add(step.tool);
    } else {
      now.textContent = "idle";
      now.className = "now-tool";
      highlightDesk(null);
    }
    applyVisual(step);
    paintStrip();
    renderLog();
  }

  function stopPlay() {
    if (timer) clearTimeout(timer);
    timer = null;
    $("play").textContent = "Play";
  }

  function delayFor(step) {
    if (!step) return 700;
    if (step.tool === "ping_test" || step.tool === "traceroute") return 980;
    if (step.kind === "diagnosis") return 1400;
    if (step.kind === "read" || step.tool === "get_topology") return 520;
    return 640;
  }

  function stepOnce() {
    const list = steps();
    if (stepIdx >= list.length - 1) {
      stopPlay();
      return false;
    }
    stepIdx += 1;
    paintStep();
    return stepIdx < list.length - 1;
  }

  function play() {
    if (timer) { stopPlay(); return; }
    if (stepIdx >= steps().length - 1) resetReplay(false);
    $("play").textContent = "Pause";
    const tick = () => {
      const more = stepOnce();
      if (more) timer = setTimeout(tick, delayFor(steps()[stepIdx]));
      else stopPlay();
    };
    tick();
  }

  function resetReplay(repaintHead) {
    stopPlay();
    stepIdx = -1;
    heat = {};
    used = new Set();
    const layer = document.getElementById("g-pkts");
    if (layer) layer.innerHTML = "";
    if (repaintHead !== false) paintHead();
    paintStep();
  }

  function syncModes() {
    const c = caseOf();
    document.querySelectorAll("#agent-modes button").forEach((b) => {
      const m = b.getAttribute("data-mode");
      b.disabled = m !== "a2" && !c[m];
      b.classList.toggle("active", m === mode);
    });
    const showDesks = mode !== "a2";
    $("desks").hidden = !showDesks;
  }

  $("desks").innerHTML = D.desks.map((d) => `
    <article class="desk" data-id="${d.id}">
      <h3>${d.name}</h3>
      <p>${d.duty}</p>
      <div class="tools">${d.tools}</div>
    </article>
  `).join("");

  $("scenario-chips").innerHTML = CASES.map((s) => {
    const miss = (s.a2.score !== 1) || (s.a3c && s.a3c.score !== 1);
    return `<button class="chip ${miss ? "bad" : ""}" type="button" data-id="${s.id}">${s.name}</button>`;
  }).join("");

  $("scenario-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    caseId = btn.dataset.id;
    [...$("scenario-chips").children].forEach((ch) => ch.classList.toggle("active", ch === btn));
    const c = caseOf();
    if (!c[mode]) mode = "a2";
    syncModes();
    resetReplay();
    drawFabric();
  });

  $("agent-modes").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    mode = b.getAttribute("data-mode");
    syncModes();
    resetReplay();
    drawFabric();
  });

  $("play").addEventListener("click", play);
  $("step").addEventListener("click", () => { stopPlay(); stepOnce(); });
  $("reset").addEventListener("click", () => resetReplay());

  /* ── scores ─────────────────────────────────────────────── */
  function bar(label, value, max, cls) {
    const pct = Math.max(4, Math.round((value / max) * 100));
    return `<div class="bar-row"><div>${label}</div>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div>${value}</div></div>`;
  }

  $("a2-bars").innerHTML = [
    bar("Harness score", D.a2.ours.score, 1, "single"),
    bar("OpenCode score", D.a2.oc.score, 1, "oc"),
    bar("Harness iface loc", D.a2.ours.iface, 1, "single"),
    bar("OpenCode iface loc", D.a2.oc.iface, 1, "oc"),
    bar("Harness USD", D.a2.ours.usd, 0.2, "single"),
    bar("OpenCode USD", D.a2.oc.usd, 0.2, "oc"),
  ].join("");

  $("a3-bars").innerHTML = [
    bar("Single agent", D.a3.single.score, 1, "single"),
    bar("Isolated desks", D.a3.isolated.score, 1, "iso"),
    bar("Communicate", D.a3.communicate.score, 1, "comm"),
    bar("Single time s", D.a3.single.time, 100, "single"),
    bar("Isolated time s", D.a3.isolated.time, 100, "iso"),
    bar("Communicate time s", D.a3.communicate.time, 100, "comm"),
  ].join("");

  $("a3-table").innerHTML = `
    <thead><tr><th>Case</th><th>Ground truth</th><th>Single</th><th>Isolated</th><th>Communicate</th></tr></thead>
    <tbody>${D.a3.rows.map((r) => `
      <tr class="${r.comm === 0 ? "miss" : ""}">
        <td>${r.label}</td><td>${r.gt}</td>
        <td>${fmtScore(r.single)}</td><td>${fmtScore(r.iso)}</td><td>${fmtScore(r.comm)}</td>
      </tr>`).join("")}</tbody>`;

  document.addEventListener("keydown", (e) => {
    const map = { "1": "progress", "2": "replay", "3": "scores" };
    if (map[e.key]) setPanel(map[e.key]);
    if (e.code === "Space" && !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)) {
      e.preventDefault();
      if (!$("replay").classList.contains("active")) setPanel("replay");
      play();
    }
    if (e.key === "ArrowRight" && $("replay").classList.contains("active")) {
      e.preventDefault();
      stopPlay();
      stepOnce();
    }
    if (e.key === "ArrowLeft" && $("replay").classList.contains("active")) {
      e.preventDefault();
      stopPlay();
      if (stepIdx >= 0) {
        stepIdx -= 1;
        heat = {};
        used = new Set();
        steps().slice(0, stepIdx + 1).forEach((s) => {
          (s.devices || []).forEach((id) => { heat[id] = (heat[id] || 0) + 1; });
          if (s.kind === "tool") used.add(s.tool);
        });
        paintStep();
      }
    }
  });

  const firstChip = $("scenario-chips").querySelector('[data-id="link_down"]') || $("scenario-chips").firstElementChild;
  if (firstChip) firstChip.classList.add("active");
  syncModes();
  paintHead();

  const start = (location.hash || "#progress").replace("#", "");
  setPanel(["progress", "replay", "scores", "fabric", "noc"].includes(start) ? start : "progress");
})();
