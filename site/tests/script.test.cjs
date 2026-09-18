const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "site/src/script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
const flush = () => new Promise(setImmediate);
const response = (data, ok = true, status = 200) => ({
    ok, status, json: async () => data,
});

function setup(fetchImpl, speechAvailable = true, speechOptions = {}) {
    const elements = {};
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
        const classes = new Set(id === "accueil" ? ["active"] : []);
        elements[id] = {
            textContent: "", value: "", disabled: false, hidden: id === "radarPortal",
            style: {}, listeners: {},
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                contains: (name) => classes.has(name),
                toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
            },
            addEventListener(event, handler) { this.listeners[event] = handler; },
        };
    }
    let recognition;
    class Speech {
        constructor() { recognition = this; }
        start() { if (!speechOptions.silentStart) this.onstart(); }
        stop() { if (!speechOptions.silentStop) this.onend(); }
        abort() { this.onend(); }
    }
    const timers = new Map();
    let timerId = 0;
    const requests = [];
    const windowEvents = {};
    vm.runInNewContext(source, {
        document: { getElementById: (id) => elements[id] },
        window: { SpeechRecognition: speechAvailable ? Speech : undefined,
                  addEventListener(event, handler) { windowEvents[event] = handler; } },
        AbortController,
        setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        fetch: (url, options) => {
            requests.push({ url, options });
            if (url === "/api/recherche" && options.method === "DELETE") {
                return Promise.resolve(response({}, true, 204));
            }
            if (url === "/api/recherche/demarrer" && !speechOptions.customSearchStart) {
                return Promise.resolve(response({ active: true }));
            }
            return fetchImpl(url, options);
        },
    });
    return {
        elements, windowEvents, get recognition() { return recognition; }, requests, timers,
        runTimer(delay) {
            const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
            assert.ok(entry, "Expected a timer with delay " + delay);
            timers.delete(entry[0]);
            entry[1].fn();
        },
        active: (id) => elements[id].classList.contains("active"),
        click: (id) => elements[id].listeners.click(),
        submit(text) {
            elements.jokeInput.value = text;
            elements.jokeForm.listeners.submit({ preventDefault() {} });
        },
    };
}

test("analysis waits, then rejected joke displays result and retry works", async () => {
    let finish;
    const h = setup(() => new Promise((resolve) => { finish = resolve; }));
    h.click("detectButton");
    assert.ok(h.active("blague"));
    h.submit("Une blague");
    assert.ok(h.active("analyse"));
    assert.ok(h.elements.microButton.disabled);
    h.submit("Double envoi");
    assert.equal(h.requests.length, 1);
    finish(response({ portailOuvert: false, score: 8, message: "Trop drôle." }));
    await flush();
    assert.ok(h.active("resultat"));
    assert.match(h.elements.resultText.textContent, /8\/10/);
    h.click("retryButton");
    assert.ok(h.active("blague"));
    assert.equal(h.elements.submitButton.disabled, false);
});

test("accepted joke reads sensors, positions portal and restart stops polling", async () => {
    const h = setup(async (url) => response(url === "/analyse"
        ? { portailOuvert: true, rechercheToken: "test-validation-token", score: 2 }
        : { connecte: true, direction: "nord" }));
    h.submit("Une blague nulle");
    await flush();
    assert.ok(h.active("radar"));
    assert.equal(h.elements.radarPortal.hidden, false);
    assert.equal(h.elements.radarPortal.style.top, "15%");
    assert.equal(h.elements.radarPortal.style.left, "50%");
    assert.match(h.elements.radarStatus.textContent, /nord/);
    assert.ok([...h.timers.values()].some((timer) => timer.delay === 1000));
    h.click("restartButton");
    assert.ok(h.active("accueil"));
    assert.equal(h.elements.radarPortal.hidden, true);
    assert.equal(h.timers.size, 0);
});

test("disconnected or empty sensors never display a fake portal", async () => {
    for (const data of [{ connecte: false, direction: "nord" },
                        { connecte: true, direction: "aucune" }]) {
        const h = setup(async (url) => response(url === "/analyse"
            ? { portailOuvert: true, rechercheToken: "test-validation-token", score: 1 } : data));
        h.submit("Test");
        await flush();
        assert.ok(h.active("radar"));
        assert.equal(h.elements.radarPortal.hidden, true);
    }
});

