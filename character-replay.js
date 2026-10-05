"use strict";

// Historical frames are observations. No inventory, location or knowledge is
// inferred from current-world data or replayed through another rules engine.
const CharacterReplay = (() => {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const label = value => String(value ?? "Unknown").replaceAll("_", " ").replaceAll("-", " ");
  const json = value => JSON.stringify(value, null, 2);
  const nameAt = (view, id) => view.place_knowledge?.[id]?.name || view.village?.places?.[id]?.name || label(id);

  class Player {
    constructor(loadFrame, changed, timers = {
      set: (callback, delay) => setTimeout(callback, delay), clear: timer => clearTimeout(timer),
    }) {
      this.loadFrame = loadFrame; this.changed = changed; this.timers = timers;
      this.frames = []; this.index = -1; this.frame = null; this.speed = 0.25;
      this.playing = false; this.loading = false; this.error = null;
      this.timer = null; this.generation = 0;
    }
    cancelTimer() { if (this.timer !== null) this.timers.clear(this.timer); this.timer = null; }
    reset(frames = []) {
      this.cancelTimer(); this.generation += 1; this.playing = false;
      this.frames = frames; this.index = -1; this.frame = null; this.loading = false; this.error = null;
      this.changed(this);
    }
    pause() { this.cancelTimer(); this.playing = false; this.changed(this); }
    updateFrames(frames) {
      const tick = this.frames[this.index]?.tick;
      this.frames = frames;
      this.index = frames.findIndex(item => item.tick === tick);
      if (this.index < 0 && frames.length) return this.select(0);
      // Preserve the frame, an in-flight selection and the current dwell time.
      if (this.timer === null) this.schedule();
      this.changed(this);
    }
    setSpeed(speed) {
      if (![0.25, 0.5, 1, 2, 4, 8].includes(Number(speed))) return;
      this.speed = Number(speed); this.schedule(); this.changed(this);
    }
    schedule() {
      this.cancelTimer();
      if (!this.playing || this.loading) return;
      if (this.index >= this.frames.length - 1) return;
      this.timer = this.timers.set(() => this.select(this.index + 1), 1000 / this.speed);
    }
    async select(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) return;
      this.cancelTimer();
      const generation = ++this.generation;
      const tick = this.frames[index].tick;
      this.index = index; this.loading = true; this.frame = null; this.error = null;
      this.changed(this);
      try {
        const frame = await this.loadFrame(tick);
        if (generation !== this.generation) return;
        if (frame.tick !== tick) throw new Error("The recording does not match the selected tick.");
        this.frame = frame; this.loading = false; this.schedule(); this.changed(this);
      } catch (error) {
        if (generation !== this.generation) return;
        this.error = error.message || String(error); this.loading = false; this.playing = false;
        this.changed(this);
      }
    }
    play() {
      this.playing = true;
      if (this.frames.length && (this.index < 0 || this.error)) this.select(Math.max(0, this.index));
      else { this.schedule(); this.changed(this); }
    }
  }

  function mergeFrames(previous, incoming) {
    const seen = new Map(previous.map(frame => [frame.tick, frame]));
    for (const [index, frame] of incoming.entries()) {
      if (!Number.isSafeInteger(frame.tick) || frame.tick < 0 || !frame.event_id ||
          (index && frame.tick <= incoming[index - 1].tick)) throw new Error("The recording order is unproven.");
      const old = seen.get(frame.tick);
      if (old && (old.event_id !== frame.event_id || old.location !== frame.location)) throw new Error("The recording index changed for an existing turn.");
      seen.set(frame.tick, frame);
    }
    return [...seen.values()].sort((a, b) => a.tick - b.tick);
  }

  function actionSummary(action, view) {
    if (!action?.type) return "Recorded turn";
    const subject = action.destination ? nameAt(view, action.destination) :
      action.target ? view.visible_inhabitants?.[action.target]?.name || label(action.target) :
      label(action.item_id || action.work_id || action.building_id || action.skill_id || "");
    return `${label(action.type).toLowerCase()}${subject ? ` · ${subject}` : ""}`;
  }

  // These are deterministic presentations of captured input, not interpretations
  // of intent. Unknown fields remain available in the exact recorded JSON.
  function readable(value, depth = 0) {
    if (value === undefined) return '<span class="muted">Not recorded</span>';
    if (value === null) return '<span class="muted">None recorded</span>';
    if (typeof value !== "object") return escape(value);
    const body = Array.isArray(value) ? (value.length ? `<ul class="replay-facts">${value.map(row => `<li>${readable(row, depth + 1)}</li>`).join("")}</ul>` : '<span class="muted">None in this view</span>') :
      `<dl class="replay-facts">${Object.entries(value).map(([key, item]) => `<div><dt>${escape(label(key))}</dt><dd>${readable(item, depth + 1)}</dd></div>`).join("")}</dl>`;
    const complex = !Array.isArray(value) || value.some(item => item && typeof item === "object");
    return depth > 0 && complex && Object.keys(value).length ? `<details><summary>Show details (${Object.keys(value).length})</summary>${body}</details>` : body;
  }

  function contextEntry(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return readable(value);
    const text = value.text || value.description || value.summary || value.title || value.payload?.text;
    const heading = typeof text === "string" ? text : value.type ?
      [value.actor && label(value.actor), label(value.type).toLowerCase(), value.payload?.destination && label(value.payload.destination)].filter(Boolean).join(" · ") : null;
    if (!heading) return readable(value);
    return `<p class="replay-context-text">${escape(heading)}</p>
      ${value.tick !== undefined ? `<small class="muted">Tick ${escape(value.tick)}</small>` : ""}
      <details><summary>Recorded details</summary>${readable(value)}</details>`;
  }

  function contextCard(title, value, note = "") {
    const rows = Array.isArray(value) ? value : [value];
    const preview = rows.slice(0, 3);
    return `<section class="replay-context-card"><h3>${escape(title)}</h3>${note ? `<p class="muted">${escape(note)}</p>` : ""}
      ${preview.length ? preview.map(row => `<div class="replay-context-entry">${contextEntry(row)}</div>`).join("") : '<p class="muted">None in this view</p>'}
      ${rows.length > 3 ? `<details><summary>${rows.length - 3} more entries</summary>${rows.slice(3).map(contextEntry).join("")}</details>` : ""}</section>`;
  }

  function knowledgeMarkup(view) {
    const goal = view.personal_goal;
    const objective = goal?.objective;
    const attention = view.attention_focus;
    const goalSummary = goal ? {
      objective: objective ? [label(objective.kind).toLowerCase(), label(objective.skill_id || objective.building_id || objective.work_id || objective.settlement_id || ""), objective.target_level].filter(value => value !== undefined && value !== "").join(" · ") : undefined,
      status: goal.effective_status || goal.status,
      ...(goal.progress ? { progress: Number.isFinite(goal.progress.current) && Number.isFinite(goal.progress.target) ? `${goal.progress.current} / ${goal.progress.target}` : goal.progress } : {}),
      ...(goal.starting_reflection?.text ? { motivation: goal.starting_reflection.text } : {}),
    } : goal;
    return contextCard("Goal", goalSummary) +
      contextCard("On their mind", { ...(attention ? {
        goal_skill: attention.goal_skill, current_interest: attention.interest_skill,
        role_skills: attention.role_skills,
      } : { attention }), concerns: view.active_concerns }) +
      contextCard("Remembered", view.private_memory, "Memories included in this turn's input.") +
      contextCard("Beliefs", view.beliefs, "The character's beliefs, which may be mistaken.") +
      contextCard("Messages", view.pending_messages) +
      contextCard("Commitments", view.active_commitments?.map(item => ({
        title: item.request?.title || item.request?.description || item.request?.opportunity_id,
        status: item.status, accepted_tick: item.accepted_tick,
      }))) +
      contextCard("Events they could see", view.recent_public_events ?? view.public_events ?? view.recent_events);
  }

  function frameGraph(view) {
    const ids = new Set((view.movement?.places || []).filter(id => typeof id === "string"));
    if (view.self?.current_place) ids.add(view.self.current_place);
    return {
      nodes: [...ids].map(id => ({ id: `place:${id}`, ref: id, type: "place", label: nameAt(view, id) })),
      edges: (view.movement?.edges || []).filter(edge => Array.isArray(edge) && ids.has(edge[0]) && ids.has(edge[1]))
        .map(([from, to]) => ({ source: `place:${from}`, target: `place:${to}`, relation: "route" })),
    };
  }

  function inventoryRows(view) {
    const inventory = view.visible_materials?.inventory;
    if (!inventory) return null;
    const names = new Map((view.visible_materials.definitions || []).map(item => [item.id, item.name || label(item.id)]));
    const counts = new Map();
    for (const stack of inventory.stacks || []) counts.set(stack.item_id, (counts.get(stack.item_id) || 0) + stack.quantity);
    const rows = [...counts].map(([id, quantity]) => ({ id, name: names.get(id) || label(id), quantity }));
    for (const instance of inventory.instances || []) rows.push({
      id: instance.instance_id, name: names.get(instance.item_id) || label(instance.item_id), quantity: 1,
      equipped: Object.values(inventory.equipped || {}).includes(instance.instance_id),
      detail: instance.metadata,
    });
    return rows;
  }

  function mount(root, getJson) {
    const ui = Object.fromEntries(["person", "previous", "play", "next", "speed", "older", "refresh", "tick",
      "scrubber", "range", "status", "frame", "map", "place", "description", "nearby", "inventory", "vitals",
      "action", "outcome", "knowledge", "json", "context", "stream", "workspace", "detail", "inspect", "context-heading"].map(key => [key, root.querySelector(`[data-replay-${key}]`)]));
    let world = null, available = false, active = false, selection = "", requestGeneration = 0;
    let indexLoading = false, indexError = "", hasOlder = false, hasNewer = false, loaded = false, renderedFrame = null;
    let streamKey = "", streamIndex = -1;
    let positions = new Map();
    const cache = new Map();
    const summaries = new Map();
    const url = (identity, worldId, suffix = "") => `/api/character-replay?identity=${encodeURIComponent(identity)}&world_id=${encodeURIComponent(worldId)}${suffix}`;
    const player = new Player(async tick => {
      const identity = selection, worldId = world.world_id;
      const key = `${worldId}:${identity}:${tick}`;
      if (cache.has(key)) return cache.get(key);
      const frame = await getJson(url(identity, worldId, `&tick=${tick}`));
      if (frame.identity !== identity || frame.world_id !== worldId) throw new Error("This recording belongs to another character or world.");
      if (selection !== identity || world.world_id !== worldId) return frame;
      cache.set(key, frame);
      if (cache.size > 6) cache.delete(cache.keys().next().value);
      return frame;
    }, render);

    function renderMap(view) {
      const graph = frameGraph(view);
      positions = layoutWorldGraph(graph, positions);
      const hereId = `place:${view.self.current_place}`;
      const focus = new Set([hereId]);
      for (const edge of graph.edges) {
        if (edge.source === hereId) focus.add(edge.target);
        if (edge.target === hereId) focus.add(edge.source);
      }
      const nodes = graph.nodes.filter(node => focus.has(node.id) && positions.has(node.id));
      if (!nodes.length) { ui.map.replaceChildren(); return; }
      // The full world's schematic distances can make local labels microscopic.
      // Keep the known neighbor order, with legible spacing around this actor.
      const origin = positions.get(hereId);
      const angle = node => Math.atan2(positions.get(node.id).y - origin.y, positions.get(node.id).x - origin.x);
      const neighbors = nodes.filter(node => node.id !== hereId).sort((a, b) => angle(a) - angle(b));
      const local = new Map([[hereId, { x: 0, y: 0 }]]);
      neighbors.forEach((node, index) => {
        const bearing = -Math.PI / 2 + index * 2 * Math.PI / neighbors.length;
        local.set(node.id, { x: Math.cos(bearing) * 330, y: Math.sin(bearing) * 255 });
      });
      ui.map.setAttribute("viewBox", "-560 -365 1120 770");
      const drawn = new Set();
      const lines = graph.edges.filter(edge => focus.has(edge.source) && focus.has(edge.target)).map(edge => {
        const key = [edge.source, edge.target].sort().join("|");
        if (drawn.has(key)) return "";
        drawn.add(key);
        const a = local.get(edge.source), b = local.get(edge.target);
        if (!a || !b) return "";
        return `<path d="M${a.x},${a.y} L${b.x},${b.y}" class="replay-route"/>`;
      }).join("");
      ui.map.innerHTML = `<title>${escape(view.self.name || selection)} at ${escape(nameAt(view, view.self.current_place))}, tick ${view.tick}</title>${lines}` + nodes.map(node => {
        const point = local.get(node.id), here = node.id === hereId;
        return `<g transform="translate(${point.x} ${point.y})" class="replay-place-node ${here ? "is-here" : ""}">
          ${here ? '<circle r="74" class="replay-halo"/>' : ""}<circle r="${here ? 42 : 19}"/>
          ${here ? `<text class="replay-avatar" text-anchor="middle" dy="12">${escape((view.self.name || selection).slice(0, 1))}</text>` : ""}
          <text class="replay-place-label" text-anchor="middle" y="${here ? 111 : 62}">${escape(node.label)}</text>
          ${here ? `<text class="replay-person-label" text-anchor="middle" y="150">${escape(view.self.name || selection)}</text>` : ""}</g>`;
      }).join("");
    }

    function section(title, value, open = false) {
      return `<details ${open ? "open" : ""}><summary>${escape(title)}</summary><pre>${escape(json(value ?? "Not recorded"))}</pre></details>`;
    }

    function renderFrame(frame) {
      const view = frame.world_view;
      ui.place.textContent = nameAt(view, view.self.current_place);
      ui.description.textContent = view.local_place?.knowledge?.description || view.village?.places?.[view.self.current_place]?.description || "";
      renderMap(view);
      const neighbors = Object.entries({ ...view.local_place?.npcs, ...view.visible_inhabitants }).filter(([id]) => id !== selection);
      ui.nearby.innerHTML = `<strong>People in view</strong>${neighbors.length ? neighbors.map(([id, person]) => `<span>${escape(person.name || label(id))}</span>`).join("") : '<span class="muted">No other inhabitants in this view</span>'}`;
      const rows = inventoryRows(view);
      ui.inventory.innerHTML = rows === null ? '<p class="muted">Inventory was not recorded.</p>' : !rows.length ? '<p class="muted">Nothing carried.</p>' :
        '<ul class="replay-items">' + rows.map(item => `<li><span>${escape(item.name)}${item.equipped ? '<small>Equipped</small>' : ""}${item.detail ? `<small>${escape(Object.entries(item.detail).map(([key, value]) => `${label(key)}: ${typeof value === "object" ? json(value) : value}`).join(" · "))}</small>` : ""}</span><strong>×${escape(item.quantity)}</strong></li>`).join("") + "</ul>";
      const vitals = view.combat?.vitals || {};
      const meters = Object.entries(vitals).filter(([key]) => !key.startsWith("max_")).map(([key, value]) => ({ key, value, max: vitals[`max_${key}`] }));
      for (const key of ["hydration", "nourishment"]) if (view[key]) meters.push({ key, value: view[key].value, max: view[key].max });
      ui.vitals.innerHTML = meters.map(({ key, value, max }) => `<div><span>${escape(label(key))}</span><strong>${escape(value)}${max ? ` / ${escape(max)}` : ""}</strong>${Number.isFinite(value) && Number.isFinite(max) && max > 0 ? `<meter min="0" max="${max}" value="${value}" aria-label="${escape(label(key))}"></meter>` : ""}</div>`).join("") || '<p class="muted">Condition was not recorded.</p>';
      const summary = actionSummary(frame.action, view);
      summaries.set(frame.tick, { text: summary, status: frame.validator.status, place: nameAt(view, view.self.current_place) });
      ui.action.textContent = `${view.self.name || selection}: ${summary}`;
      ui.outcome.innerHTML = `<p class="replay-result"><strong>${escape(label(frame.validator.status))}</strong>${frame.validator.reason ? ` · ${escape(label(frame.validator.reason))}` : ""}</p>
        ${frame.action.text ? `<blockquote>${escape(frame.action.text)}</blockquote>` : ""}
        <p class="muted">Recorded action and result. The map, belongings and context show the start of this turn.</p>` +
        section("Exact action and result", { action: frame.action, result: frame.validator });
      ui["context-heading"].textContent = `In ${view.self.name || selection}'s context · tick ${frame.tick.toLocaleString()}`;
      ui.knowledge.innerHTML = knowledgeMarkup(view) +
        `<details class="replay-context-card"><summary>Resources, work and available actions</summary>${readable({
          resources: view.local_place?.resource_nodes, stores: view.local_place?.shared_stores,
          work: view.nearby_work_opportunities, actions: view.action_grounding,
        })}</details>`;
      ui.json.textContent = json(view);
      ui.context.textContent = frame.identity_context;
    }

    function renderStream() {
      const key = player.frames.map(item => `${item.tick}:${summaries.get(item.tick)?.text || ""}`).join("|");
      if (key !== streamKey) {
        const focusedTick = ui.stream.contains(document.activeElement) ? document.activeElement?.dataset.replayTurn : null;
        ui.stream.innerHTML = player.frames.map((item, index) => {
          const summary = summaries.get(item.tick);
          const gap = index ? item.tick - player.frames[index - 1].tick - 1 : 0;
          return `<li>${gap > 0 ? `<p class="replay-gap">${gap} intervening world ticks</p>` : ""}
            <button type="button" data-replay-turn="${item.tick}"><span class="replay-stream-tick">Tick ${item.tick.toLocaleString()}</span>
            <strong>${escape(summary?.text || `At ${label(item.location)}`)}</strong>
            <small>${escape(summary ? `${label(summary.status)} · ${summary.place}` : "Open recorded context")}</small></button></li>`;
        }).join("");
        if (focusedTick) ui.stream.querySelector(`[data-replay-turn="${focusedTick}"]`)?.focus({ preventScroll: true });
        streamKey = key;
      }
      const tick = player.frames[player.index]?.tick;
      for (const button of ui.stream.querySelectorAll("[data-replay-turn]")) {
        if (Number(button.dataset.replayTurn) === tick) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      }
      if (player.playing && player.index !== streamIndex) {
        const row = ui.stream.querySelector(`[data-replay-turn="${tick}"]`)?.parentElement;
        if (row && (row.offsetTop < ui.stream.scrollTop || row.offsetTop + row.offsetHeight > ui.stream.scrollTop + ui.stream.clientHeight)) {
          ui.stream.scrollTop = row.offsetTop;
        }
      }
      streamIndex = player.index;
    }

    function render() {
      const count = player.frames.length, busy = player.loading;
      ui.person.disabled = !available;
      ui.refresh.disabled = !available || indexLoading;
      ui.older.disabled = !available || indexLoading || !hasOlder;
      ui.play.disabled = !available || (!loaded && indexLoading);
      ui.previous.disabled = busy || player.index <= 0;
      ui.next.disabled = busy || player.index >= count - 1;
      ui.scrubber.disabled = !count;
      ui.scrubber.max = String(Math.max(0, count - 1)); ui.scrubber.value = String(Math.max(0, player.index));
      ui.scrubber.setAttribute("aria-valuetext", player.index >= 0 ? `Tick ${player.frames[player.index].tick}` : "No recording");
      ui.play.textContent = player.playing ? "Ⅱ Pause" : "▶ Play";
      ui.tick.textContent = player.index >= 0 ? `Tick ${player.frames[player.index].tick.toLocaleString()}` : "Tick —";
      ui.range.textContent = count ? `${count} recorded turns · ticks ${player.frames[0].tick.toLocaleString()}–${player.frames[count - 1].tick.toLocaleString()}` : "No recordings loaded";
      ui.workspace.hidden = !available;
      // Reserve the previous layout while the next frame loads. Hiding the
      // context without this spacer clamps document scroll back to the top.
      if (player.loading && !ui.frame.hidden) ui.detail.style.minHeight = `${ui.detail.getBoundingClientRect().height}px`;
      ui.frame.hidden = !available || !player.frame;
      ui.detail.setAttribute("aria-busy", String(player.loading));
      ui.inspect.hidden = !available || !count || Boolean(player.frame);
      ui.inspect.textContent = player.loading ? "Loading the selected turn…" : "Select a recorded turn to inspect its context.";
      let status = "Choose a character and press Play.";
      if (!available) status = "Full character replay is available in the local viewer with Character lens enabled. Private memories and historical inventory are not published on this site.";
      else if (indexError || player.error) status = `Recording unavailable: ${indexError || player.error}`;
      else if (indexLoading && !loaded) status = "Reading recorded turns…";
      else if (player.loading) status = "Loading this turn's view…";
      else if (loaded && !count) status = `${player.playing ? "Waiting for the first recorded turn." : "No recorded turns yet."} New recordings appear automatically. Earlier views cannot be recovered from the event list.`;
      else if (player.frame) {
        const gap = player.index > 0 ? player.frame.tick - player.frames[player.index - 1].tick - 1 : 0;
        const remaining = count - player.index - 1;
        const phase = player.playing ? (remaining ? "Playing" : "Waiting for the next recorded turn — Play will continue automatically") : "Paused — this context stays here";
        status = `${phase}.${remaining ? ` ${remaining} later turn${remaining === 1 ? "" : "s"} ready.` : ""}${hasNewer ? " Catching up with more recordings…" : ""}${gap > 0 ? ` ${gap} intervening world ticks have no recorded turn for this character.` : ""}`;
      }
      ui.status.textContent = status;
      if (player.frame && player.frame !== renderedFrame) {
        renderFrame(player.frame); renderedFrame = player.frame;
      }
      if (!player.loading) ui.detail.style.minHeight = "";
      renderStream();
    }

    async function loadIndex(older = false) {
      if (!available || !selection || indexLoading) return;
      const generation = ++requestGeneration;
      const identity = selection, worldId = world.world_id;
      const previous = player.frames.slice();
      const cursor = previous.length ? older ? `&before_tick=${previous[0].tick}` : `&after_tick=${previous.at(-1).tick}` : "";
      indexLoading = true; indexError = ""; render();
      try {
        const result = await getJson(url(identity, worldId, cursor));
        if (generation !== requestGeneration) return;
        if (result.identity !== identity || result.world_id !== worldId || !Array.isArray(result.frames)) throw new Error("The recording index does not match this character.");
        const frames = mergeFrames(previous, result.frames);
        if (!previous.length || older) hasOlder = result.has_older;
        if (!older) hasNewer = result.has_newer === true;
        indexLoading = false; loaded = true;
        await player.updateFrames(frames);
      } catch (error) {
        if (generation !== requestGeneration) return;
        indexError = error.message || String(error); indexLoading = false; render();
      }
    }

    ui.person.addEventListener("change", () => {
      requestGeneration += 1; indexLoading = false; indexError = ""; hasOlder = false; hasNewer = false;
      selection = ui.person.value; positions = new Map(); cache.clear(); summaries.clear(); loaded = false;
      player.reset(); loadIndex();
    });
    ui.play.addEventListener("click", () => player.playing ? player.pause() : player.play());
    ui.previous.addEventListener("click", () => { player.pause(); player.select(player.index - 1); });
    ui.next.addEventListener("click", () => { player.pause(); player.select(player.index + 1); });
    ui.speed.addEventListener("change", () => player.setSpeed(ui.speed.value));
    ui.scrubber.addEventListener("input", () => { player.pause(); player.select(Number(ui.scrubber.value)); });
    ui.refresh.addEventListener("click", () => loadIndex());
    ui.older.addEventListener("click", () => loadIndex(true));
    ui.stream.addEventListener("click", event => {
      const button = event.target.closest("[data-replay-turn]");
      if (!button) return;
      player.pause();
      player.select(player.frames.findIndex(item => item.tick === Number(button.dataset.replayTurn)));
    });
    // Opening any context disclosure pins the selected turn before the next
    // playback timer can replace what the reader is inspecting.
    ui.frame.addEventListener("click", event => { if (event.target.closest("summary")) player.pause(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) player.pause(); });
    return {
      updateWorld(value, mode) {
        const nextAvailable = mode !== "static" && value.character_lens_available === true;
        const reset = world?.world_id !== value.world_id || (available && !nextAvailable);
        world = value; available = nextAvailable;
        if (reset) {
          requestGeneration += 1; selection = ""; cache.clear(); summaries.clear(); positions = new Map();
          player.reset(); loaded = false; indexLoading = false; indexError = "";
          hasOlder = false; hasNewer = false;
        }
        const people = world.inhabitants || [];
        if (!people.some(person => person.id === selection)) {
          requestGeneration += 1; indexLoading = false;
          selection = people[0]?.id || ""; loaded = false; player.reset();
          cache.clear(); summaries.clear(); positions = new Map(); hasOlder = false; hasNewer = false;
        }
        ui.person.innerHTML = people.map(person => `<option value="${escape(person.id)}">${escape(person.name || person.id)}</option>`).join("");
        ui.person.value = selection;
        render();
        if (active && available && !loaded && !indexLoading) loadIndex();
      },
      refresh() {
        if (active && available && !document.hidden) return loadIndex();
      },
      setActive(value) {
        active = value; document.body.classList.toggle("character-replay-active", value);
        if (!active) player.pause();
        else if (available && !loaded && !indexLoading) loadIndex();
        else render();
      },
    };
  }
  return { Player, frameGraph, inventoryRows, mergeFrames, actionSummary, knowledgeMarkup, mount };
})();

if (typeof module !== "undefined") module.exports = CharacterReplay;
