(function () {
  const D = window.NETOPS;
  const $ = (id) => document.getElementById(id);
  let fabricDrawn = false;
  let currentScenario = "link_down";

  function setPanel(id) {
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.panel === id));
    if (id === "fabric") drawFabric();
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

  /* ── fabric ─────────────────────────────────────────────── */
  const pos = Object.fromEntries(D.fabric.devices.map((d) => [d.id, d]));

  function nodeBox(d) {
    const w = d.role === "client" ? 108 : 118;
    const h = 40;
    return { x: d.x - w / 2, y: d.y - h / 2, w, h };
  }

  function drawFabric() {
    fabricDrawn = true;
    const svg = $("fabric-svg");
    const sc = D.scenarios.find((s) => s.id === currentScenario);
    const hotLinks = new Set(sc.highlight);
    const hotDev = new Set(sc.devices);

    const links = D.fabric.links.map((l) => {
      const a = pos[l.a], b = pos[l.b];
      const cls = hotLinks.has(l.id) ? "link hot" : "link ok";
      const leafEnd = pos[l.a].role === "leaf" ? a : b;
      const other = leafEnd === a ? b : a;
      const leafIf = pos[l.a].role === "leaf" ? l.aIf : l.bIf;
      const lx = leafEnd.x * 0.62 + other.x * 0.38;
      const ly = leafEnd.y * 0.62 + other.y * 0.38;
      return `<path class="${cls}" id="p-${l.id}" d="M${a.x} ${a.y} L${b.x} ${b.y}" />
        <text class="if-label" x="${lx + 10}" y="${ly - 4}">${leafIf}</text>`;
    }).join("");

    const nodes = D.fabric.devices.map((d) => {
      const b = nodeBox(d);
      const hot = hotDev.has(d.id) ? " hot" : "";
      const sub = d.asn ? `AS ${d.asn}` : (d.ip || d.mgmt);
      return `<g class="node ${d.role}${hot}">
        <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" />
        <text x="${d.x}" y="${d.y - 2}" text-anchor="middle">${d.id}</text>
        <text x="${d.x}" y="${d.y + 12}" text-anchor="middle" style="font-size:10px;font-weight:500;opacity:.85">${sub}</text>
      </g>`;
    }).join("");

    svg.innerHTML = `
      <text x="24" y="28" fill="#5b6470" font-size="12" font-family="IBM Plex Sans">spines</text>
      <text x="24" y="210" fill="#5b6470" font-size="12" font-family="IBM Plex Sans">leaves</text>
      <text x="24" y="348" fill="#5b6470" font-size="12" font-family="IBM Plex Sans">clients</text>
      ${links}${nodes}
    `;

    $("diag").innerHTML = `
      <dt>Ground truth</dt><dd>${sc.gt}</dd>
      <dt>A2 harness / OpenCode</dt>
      <dd>${fmtScore(sc.a2.ours)} / ${fmtScore(sc.a2.oc)}</dd>
      <dt>A3 single / isolated / communicate</dt>
      <dd>${fmtScore(sc.a3.single)} / ${fmtScore(sc.a3.iso)} / ${fmtScore(sc.a3.comm)}</dd>
      <dt>Communicate diagnosis</dt>
      <dd><span class="badge ${sc.a3.comm === 1 ? "ok" : "bad"}">${sc.a3.diagnosis}</span></dd>
      <dt>What to notice</dt><dd>${sc.blurb}</dd>
    `;
  }

  function fmtScore(n) {
    if (n === 1) return "1.0";
    if (n === 0) return "0.0";
    return String(n);
  }

  $("scenario-chips").innerHTML = D.scenarios.map((s) =>
    `<button class="chip ${s.id === "packet_loss" ? "bad" : ""}" type="button" data-id="${s.id}">${s.name}</button>`
  ).join("");

  $("scenario-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    currentScenario = btn.dataset.id;
    [...$("scenario-chips").children].forEach((c) => c.classList.toggle("active", c === btn));
    drawFabric();
  });

  /* ── desks + replay ─────────────────────────────────────── */
  $("desks").innerHTML = D.desks.map((d) => `
    <article class="desk" data-id="${d.id}">
      <h3>${d.name}</h3>
      <p>${d.duty}</p>
      <div class="tools">${d.tools}</div>
    </article>
  `).join("");

  let replayId = "link_down";
  let stepIdx = -1;
  let timer = null;

  function replay() {
    return D.replays[replayId];
  }

  function paintReplayHead() {
    const r = replay();
    $("replay-title").textContent = r.title;
    $("replay-sub").textContent = r.subtitle;
    $("replay-out").innerHTML = `<span class="badge ${r.ok ? "ok" : "bad"}">${r.outcome}</span>`;
  }

  function highlightDesk(id) {
    document.querySelectorAll(".desk").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-id") === id);
    });
  }

  function renderLog() {
    const r = replay();
    const rows = r.steps.slice(0, stepIdx + 1).map((s, i) => {
      const active = i === stepIdx ? " active" : "";
      const kind = ["dispatch", "handoff", "clarify", "diagnosis"].includes(s.type) ? " cmd" : "";
      return `<div class="row${active}${kind}">
        <div class="meta"><span class="type">${s.type}</span> · ${s.t} · ${s.from} → ${s.to}</div>
        <div>${s.text}</div>
      </div>`;
    }).join("");
    $("log").innerHTML = rows || `<div class="row"><div class="meta">idle</div><div>Press Play. ${r.steps.length} messages from the communicate run.</div></div>`;
    $("log").scrollTop = $("log").scrollHeight;
    $("replay-status").textContent = stepIdx < 0 ? "ready" : `${stepIdx + 1} / ${r.steps.length}`;
    if (stepIdx >= 0) highlightDesk(deskOf(r.steps[stepIdx]));
    else highlightDesk(null);
  }

  function deskOf(step) {
    const names = ["commander", "data-plane", "control-plane", "config"];
    if (names.includes(step.to)) return step.to;
    if (names.includes(step.from)) return step.from;
    return "commander";
  }

  function stepOnce() {
    const r = replay();
    if (stepIdx >= r.steps.length - 1) {
      stopPlay();
      return;
    }
    stepIdx += 1;
    renderLog();
  }

  function stopPlay() {
    if (timer) clearInterval(timer);
    timer = null;
    $("play").textContent = "Play";
  }

  function play() {
    if (timer) { stopPlay(); return; }
    if (stepIdx >= replay().steps.length - 1) stepIdx = -1;
    $("play").textContent = "Pause";
    stepOnce();
    timer = setInterval(stepOnce, 1100);
  }

  function resetReplay() {
    stopPlay();
    stepIdx = -1;
    renderLog();
  }

  $("replay-select").addEventListener("change", (e) => {
    replayId = e.target.value;
    currentScenario = replayId;
    paintReplayHead();
    resetReplay();
    if (fabricDrawn) {
      [...$("scenario-chips").children].forEach((c) => c.classList.toggle("active", c.dataset.id === replayId));
      drawFabric();
    }
  });
  $("play").addEventListener("click", play);
  $("step").addEventListener("click", () => { stopPlay(); stepOnce(); });
  $("reset").addEventListener("click", resetReplay);

  paintReplayHead();
  renderLog();

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

  /* ── keys ───────────────────────────────────────────────── */
  document.addEventListener("keydown", (e) => {
    const map = { "1": "progress", "2": "fabric", "3": "noc", "4": "scores" };
    if (map[e.key]) setPanel(map[e.key]);
    if (e.code === "Space" && !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)) {
      e.preventDefault();
      if (!$("noc").classList.contains("active")) setPanel("noc");
      play();
    }
  });

  const firstChip = $("scenario-chips").querySelector('[data-id="link_down"]');
  if (firstChip) firstChip.classList.add("active");

  const start = (location.hash || "#progress").replace("#", "");
  setPanel(["progress", "fabric", "noc", "scores"].includes(start) ? start : "progress");
})();