test("all cardinal directions are placed correctly", async () => {
    for (const [direction, left, top] of [
        ["nord", "50%", "15%"], ["sud", "50%", "85%"],
        ["est", "85%", "50%"], ["ouest", "15%", "50%"],
    ]) {
        const h = setup(async (url) => response(url === "/analyse"
            ? { portailOuvert: true, rechercheToken: "test-validation-token", score: 1 } : { connecte: true, direction }));
        h.submit("Test");
        await flush();
        assert.equal(h.elements.radarPortal.style.left, left);
        assert.equal(h.elements.radarPortal.style.top, top);
    }
});

test("late sensor response cannot revive radar after restart", async () => {
    let finish;
    const h = setup((url) => url === "/analyse"
        ? Promise.resolve(response({ portailOuvert: true, rechercheToken: "test-validation-token", score: 1 }))
        : new Promise((resolve) => { finish = resolve; }));
    h.submit("Test");
    await flush();
    h.click("restartButton");
    finish(response({ connecte: true, direction: "nord" }));
    await flush();
    assert.ok(h.active("accueil"));
    assert.equal(h.elements.radarPortal.hidden, true);
    assert.equal(h.timers.size, 0);
});

test("microphone errors survive onend and do not submit partial text", () => {
    const h = setup(() => { throw new Error("Unexpected fetch"); });
    h.click("microButton");
    h.recognition.onerror({ error: "not-allowed" });
    const message = h.elements.status.textContent;
    h.recognition.onend();
    assert.match(message, /refusé/);
    assert.equal(h.elements.status.textContent, message);
    assert.equal(h.requests.length, 0);
    assert.equal(h.elements.microButton.disabled, false);
});

test("final speech results are submitted once without duplication", async () => {
    const h = setup(async () => response({ portailOuvert: false, score: 7, message: "Test" }));
    h.click("microButton");
    const event = { results: [Object.assign([{ transcript: "Une blague" }], { isFinal: true })] };
    h.recognition.onresult(event);
    h.recognition.onresult(event);
    h.recognition.onend();
    await flush();
    assert.equal(h.requests.length, 1);
    assert.equal(JSON.parse(h.requests[0].options.body).texte, "Une blague");
});

test("unavailable microphone still permits keyboard analysis", async () => {
    const h = setup(async () => response({ portailOuvert: false, score: 8, message: "Test" }), false);
    assert.ok(h.elements.microButton.disabled);
    assert.ok(h.elements.textEntry.open);
    h.submit("Blague écrite");
    await flush();
    assert.ok(h.active("resultat"));
});

test("API failure returns to input with message and allows another attempt", async () => {
    const h = setup(async () => response({ detail: "Ollama inaccessible." }, false, 503));
    h.submit("Test");
    await flush();
    assert.ok(h.active("blague"));
    assert.match(h.elements.status.textContent, /Ollama inaccessible/);
    assert.equal(h.elements.submitButton.disabled, false);
});

test("network failure and invalid analysis response allow retry", async () => {
    for (const implementation of [
        async () => { throw new TypeError("Failed to fetch"); },
        async () => response({ portailOuvert: "yes" }),
    ]) {
        const h = setup(implementation);
        h.submit("Test");
        await flush();
        assert.ok(h.active("blague"));
        assert.match(h.elements.status.textContent, /Analyse impossible/);
        assert.equal(h.elements.submitButton.disabled, false);
    }
});

test("radar retries after sensor network failure", async () => {
    const h = setup(async (url) => {
        if (url === "/analyse") return response({ portailOuvert: true, rechercheToken: "test-validation-token", score: 1 });
        throw new TypeError("offline");
    });
    h.submit("Test");
    await flush();
    assert.equal(h.elements.radarPortal.hidden, true);
    assert.match(h.elements.radarStatus.textContent, /inaccessibles/);
    assert.ok([...h.timers.values()].some((timer) => timer.delay === 1000));
});

