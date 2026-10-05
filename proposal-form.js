"use strict";

(function proposalModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BrackenfordProposal = api;
  if (typeof document !== "undefined") api.initialize(document, root?.BRACKENFORD_VIEWER || {});
})(typeof globalThis === "undefined" ? null : globalThis, function proposalFactory() {
  const MODEL_CHOICES = Object.freeze(["Qwen", "Luna 6.0"]);
  const FIELD_LIMITS = Object.freeze({
    display_name: 80,
    species_background: 120,
    broad_role: 80,
    identity_seed: 500,
  });

  function boundedText(value, field) {
    if (typeof value !== "string") throw new Error(`${field} must be text`);
    const normalized = value.normalize("NFC").trim();
    if (!normalized) throw new Error(`${field} is required`);
    if ([...normalized].length > FIELD_LIMITS[field]) throw new Error(`${field} is too long`);
    if (/[\p{Cc}\p{Cf}<>]/u.test(normalized)) throw new Error(`${field} contains unsupported characters`);
    return normalized;
  }

  function buildPayload(values) {
    const modelChoice = values?.model_choice;
    if (!MODEL_CHOICES.includes(modelChoice)) throw new Error("Unknown model choice");
    return {
      display_name: boundedText(values?.display_name, "display_name"),
      species_background: boundedText(values?.species_background, "species_background"),
      broad_role: boundedText(values?.broad_role, "broad_role"),
      identity_seed: boundedText(values?.identity_seed, "identity_seed"),
      model_choice: modelChoice,
    };
  }

  function proposalEndpoint(config) {
    if (config?.mode !== "static" || typeof config.liveApiBase !== "string") return null;
    try {
      const base = new URL(config.liveApiBase);
      if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) return null;
      if (base.pathname !== "/" && base.pathname !== "") return null;
      return `${base.origin}/api/v1/character-proposals`;
    } catch {
      return null;
    }
  }

  function availabilityEndpoint(config) {
    const endpoint = proposalEndpoint(config);
    return endpoint ? `${endpoint}/availability` : null;
  }

  function publicAvailability(body) {
    const unavailable = {
      worldSlots: "Unavailable",
      pendingInbox: "Unavailable",
      available: false,
    };
    if (!body || body.status !== "available") return unavailable;
    const world = body.world_slots;
    const inbox = body.pending_inbox;
    const valid = value => Number.isSafeInteger(value) && value >= 0;
    if (
      !world || !inbox || world.capacity !== 3 ||
      !valid(world.remaining) || world.remaining > world.capacity ||
      !Number.isSafeInteger(inbox.capacity) || inbox.capacity <= 0 ||
      !valid(inbox.remaining) || inbox.remaining > inbox.capacity
    ) return unavailable;
    return {
      worldSlots: `${world.remaining} of ${world.capacity}`,
      pendingInbox: `${inbox.remaining} of ${inbox.capacity}`,
      available: true,
    };
  }

  function publicOutcome(status, body) {
    if ((status === 200 && body?.status === "duplicate") || (status === 201 && body?.status === "accepted")) {
      return {
        kind: "success",
        message: body.status === "duplicate"
          ? "This exact proposal was already received. No additional character or world slot was created."
          : "Proposal received for review. No character or world slot has been created.",
      };
    }
    if (status === 429 && body?.error === "rate_limited") {
      return { kind: "rate-limited", message: "Submission limit reached. Please wait before trying again." };
    }
    if (status === 503 && body?.error === "inbox_full") {
      return { kind: "full", message: "The review inbox is full. Nothing was submitted; please try again later." };
    }
    if (status >= 400 && status < 500) {
      return { kind: "invalid", message: "The proposal was not accepted. Check every field and try again." };
    }
    return { kind: "unavailable", message: "Proposal service is unavailable. The viewer and preview still work." };
  }

  function initialize(doc, config) {
    const open = doc.querySelector("#proposal-open");
    const dialog = doc.querySelector("#character-proposal");
    const close = doc.querySelector("#proposal-close");
    const form = doc.querySelector("#proposal-form");
    const status = doc.querySelector("#proposal-status");
    const submit = doc.querySelector("#proposal-submit");
    const worldSlots = doc.querySelector("#proposal-world-slots");
    const inboxCapacity = doc.querySelector("#proposal-inbox-capacity");
    if (!open || !dialog || !close || !form || !status || !submit || !worldSlots || !inboxCapacity) return;

    const endpoint = proposalEndpoint(config);
    const availability = availabilityEndpoint(config);
    const fields = Object.fromEntries(
      ["display_name", "species_background", "broad_role", "identity_seed", "model_choice"]
        .map(name => [name, form.elements.namedItem(name)]),
    );
    const preview = {
      display_name: doc.querySelector("#proposal-preview-name"),
      species_background: doc.querySelector("#proposal-preview-species"),
      broad_role: doc.querySelector("#proposal-preview-role"),
      identity_seed: doc.querySelector("#proposal-preview-seed"),
      model_choice: doc.querySelector("#proposal-preview-model"),
    };

    function values() {
      return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field?.value || ""]));
    }

    function renderPreview() {
      const current = values();
      preview.display_name.textContent = current.display_name.trim() || "Unnamed visitor";
      preview.species_background.textContent = current.species_background.trim() || "Species / background";
      preview.broad_role.textContent = current.broad_role.trim() || "Broad role";
      preview.identity_seed.textContent = current.identity_seed.trim() || "An open identity seed will appear here.";
      preview.model_choice.textContent = MODEL_CHOICES.includes(current.model_choice) ? current.model_choice : MODEL_CHOICES[0];
    }

    function setStatus(outcome) {
      status.dataset.kind = outcome.kind;
      status.textContent = outcome.message;
    }

    function renderAvailability(value) {
      worldSlots.textContent = value.worldSlots;
      inboxCapacity.textContent = value.pendingInbox;
      worldSlots.dataset.available = String(value.available);
      inboxCapacity.dataset.available = String(value.available);
    }

    async function refreshAvailability() {
      if (!availability) {
        renderAvailability(publicAvailability(null));
        return;
      }
      try {
        const response = await fetch(availability, { method: "GET", cache: "no-store" });
        const body = response.ok ? await response.json() : null;
        renderAvailability(publicAvailability(body));
      } catch {
        renderAvailability(publicAvailability(null));
      }
    }

    open.addEventListener("click", () => {
      dialog.showModal();
      void refreshAvailability();
    });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    form.addEventListener("input", renderPreview);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!endpoint) {
        setStatus(publicOutcome(503, {}));
        return;
      }
      let payload;
      try {
        payload = buildPayload(values());
      } catch (error) {
        setStatus({ kind: "invalid", message: error.message });
        return;
      }
      submit.disabled = true;
      setStatus({ kind: "loading", message: "Submitting bounded proposal…" });
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));
        setStatus(publicOutcome(response.status, body));
        if (response.ok) void refreshAvailability();
      } catch {
        setStatus(publicOutcome(502, {}));
      } finally {
        submit.disabled = false;
      }
    });

    if (!endpoint) {
      submit.disabled = true;
      setStatus({ kind: "unavailable", message: "Proposal service is unavailable. The viewer and preview still work." });
    }
    renderAvailability(publicAvailability(null));
    void refreshAvailability();
    renderPreview();
  }

  return {
    MODEL_CHOICES,
    availabilityEndpoint,
    buildPayload,
    proposalEndpoint,
    publicAvailability,
    publicOutcome,
    initialize,
  };
});
