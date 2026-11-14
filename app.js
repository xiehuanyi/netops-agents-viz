(function () {
  const D = window.NETOPS;
  const T = (window.NETOPS_TRACES && window.NETOPS_TRACES.cases) || [];
  const $ = (id) => document.getElementById(id);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";

  const CASES = T;
  const pos = Object.fromEntries(D.fabric.devices.map((d) => [d.id, d]));
  const PANELS = ["progress", "replay", "cloud", "scores", "fabric", "noc"];

  let caseId = "link_down";
  let mode = "a2";
  let stepIdx = -1;
  let timer = null;
  let heat = {};
  let used = new Set();
  let fxGen = 0;
  const fxTimers = [];

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
    if (id === "cloud") drawClouds();
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

  /* ── next plan ─────────────────────────────────────────── */
  (function paintPlan() {
    const plan = D.plan;
    if (!plan) return;
    $("plan-table").innerHTML = `
      <thead><tr>
        <th>Scale</th><th>Topology</th><th>Switches</th><th>Clients</th>
        <th>Cases</th><th>Our run</th><th></th>
      </tr></thead>
      <tbody>${plan.scales.map((s) => `
        <tr class="${s.status}">
          <td>${s.name}</td>
          <td>${s.topo}</td>
          <td>${s.sw}</td>
          <td>${s.cli}</td>
          <td>${s.cases}</td>
          <td>${s.scored == null ? "—" : s.scored + " scored"}</td>
          <td><span class="st ${s.status}">${s.status}</span> ${s.note}</td>
        </tr>`).join("")}</tbody>`;
    $("plan-models").innerHTML = plan.models.map((m) => `
      <article class="model-card ${m.role === "next" ? "next" : ""}">
        <p class="role">${m.role}</p>
        <h3>${m.name}</h3>
        <p>${m.note}</p>
      </article>`).join("");
  })();

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

  const TOOL_LABEL = {
    get_pingmesh_hotspots: "pingmesh",
    get_pingmesh_summary: "pingmesh summary",
    query_bgp_events: "bgp events",
    get_bgp_neighbors: "bgp neighbors",
    get_bgp_neighbor: "bgp neighbor",
    get_device_config: "config",
    get_device_interfaces: "interfaces",
    get_device_acl: "ACL",
    get_device_logs: "logs",
    get_interface_metrics: "metrics",
    get_route_table: "routes",
    get_bgp_rib: "bgp rib",
    get_topology: "topology",
    ping_test: "ping",
    traceroute: "traceroute",
  };
  function prettyTool(tool) {
    if (TOOL_LABEL[tool]) return TOOL_LABEL[tool];
    return String(tool || "").replace(/^get_/, "").replace(/_/g, " ");
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

  function fxLayer() {
    return document.getElementById("g-fx");
  }
  function pktLayer() {
    return document.getElementById("g-pkts");
  }

  function beginFx() {
    fxGen += 1;
    fxTimers.splice(0).forEach((id) => clearTimeout(id));
    const fx = fxLayer();
    const pk = pktLayer();
    if (fx) fx.innerHTML = "";
    if (pk) pk.innerHTML = "";
    return fxGen;
  }
  function alive(g) { return g === fxGen; }
  function later(g, ms, fn) {
    const id = setTimeout(() => { if (alive(g)) fn(); }, ms);
    fxTimers.push(id);
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
    svg.appendChild(el("g", { id: "g-fx" }));
    svg.appendChild(el("g", { id: "g-pkts" }));
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

  function pathPts(path) {
    return path.map((id) => pos[id]).filter(Boolean);
  }

  function animateAlong(g, circle, pts, ms, t0, t1, onDone) {
    const start = performance.now();
    function tick(now) {
      if (!alive(g)) return;
      const u = Math.min(1, (now - start) / ms);
      const p = lerpPath(pts, t0 + (t1 - t0) * u);
      circle.setAttribute("cx", p.x);
      circle.setAttribute("cy", p.y);
      if (u < 1) requestAnimationFrame(tick);
      else if (onDone) onDone();
    }
    requestAnimationFrame(tick);
  }

  function restMarker(pts, t, cls) {
    const layer = pktLayer();
    if (!layer || pts.length < 2) return;
    const p = lerpPath(pts, t);
    layer.appendChild(el("circle", { class: "pkt " + (cls || ""), r: "6", cx: p.x, cy: p.y }));
  }

  function burstAt(g, x, y) {
    const fx = fxLayer();
    if (!fx) return;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const c = el("circle", { class: "burst", r: "3", cx: x, cy: y });
      fx.appendChild(c);
      if (reduce) continue;
      const start = performance.now();
      function tick(now) {
        if (!alive(g)) return;
        const u = Math.min(1, (now - start) / 420);
        c.setAttribute("cx", x + Math.cos(ang) * 18 * u);
        c.setAttribute("cy", y + Math.sin(ang) * 18 * u);
        c.setAttribute("r", String(3.4 * (1 - u)));
        c.setAttribute("opacity", String(1 - u));
        if (u < 1) requestAnimationFrame(tick);
        else c.remove();
      }
      requestAnimationFrame(tick);
    }
  }

  function spawnPing(g, paths, result, rtt, badge) {
    const layer = pktLayer();
    const fx = fxLayer();
    if (!layer) return;
    const lossy = result === "loss";
    const slow = result === "slow";
    const cls = lossy ? "loss" : (slow ? "slow" : "echo");
    const ms = slow ? 1400 : (rtt && rtt > 5 ? Math.min(1400, 500 + rtt * 4) : 780);
    (paths || []).forEach((path, pi) => {
      const pts = pathPts(path);
      if (pts.length < 2) return;
      restMarker(pts, lossy ? 0.55 : 0.92, cls);
      const dest = pts[pts.length - 1];
      const mid = lerpPath(pts, lossy ? 0.55 : 1);
      if (fx && pi === 0) {
        later(g, reduce ? 0 : (lossy ? ms * 0.58 : ms), () => {
          if (lossy) {
            fx.appendChild(el("text", {
              class: "loss-tag pop", x: mid.x + 22, y: mid.y - 14, "text-anchor": "start",
            }, badge || "LOSS"));
          } else if (rtt != null) {
            fx.appendChild(el("text", {
              class: "rtt-tag pop", x: dest.x, y: dest.y - 38, "text-anchor": "middle",
            }, rtt + " ms"));
          } else if (badge) {
            fx.appendChild(el("text", {
              class: "rtt-tag pop", x: dest.x, y: dest.y - 38, "text-anchor": "middle",
            }, badge));
          }
        });
      }
      if (reduce) return;
      const nPkt = 3;
      for (let k = 0; k < nPkt; k++) {
        later(g, pi * 80 + k * 110, () => {
          const c = el("circle", { class: "pkt " + cls, r: "5", cx: pts[0].x, cy: pts[0].y });
          layer.appendChild(c);
          if (lossy) {
            animateAlong(g, c, pts, ms, 0, 0.58, () => {
              burstAt(g, +c.getAttribute("cx"), +c.getAttribute("cy"));
              c.remove();
            });
          } else {
            animateAlong(g, c, pts, ms, 0, 1, () => {
              c.setAttribute("class", "pkt echo");
              const ring = el("circle", {
                class: "echo-ring", cx: dest.x, cy: dest.y, r: "8",
              });
              if (fx) fx.appendChild(ring);
              animateAlong(g, c, pts, ms * 0.85, 1, 0, () => c.remove());
              if (ring && !reduce) {
                const t0 = performance.now();
                function grow(now) {
                  if (!alive(g)) return;
                  const u = Math.min(1, (now - t0) / 420);
                  ring.setAttribute("r", String(8 + 22 * u));
                  ring.setAttribute("opacity", String(0.7 * (1 - u)));
                  if (u < 1) requestAnimationFrame(grow);
                  else ring.remove();
                }
                requestAnimationFrame(grow);
              }
            });
          }
        });
      }
    });
  }

  function spawnTrace(g, paths, hops) {
    const layer = pktLayer();
    const fx = fxLayer();
    if (!layer || !fx) return;
    const path = (paths && paths[0]) || [];
    const ids = (hops && hops.length ? hops : path);
    ids.forEach((id, i) => {
      const d = pos[id];
      if (!d) return;
      later(g, i * 180, () => {
        const ring = el("circle", { class: "hop-ring" + (i === ids.length - 1 ? " now" : ""), cx: d.x, cy: d.y - 28, r: 4 });
        const lab = el("text", { class: "hop pop", x: d.x, y: d.y - 24, "text-anchor": "middle" }, String(i + 1));
        fx.appendChild(ring);
        fx.appendChild(lab);
        const n = document.getElementById("n-" + id);
        if (n) n.classList.add("probe", "data");
        if (!reduce) {
          const t0 = performance.now();
          function grow(now) {
            if (!alive(g)) return;
            const u = Math.min(1, (now - t0) / 240);
            ring.setAttribute("r", String(4 + 5 * u));
            if (u < 1) requestAnimationFrame(grow);
          }
          requestAnimationFrame(grow);
        } else {
          ring.setAttribute("r", "9");
        }
      });
    });
    const pts = pathPts(path);
    if (pts.length >= 2) {
      restMarker(pts, 0.72, "echo");
      if (!reduce) {
        const c = el("circle", { class: "pkt echo", r: "5", cx: pts[0].x, cy: pts[0].y });
        layer.appendChild(c);
        animateAlong(g, c, pts, 180 * Math.max(2, ids.length), 0, 1, () => c.remove());
      }
    }
  }

  function spawnMesh(g, paths, hot) {
    const layer = pktLayer();
    if (!layer) return;
    const cls = hot ? "loss" : "echo";
    (paths || []).forEach((path, pi) => {
      const pts = pathPts(path);
      if (pts.length < 2) return;
      restMarker(pts, 0.5, cls);
      if (reduce) return;
      later(g, pi * 90, () => {
        const fwd = el("circle", { class: "pkt " + cls, r: "4.5", cx: pts[0].x, cy: pts[0].y });
        const back = el("circle", { class: "pkt " + cls, r: "4.5", cx: pts[pts.length - 1].x, cy: pts[pts.length - 1].y });
        layer.appendChild(fwd);
        layer.appendChild(back);
        animateAlong(g, fwd, pts, 900, 0, 1, () => fwd.remove());
        animateAlong(g, back, pts, 900, 1, 0, () => back.remove());
      });
    });
  }

  function spawnScan(g) {
    const fx = fxLayer();
    if (!fx) return;
    const ring = el("circle", { class: "scan-ring", cx: "400", cy: "200", r: "16", opacity: "0.7" });
    fx.appendChild(ring);
    const order = ["spine1", "spine2", "leaf1", "leaf2", "client1", "client2"];
    order.forEach((id, i) => {
      later(g, i * 90, () => {
        const n = document.getElementById("n-" + id);
        if (n) n.classList.add("probe", "misc");
      });
    });
    if (reduce) {
      ring.setAttribute("r", "90");
      ring.setAttribute("opacity", "0.3");
      return;
    }
    const start = performance.now();
    function tick(now) {
      if (!alive(g)) return;
      const u = Math.min(1, (now - start) / 1000);
      ring.setAttribute("r", String(16 + u * 210));
      ring.setAttribute("opacity", String(0.7 * (1 - u)));
      if (u < 1) requestAnimationFrame(tick);
      else ring.remove();
    }
    requestAnimationFrame(tick);
  }

  function spawnBgp(g, devices, idle) {
    const fx = fxLayer();
    if (!fx) return;
    const leaves = devices.filter((id) => pos[id] && pos[id].role === "leaf");
    const spines = devices.filter((id) => pos[id] && pos[id].role === "spine");
    const pairs = [];
    if (leaves.length && spines.length) {
      leaves.forEach((a) => spines.forEach((b) => pairs.push([a, b])));
    } else if (devices.length >= 2) {
      pairs.push([devices[0], devices[1]]);
    }
    if (!pairs.length) {
      (devices || []).forEach((id) => {
        const d = pos[id];
        if (!d) return;
        fx.appendChild(el("text", {
          class: (idle ? "idle-tag" : "rtt-tag") + " pop",
          x: d.x, y: d.y - 32, "text-anchor": "middle",
        }, idle ? "Idle" : "Established"));
      });
      return;
    }
    pairs.forEach(([a, b]) => {
      const pa = pos[a], pb = pos[b];
      if (!pa || !pb) return;
      const mx = (pa.x + pb.x) / 2;
      const my = Math.min(pa.y, pb.y) - 28;
      const d = `M${pa.x} ${pa.y} Q${mx} ${my} ${pb.x} ${pb.y}`;
      fx.appendChild(el("path", { class: "bgp-arc " + (idle ? "idle" : "ok"), d }));
      if (idle) {
        fx.appendChild(el("text", {
          class: "idle-tag pop", x: mx, y: my - 4, "text-anchor": "middle",
        }, "Idle"));
      } else {
        fx.appendChild(el("text", {
          class: "rtt-tag pop", x: mx, y: my - 4, "text-anchor": "middle",
        }, "Established"));
      }
    });
  }

  function spawnInspect(g, devices, tool, result, badge) {
    const fx = fxLayer();
    if (!fx) return;
    (devices || []).forEach((id, i) => {
      const d = pos[id];
      if (!d) return;
      later(g, i * 70, () => {
        const loud = ["mtu", "down", "acl", "route"].includes(result);
        if (loud) {
          const cls = result === "mtu" || result === "route" ? "mtu-tag" : "loss-tag";
          const lab = result === "acl" ? (badge || "DROP") : (badge || result.toUpperCase());
          fx.appendChild(el("text", {
            class: cls + " pop", x: d.x, y: d.y - 42, "text-anchor": "middle",
          }, lab));
        } else {
          const x = d.x + 58;
          const y = d.y - 36;
          const sheet = el("g", { class: "sheet-in" });
          sheet.appendChild(el("rect", { class: "fx-sheet", x: x, y: y, width: 78, height: 36, rx: 3 }));
          sheet.appendChild(el("line", { class: "doc-line", x1: x + 8, y1: y + 12, x2: x + 70, y2: y + 12 }));
          sheet.appendChild(el("line", { class: "doc-line", x1: x + 8, y1: y + 20, x2: x + 58, y2: y + 20 }));
          sheet.appendChild(el("text", {
            class: "fx-sheet-lab", x: x + 8, y: y + 32,
          }, (badge || prettyTool(tool)).slice(0, 14)));
          fx.appendChild(sheet);
        }
      });
    });
  }

  function spawnRib(g, devices) {
    const fx = fxLayer();
    if (!fx) return;
    (devices || []).forEach((id) => {
      const d = pos[id];
      if (!d) return;
      fx.appendChild(el("text", {
        class: "rtt-tag pop", x: d.x, y: d.y - 32, "text-anchor": "middle",
      }, "RIB"));
      const neighbors = D.fabric.links
        .filter((l) => l.a === id || l.b === id)
        .map((l) => (l.a === id ? l.b : l.a));
      neighbors.forEach((nid) => {
        const p = pos[nid];
        if (!p) return;
        fx.appendChild(el("path", {
          class: "bgp-arc ok",
          d: `M${d.x} ${d.y} L${p.x} ${p.y}`,
        }));
      });
    });
  }

  function spawnDiag(g, devices, hit, label) {
    const fx = fxLayer();
    if (!fx) return;
    const fill = hit ? "#1d7a4e" : "#b03a2e";
    function stamp(x, y, text) {
      const w = Math.max(72, text.length * 8);
      const gEl = el("g", { class: "stamp-in" });
      gEl.appendChild(el("rect", {
        class: "stamp-bg", x: x - w / 2, y: y - 16, width: w, height: 22, rx: 4,
        fill,
      }));
      gEl.appendChild(el("text", {
        class: "stamp", x, y: y, "text-anchor": "middle", fill: "#fff",
      }, text));
      fx.appendChild(gEl);
    }
    (devices || []).forEach((id) => {
      const d = pos[id];
      if (!d) return;
      stamp(d.x, d.y - 36, hit ? "HIT" : "MISS");
    });
    if (!devices || !devices.length) {
      stamp(400, 48, (label || (hit ? "healthy" : "inconclusive")).slice(0, 22));
    }
  }

  function showToast(step) {
    const box = $("op-toast");
    if (!box) return;
    if (!step) {
      box.hidden = true;
      return;
    }
    const k = $("op-k");
    const v = $("op-v");
    const kind = step.kind === "tool" ? prettyTool(step.tool) : step.kind;
    const result = step.result || (step.kind === "diagnosis" ? (runOf().score === 1 ? "hit" : "miss") : "");
    k.textContent = kind;
    v.textContent = step.badge || step.hint || "";
    const cls = ["ok", "loss", "idle", "down", "stall", "slow", "mtu", "hot", "hit", "acl"]
      .includes(result) ? result : (result === "miss" || (step.kind === "diagnosis" && runOf().score === 0) ? "bad" : "ok");
    box.className = "op-toast " + cls;
    box.hidden = false;
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
    const g = beginFx();
    clearProbe();
    markGt();
    showToast(step);
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
    const result = step.result || "";
    const lossy = result === "loss" || (typeof step.loss === "number" && step.loss > 0);
    (step.links || []).forEach((id) => {
      const p = document.getElementById("p-" + id);
      if (!p) return;
      p.classList.add("probe", fam);
      if (lossy || result === "hot" || result === "down") p.classList.add("loss");
      else if (fam === "data" && step.tool !== "ping_test") p.classList.add("okflow");
    });

    if (step.kind === "diagnosis") {
      const c = caseOf();
      const named = (step.devices || [])[0];
      const hit = runOf().score === 1 || runOf().score === 1.0;
      (step.devices || []).forEach((id) => {
        const n = document.getElementById("n-" + id);
        if (!n) return;
        n.classList.add(hit ? "hit" : "miss");
      });
      if (c.gt.device && named && named !== c.gt.device) {
        const gg = document.getElementById("n-" + c.gt.device);
        if (gg) gg.classList.add("gt");
      }
      spawnDiag(g, step.devices, hit, step.hint);
      paintHeat();
      return;
    }

    const tool = step.tool || "";
    if (tool === "ping_test") spawnPing(g, step.paths, result, step.rtt, step.badge);
    else if (tool === "traceroute") spawnTrace(g, step.paths, step.hops);
    else if (tool === "get_pingmesh_hotspots" || tool === "get_pingmesh_summary") spawnMesh(g, step.paths, result === "hot");
    else if (tool === "get_topology") spawnScan(g);
    else if (tool === "get_route_table" || tool === "get_bgp_rib") spawnRib(g, step.devices);
    else if (tool === "query_bgp_events") spawnInspect(g, step.devices, tool, result, step.badge);
    else if (/bgp/.test(tool)) spawnBgp(g, step.devices, result === "idle");
    else if (/config|acl|interface|logs|metrics/.test(tool)) spawnInspect(g, step.devices, tool, result, step.badge);
    else if (step.paths && step.paths.length) spawnPing(g, step.paths, result, step.rtt, step.badge);

    paintHeat();
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
      const result = s.badge && s.kind === "tool" ? " · " + s.badge : "";
      return `<div class="row${active}${kind}${fail}">
        <div class="meta"><span class="type">${s.kind}</span> · ${s.t || "—"} · ${who}${s.tool && s.kind === "tool" ? " · " + s.tool : ""}${result}</div>
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
        ? (step.badge ? prettyTool(step.tool) + " · " + step.badge : step.hint)
        : (step.kind + (step.desk && step.desk !== "single" ? " · " + step.desk : ""));
      now.className = "now-tool hot" + ((step.kind === "diagnosis" && runOf().score === 0) || step.result === "loss" || step.result === "idle" ? " miss" : "");
      highlightDesk(step.desk === "single" ? null : step.desk);
      if (step.kind === "tool") used.add(step.tool);
    } else {
      now.textContent = "idle";
      now.className = "now-tool";
      highlightDesk(null);
      showToast(null);
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
    if (step.tool === "ping_test") return step.result === "slow" ? 1600 : 1100;
    if (step.tool === "traceroute") return 1200;
    if (step.tool === "get_topology") return 900;
    if (step.kind === "diagnosis") return 1500;
    if (step.kind === "read" || step.tool === "get_topology") return 520;
    if (step.result === "idle" || step.result === "loss" || step.result === "mtu") return 1100;
    return 680;
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
    beginFx();
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

  /* ── word clouds ───────────────────────────────────────── */
  const FAULT_RE = /(network_healthy|packet_loss|packet_corruption|high_latency|mtu_mismatch|link_down|link_flapping|bgp_neighbor_misconfig|acl_misconfig|static_route_misconfig|blackhole_route|route_policy_misconfig|inconclusive)/g;
  const FAULT_LABEL = {
    network_healthy: "healthy",
    packet_loss: "packet loss",
    packet_corruption: "corruption",
    high_latency: "high latency",
    mtu_mismatch: "MTU mismatch",
    link_down: "link down",
    link_flapping: "flapping",
    bgp_neighbor_misconfig: "BGP misconfig",
    acl_misconfig: "ACL",
    static_route_misconfig: "static route",
    blackhole_route: "blackhole",
    route_policy_misconfig: "route policy",
    inconclusive: "inconclusive",
  };
  const TOOL_COLOR = {
    data: "#bf8616",
    ctrl: "#34518f",
    cfg: "#1b2a4a",
    misc: "#0e7c86",
  };
  const FAULT_COLOR = {
    network_healthy: "#0e7c86",
    inconclusive: "#b03a2e",
    packet_loss: "#b03a2e",
    high_latency: "#bf8616",
    packet_corruption: "#8a4b08",
    mtu_mismatch: "#bf8616",
    link_down: "#1b2a4a",
    link_flapping: "#34518f",
    bgp_neighbor_misconfig: "#34518f",
    acl_misconfig: "#0e7c86",
    static_route_misconfig: "#1b2a4a",
    blackhole_route: "#5b6470",
    route_policy_misconfig: "#5b6470",
  };

  function countCloud() {
    const tools = {};
    const faults = {};
    let toolN = 0;
    let faultN = 0;
    CASES.forEach((c) => {
      ["a2", "a3c", "a3i"].forEach((m) => {
        const run = c[m];
        if (!run) return;
        (run.steps || []).forEach((s) => {
          if (s.kind === "tool" && s.tool) {
            tools[s.tool] = (tools[s.tool] || 0) + 1;
            toolN += 1;
          }
          if (s.kind === "diagnosis" || s.kind === "report") {
            const text = (s.hint || "") + " " + (run.diagnosis || "");
            const hits = text.match(FAULT_RE) || [];
            hits.forEach((h) => {
              faults[h] = (faults[h] || 0) + 1;
              faultN += 1;
            });
          }
        });
      });
    });
    return { tools, faults, toolN, faultN };
  }

  function renderCloud(svg, items, W, H) {
    svg.innerHTML = "";
    const max = Math.max(...items.map((it) => it.n), 1);
    const placed = [];
    const cx = W / 2;
    const cy = H / 2 + 8;
    items.forEach((it) => {
      let font = 12 + Math.sqrt(it.n / max) * 20;
      let node = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (node) node.remove();
        node = el("text", {
          class: "cloud-word",
          x: cx,
          y: cy,
          fill: it.color,
          "font-size": font.toFixed(1),
          "font-family": "IBM Plex Sans, Arial, sans-serif",
          "font-weight": it.n > 24 ? "700" : "600",
          "text-anchor": "middle",
          "aria-label": `${it.label} ${it.n}`,
        }, it.label);
        svg.appendChild(node);
        const bb0 = node.getBBox();
        const tw = bb0.width + 16;
        const th = bb0.height + 12;
        let ok = false;
        let x = cx;
        let y = cy;
        for (let k = 0; k < 2400; k++) {
          const r = 1 + k * 0.62;
          const ang = k * 0.29;
          x = cx + r * Math.cos(ang);
          y = cy + r * Math.sin(ang) * 0.5;
          const left = x - tw / 2;
          const top = y - th * 0.7;
          if (left < 12 || top < 18 || left + tw > W - 12 || top + th > H - 12) continue;
          const hit = placed.some((p) => !(left + tw <= p.x || p.x + p.w <= left || top + th <= p.y || p.y + p.h <= top));
          if (!hit) { ok = true; break; }
        }
        if (ok) {
          node.setAttribute("x", x);
          node.setAttribute("y", y);
          node.style.animationDelay = (placed.length * 0.04) + "s";
          const bb = node.getBBox();
          placed.push({ x: bb.x - 7, y: bb.y - 6, w: bb.width + 14, h: bb.height + 12 });
          node.appendChild(el("title", {}, `${it.label} · ${it.n}`));
          return;
        }
        font *= 0.8;
      }
    });
  }

  let cloudsDrawn = false;
  function drawClouds() {
    if (cloudsDrawn) return;
    const { tools, faults, toolN, faultN } = countCloud();
    const toolItems = Object.entries(tools)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({
        id: k, n, label: prettyTool(k), color: TOOL_COLOR[toolFamily(k)] || "#0e7c86",
      }));
    const faultItems = Object.entries(faults)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({
        id: k, n, label: FAULT_LABEL[k] || k, color: FAULT_COLOR[k] || "#1b2a4a",
      }));
    renderCloud($("cloud-tools"), toolItems, 560, 400);
    renderCloud($("cloud-faults"), faultItems, 560, 400);
    $("cloud-tools-cap").textContent = `${toolN} netops calls across A2 + A3 XS traces. Size is count. Gold = data plane, navy = config, blue = control plane.`;
    $("cloud-faults-cap").textContent = `${faultN} named types in diagnosis / desk reports. Inconclusive is the A3 packet_loss miss.`;
    $("cloud-tool-list").innerHTML = "<ol style='margin:0;padding-left:18px;font-size:13px'>" +
      toolItems.map((it) => `<li><code>${it.label}</code> · ${it.n}</li>`).join("") + "</ol>";
    $("cloud-fault-list").innerHTML = "<ol style='margin:0;padding-left:18px;font-size:13px'>" +
      faultItems.map((it) => `<li>${it.label} · ${it.n}</li>`).join("") + "</ol>";
    cloudsDrawn = true;
  }

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
    const map = { "1": "progress", "2": "replay", "3": "cloud", "4": "scores" };
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
  setPanel(PANELS.includes(start) ? start : "progress");
})();