test("manual stop analyses provisional transcript instead of losing it", async () => {
    const h = setup(async () => response({ portailOuvert: false, score: 5, message: "Test" }));
    h.click("microButton");
    h.recognition.onresult({ results: [
        Object.assign([{ transcript: "Pourquoi" }], { isFinal: true }),
        Object.assign([{ transcript: "le poulet traverse la route ?" }], { isFinal: false }),
    ] });
    h.click("microButton");
    await flush();
    assert.equal(h.requests.length, 1);
    assert.equal(JSON.parse(h.requests[0].options.body).texte,
                 "Pourquoi le poulet traverse la route ?");
});

test("missing end event cannot block manual stop or duplicate submission", async () => {
    const h = setup(async () => response({ portailOuvert: false, score: 5, message: "Test" }),
                    true, { silentStop: true });
    h.click("microButton");
    h.recognition.onresult({ results: [
        Object.assign([{ transcript: "Une blague provisoire" }], { isFinal: false }),
    ] });
    h.click("microButton");
    h.runTimer(2500);
    await flush();
    assert.equal(h.requests.length, 1);
    assert.ok(h.active("resultat"));
    h.recognition.onend();
    await flush();
    assert.equal(h.requests.length, 1);
});

test("missing start event gives a visible error and enables keyboard", () => {
    const h = setup(() => { throw new Error("Unexpected fetch"); }, true, { silentStart: true });
    h.click("microButton");
    h.runTimer(10000);
    assert.equal(h.elements.microButton.disabled, false);
    assert.equal(h.elements.submitButton.disabled, false);
    assert.ok(h.elements.textEntry.open);
    assert.match(h.elements.status.textContent, /démarré/);
});

test("speech service error without onend unlocks controls immediately", () => {
    const h = setup(() => { throw new Error("Unexpected fetch"); });
    h.click("microButton");
    h.recognition.onerror({ error: "network" });
    assert.equal(h.elements.submitButton.disabled, false);
    assert.equal(h.elements.jokeInput.disabled, false);
    assert.ok(h.elements.textEntry.open);
});

test("recording does not stop after three seconds while speech is starting", () => {
    const h = setup(() => { throw new Error("Unexpected fetch"); });
    h.click("microButton");
    assert.equal([...h.timers.values()].some((timer) => timer.delay === 3000), false);
    h.recognition.onspeechstart();
    assert.equal(h.timers.size, 0);
});

test("events from a failed old recording do not interrupt a new recording", async () => {
    const h = setup(async () => response({ portailOuvert: false, score: 5, message: "Test" }));
    h.click("microButton");
    const old = h.recognition;
    old.onerror({ error: "network" });
    h.click("microButton");
    assert.notEqual(old, h.recognition);
    old.onend();
    assert.equal(h.elements.submitButton.disabled, true);
    h.recognition.onresult({ results: [
        Object.assign([{ transcript: "Nouvelle blague" }], { isFinal: true }),
    ] });
    h.click("microButton");
    await flush();
    assert.equal(h.requests.length, 1);
    assert.equal(JSON.parse(h.requests[0].options.body).texte, "Nouvelle blague");
});

test("no sensor request is made while validation is pending or rejected", async () => {
    let finish;
    const h = setup(() => new Promise((resolve) => { finish = resolve; }));
    h.submit("Test");
    assert.deepEqual(h.requests.map((request) => request.url), ["/analyse"]);
    finish(response({ portailOuvert: false, rechercheToken: null, score: 8, message: "Refusée" }));
    await flush();
    assert.deepEqual(h.requests.map((request) => request.url), ["/analyse"]);
    assert.ok(h.active("resultat"));
});

test("a validated flag without server authorization cannot start search", async () => {
    const h = setup(async () => response({ portailOuvert: true, score: 1 }));
    h.submit("Test");
    await flush();
    assert.ok(h.active("blague"));
    assert.equal(h.requests.length, 1);
    assert.match(h.elements.status.textContent, /validation/);
});

test("sensors are only read after server confirms search is active", async () => {
    let start;
    const h = setup((url) => {
        if (url === "/analyse") return Promise.resolve(response({
            portailOuvert: true, rechercheToken: "real-token", score: 1,
        }));
        if (url === "/api/recherche/demarrer") return new Promise((resolve) => { start = resolve; });
        return Promise.resolve(response({ connecte: true, direction: "est" }));
    }, true, { customSearchStart: true });
    h.submit("Test");
    await flush();
    assert.equal(h.requests.filter((r) => r.url === "/api/capteurs").length, 0);
    assert.equal(h.elements.radarDisplay.classList.contains("searching"), false);
    start(response({ active: true }));
    await flush();
    const sensorRequests = h.requests.filter((r) => r.url === "/api/capteurs");
    assert.equal(sensorRequests.length, 1);
    assert.equal(sensorRequests[0].options.headers.Authorization, "Bearer real-token");
    assert.ok(h.elements.radarDisplay.classList.contains("searching"));
    assert.match(h.elements.validationStatus.textContent, /validée/);
});

test("forbidden sensor response stops search and requires another joke", async () => {
    const h = setup(async (url) => url === "/analyse"
        ? response({ portailOuvert: true, rechercheToken: "expired-token", score: 1 })
        : response({ detail: "Validation expirée" }, false, 403));
    h.submit("Test");
    await flush();
    assert.ok(h.active("resultat"));
    assert.match(h.elements.resultText.textContent, /expiré/);
    assert.equal(h.elements.radarDisplay.classList.contains("searching"), false);
    assert.equal(h.timers.size, 0);
    assert.ok(h.requests.some((r) => r.url === "/api/recherche" && r.options.method === "DELETE"));
});

test("live search follows changing sensors and keeps looking when signal disappears", async () => {
    const directions = ["nord", "sud", "aucune"];
    const h = setup(async (url) => response(url === "/analyse"
        ? { portailOuvert: true, rechercheToken: "test-token", score: 1 }
        : { connecte: true, direction: directions.shift() }));
    h.submit("Test");
    await flush();
    assert.equal(h.elements.radarPortal.style.top, "15%");
    h.runTimer(1000);
    await flush();
    assert.equal(h.elements.radarPortal.style.top, "85%");
    h.runTimer(1000);
    await flush();
    assert.equal(h.elements.radarPortal.hidden, true);
    assert.ok(h.elements.radarDisplay.classList.contains("searching"));
    assert.match(h.elements.searchState.textContent, /aucun signal/);
    h.click("restartButton");
    assert.equal(h.timers.size, 0);
});

test("restart aborts in-flight polling and revokes its validation token", async () => {
    let pending;
    const h = setup((url) => url === "/analyse"
        ? Promise.resolve(response({ portailOuvert: true, rechercheToken: "cancel-token", score: 1 }))
        : new Promise((resolve) => { pending = resolve; }));
    h.submit("Test");
    await flush();
    const polling = h.requests.find((r) => r.url === "/api/capteurs");
    h.click("restartButton");
    assert.ok(polling.options.signal.aborted);
    const deletion = h.requests.find((r) => r.options.method === "DELETE");
    assert.equal(deletion.options.headers.Authorization, "Bearer cancel-token");
    pending(response({ connecte: true, direction: "est" }));
    await flush();
    assert.ok(h.active("accueil"));
    assert.equal(h.elements.radarPortal.hidden, true);
    assert.equal(h.timers.size, 0);
});

test("late start confirmation cannot resume a cancelled search", async () => {
    let finish;
    const h = setup((url) => url === "/analyse"
        ? Promise.resolve(response({ portailOuvert: true, rechercheToken: "token", score: 1 }))
        : new Promise((resolve) => { finish = resolve; }),
        true, { customSearchStart: true });
    h.submit("Test");
    await flush();
    h.click("restartButton");
    finish(response({ active: true }));
    await flush();
    assert.equal(h.requests.some((r) => r.url === "/api/capteurs"), false);
    assert.ok(h.active("accueil"));
    assert.equal(h.timers.size, 0);
});

test("leaving the page stops search and revokes the token", async () => {
    const h = setup(async (url) => response(url === "/analyse"
        ? { portailOuvert: true, rechercheToken: "leave-token", score: 1 }
        : { connecte: true, direction: "nord" }));
    h.submit("Test");
    await flush();
    h.windowEvents.pagehide();
    assert.equal(h.timers.size, 0);
    assert.equal(h.elements.radarDisplay.classList.contains("searching"), false);
    assert.equal(h.requests.at(-1).options.method, "DELETE");
});
