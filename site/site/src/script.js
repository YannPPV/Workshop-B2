const screens = ["accueil", "blague", "analyse", "radar", "resultat"];
const detectButton = document.getElementById("detectButton");
const microButton = document.getElementById("microButton");
const restartButton = document.getElementById("restartButton");
const retryButton = document.getElementById("retryButton");
const statusMessage = document.getElementById("status");
const resultText = document.getElementById("resultText");
const radarTitle = document.getElementById("radarTitle");
const radarStatus = document.getElementById("radarStatus");
const radarPortal = document.getElementById("radarPortal");
const radarDisplay = document.getElementById("radarDisplay");
const validationStatus = document.getElementById("validationStatus");
const searchState = document.getElementById("searchState");
const jokeForm = document.getElementById("jokeForm");
const jokeInput = document.getElementById("jokeInput");
const submitButton = document.getElementById("submitButton");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let isListening = false;
let isStarting = false;
let isStopping = false;
let isAnalysing = false;
let texteReconnu = "";
let stopRecording = () => {};
let radarTimer = null;
let radarSession = 0;
let validatedJoke = null;
let isSearching = false;
let radarController = null;

function updateControls() {
    microButton.disabled = !SpeechRecognition || isStopping || isAnalysing;
    microButton.title = isListening ? "Terminer la blague"
        : isStarting ? "Annuler le démarrage du micro" : "Raconter une blague";
    submitButton.disabled = isStarting || isListening || isStopping || isAnalysing;
    jokeInput.disabled = isStarting || isListening || isStopping || isAnalysing;
}

function stopRadar() {
    const token = validatedJoke?.token;
    validatedJoke = null;
    isSearching = false;
    radarSession += 1;
    clearTimeout(radarTimer);
    radarTimer = null;
    radarController?.abort();
    radarController = null;
    radarPortal.hidden = true;
    radarDisplay.classList.remove("searching");
    radarDisplay.classList.remove("found");
    validationStatus.textContent = "Validation de la blague requise";
    searchState.textContent = "Recherche arrêtée";
    if (token) {
        // Annuler l'autorisation serveur aussi lors d'un départ de la page.
        fetch("/api/recherche", {
            method: "DELETE",
            headers: { Authorization: "Bearer " + token },
            keepalive: true,
        }).catch(() => {});
    }
}

function showScreen(name) {
    if (name !== "radar") stopRadar();
    screens.forEach((id) => {
        document.getElementById(id).classList.toggle("active", id === name);
    });
}

function resetStatus() {
    statusMessage.textContent = SpeechRecognition
        ? "Clique sur le micro, raconte ta blague, puis reclique pour l'analyser."
        : "Reconnaissance vocale indisponible : écris ta blague ci-dessous.";
}

function startRecording() {
    let recognition;
    try {
        recognition = new SpeechRecognition();
    } catch (error) {
        statusMessage.textContent = "Impossible d'initialiser le micro. Écris ta blague ci-dessous.";
        document.getElementById("textEntry").open = true;
        return;
    }

    // Chaque tentative possède ses propres événements et délais :
    // un événement tardif d'une ancienne tentative ne bloque pas la suivante.
    let finished = false;
    let speechActive = false;
    let startTimer = null;
    let silenceTimer = null;
    let stopTimer = null;
    texteReconnu = "";
    jokeInput.value = "";
    isStarting = true;
    statusMessage.textContent = "Démarrage du micro… Autorise son accès si le navigateur le demande.";
    updateControls();

    function finish(errorMessage = "") {
        if (finished) return;
        finished = true;
        clearTimeout(startTimer);
        clearTimeout(silenceTimer);
        clearTimeout(stopTimer);
        isStarting = false;
        isListening = false;
        isStopping = false;
        microButton.classList.remove("recording");
        updateControls();
        // Libérer le micro même si le navigateur n'a pas envoyé onend.
        try { recognition.abort(); } catch (error) { /* Déjà arrêté. */ }

        if (errorMessage) {
            statusMessage.textContent = errorMessage;
            document.getElementById("textEntry").open = true;
            return;
        }
        const texte = texteReconnu.trim();
        if (texte) {
            jokeInput.value = texte;
            envoyerTexteAuBackend(texte);
        } else {
            statusMessage.textContent = "Aucun texte reconnu. Réessaie le micro ou écris ta blague ci-dessous.";
            document.getElementById("textEntry").open = true;
        }
    }

    stopRecording = () => {
        if (finished || isStopping) return;
        if (isStarting) {
            finish("Démarrage du micro annulé. Tu peux réessayer ou écrire ta blague.");
            return;
        }
        isStopping = true;
        clearTimeout(silenceTimer);
        statusMessage.textContent = "Fin de l'écoute… Préparation de l'analyse.";
        updateControls();
        // Certains navigateurs n'envoient jamais onend après stop().
        // Conserver et analyser le dernier texte reconnu après ce délai.
        stopTimer = setTimeout(() => finish(), 2500);
        try { recognition.stop(); } catch (error) { finish(); }
    };

    function waitForSilence(delay = 3000) {
        clearTimeout(silenceTimer);
        if (!finished && !isStopping) {
            silenceTimer = setTimeout(stopRecording, delay);
        }
    }

    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        if (finished) return;
        clearTimeout(startTimer);
        isStarting = false;
        isListening = true;
        microButton.classList.add("recording");
        statusMessage.textContent = "Je t'écoute… Reclique sur le micro quand tu as terminé.";
        updateControls();
        // Laisser le temps de commencer ; ne pas arrêter après 3 s de latence.
        waitForSilence(15000);
    };
    recognition.onspeechstart = () => {
        if (finished || isStopping) return;
        speechActive = true;
        clearTimeout(silenceTimer);
    };
    recognition.onspeechend = () => {
        if (finished) return;
        speechActive = false;
        waitForSilence();
    };
    recognition.onresult = (event) => {
        if (finished) return;
        const fragments = [];
        for (let i = 0; i < event.results.length; i += 1) {
            fragments.push(event.results[i][0].transcript.trim());
        }
        // Le texte provisoire peut être le seul résultat disponible à l'arrêt.
        texteReconnu = fragments.join(" ").trim();
        jokeInput.value = texteReconnu;
        if (!isStopping) statusMessage.textContent = "J'ai compris : " + texteReconnu;
        if (!speechActive) waitForSilence();
    };
    recognition.onerror = (event) => {
        if (finished) return;
        const messages = {
            "not-allowed": "L'accès au microphone a été refusé. Autorise-le dans ton navigateur ou écris ta blague.",
            "service-not-allowed": "Le service vocal de ce navigateur est indisponible. Écris ta blague ci-dessous.",
            "no-speech": "Aucune parole détectée. Réessaie ou écris ta blague ci-dessous.",
            "audio-capture": "Impossible d'accéder au microphone. Vérifie sa connexion ou écris ta blague.",
            "network": "La reconnaissance vocale n'a pas pu se connecter. Réessaie ou écris ta blague ci-dessous.",
        };
        finish(messages[event.error] || "Erreur de reconnaissance : " + event.error);
    };
    recognition.onend = () => finish();
    startTimer = setTimeout(() => finish(
        "Le navigateur n'a pas démarré la reconnaissance vocale. Vérifie l'autorisation du micro ou écris ta blague."
    ), 10000);
    try {
        recognition.start();
    } catch (error) {
        finish("Impossible de démarrer le microphone. Réessaie ou écris ta blague.");
    }
}

if (!SpeechRecognition) document.getElementById("textEntry").open = true;
resetStatus();
updateControls();

detectButton.addEventListener("click", () => showScreen("blague"));
microButton.addEventListener("click", () => {
    if (!SpeechRecognition || isAnalysing || isStopping) return;
    if (isListening || isStarting) stopRecording();
    else startRecording();
});

jokeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isAnalysing || isListening || isStarting || isStopping) return;
    const texte = jokeInput.value.trim();
    if (!texte) {
        statusMessage.textContent = "Écris une blague avant de lancer l'analyse.";
        return;
    }
    envoyerTexteAuBackend(texte);
});

retryButton.addEventListener("click", () => {
    resetStatus();
    showScreen("blague");
});

restartButton.addEventListener("click", () => {
    jokeInput.value = "";
    texteReconnu = "";
    radarPortal.hidden = true;
    resetStatus();
    showScreen("accueil");
});

async function requestJSON(url, options = {}, timeout = 5000, controller = new AbortController()) {
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) {
            const error = new Error(typeof data.detail === "string"
                ? data.detail : "La requête a échoué (HTTP " + response.status + ").");
            error.status = response.status;
            throw error;
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

async function envoyerTexteAuBackend(texte) {
    if (isAnalysing) return;
    const previousToken = validatedJoke?.token;
    isAnalysing = true;
    updateControls();
    const startedAt = Date.now();
    let analysisTimer = null;
    function updateAnalysisStatus() {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        document.getElementById("progressLabel").textContent =
            "Analyse en cours depuis " + seconds + " s. Le calcul peut prendre plus d'une minute.";
        analysisTimer = setTimeout(updateAnalysisStatus, 1000);
    }
    try {
        showScreen("analyse");
        document.getElementById("analyseTranscript").textContent = "Blague reçue : " + texte;
        updateAnalysisStatus();
        const result = await requestJSON("/analyse", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(previousToken ? { Authorization: "Bearer " + previousToken } : {}),
            },
            body: JSON.stringify({ texte }),
        }, 310000);
        if (typeof result.portailOuvert !== "boolean" || !Number.isFinite(result.score)) {
            throw new Error("Le serveur a renvoyé une réponse d'analyse invalide.");
        }
        if (result.portailOuvert) {
            if (typeof result.rechercheToken !== "string" || !result.rechercheToken) {
                throw new Error("La validation de la blague ne permet pas de démarrer la recherche.");
            }
            showScreen("radar");
            await startRadar(result);
        } else {
            resultText.textContent = result.message + " Note : " + result.score + "/10.";
            showScreen("resultat");
        }
    } catch (error) {
        showScreen("blague");
        statusMessage.textContent = error.name === "AbortError"
            ? "L'analyse a pris trop de temps. Réessaie."
            : "Analyse impossible : " + error.message;
    } finally {
        clearTimeout(analysisTimer);
        isAnalysing = false;
        updateControls();
    }
}

async function startRadar(result) {
    stopRadar();
    if (result.portailOuvert !== true || !result.rechercheToken) return;
    validatedJoke = { token: result.rechercheToken, score: result.score };
    const session = radarSession;
    const headers = { Authorization: "Bearer " + validatedJoke.token };
    validationStatus.textContent = "Blague validée par l'IA — note : " + result.score + "/10";
    searchState.textContent = "Démarrage de la recherche…";
    radarTitle.textContent = "Recherche du portail";
    radarStatus.textContent = "Activation de la lecture des capteurs…";

    const startupController = new AbortController();
    radarController = startupController;
    try {
        const state = await requestJSON(
            "/api/recherche/demarrer", { method: "POST", headers }, 5000, startupController
        );
        if (session !== radarSession) return;
        if (state.active !== true) throw new Error("La recherche n'a pas été activée.");
        isSearching = true;
        radarDisplay.classList.add("searching");
        searchState.textContent = "Recherche active";
    } catch (error) {
        if (session !== radarSession) return;
        resultText.textContent = "Recherche impossible : " + error.message;
        showScreen("resultat");
        return;
    } finally {
        if (radarController === startupController) radarController = null;
    }

    const positions = {
        nord: { left: "50%", top: "15%" },
        sud: { left: "50%", top: "85%" },
        est: { left: "85%", top: "50%" },
        ouest: { left: "15%", top: "50%" },
    };

    async function refresh() {
        // Les deux conditions sont nécessaires : blague validée ET recherche active.
        if (!validatedJoke || !isSearching || session !== radarSession) return;
        const controller = new AbortController();
        radarController = controller;
        try {
            const data = await requestJSON("/api/capteurs", { headers }, 5000, controller);
            if (session !== radarSession || !isSearching) return;
            const position = positions[data.direction];
            const detected = data.connecte === true && Boolean(position);
            radarDisplay.classList.toggle("found", detected);
            if (detected) {
                radarPortal.style.left = position.left;
                radarPortal.style.top = position.top;
                radarPortal.hidden = false;
                radarTitle.textContent = "Portail détecté !";
                searchState.textContent = "Recherche active — signal détecté";
                radarStatus.textContent = "Direction : " + data.direction + ". Le suivi des capteurs continue.";
            } else {
                radarPortal.hidden = true;
                radarTitle.textContent = "Recherche du portail…";
                searchState.textContent = data.connecte
                    ? "Recherche active — aucun signal" : "Recherche active — attente des capteurs";
                radarStatus.textContent = data.connecte
                    ? "Déplace le détecteur : aucun obstacle à 30 cm ou moins pour le moment."
                    : "Arduino indisponible. Vérifie sa connexion et démarre le programme des capteurs.";
            }
        } catch (error) {
            if (session !== radarSession || !isSearching) return;
            if (error.status === 403) {
                resultText.textContent = "La validation de la blague a expiré. Raconte une nouvelle blague pour relancer la recherche.";
                showScreen("resultat");
                return;
            }
            radarPortal.hidden = true;
            radarDisplay.classList.remove("found");
            radarTitle.textContent = "Recherche du portail…";
            searchState.textContent = "Recherche active — reconnexion";
            radarStatus.textContent = "Capteurs inaccessibles. Nouvelle tentative en cours…";
        } finally {
            if (radarController === controller) radarController = null;
            if (session === radarSession && isSearching && validatedJoke) {
                radarTimer = setTimeout(refresh, 1000);
            }
        }
    }
    refresh();
}

window.addEventListener("pagehide", stopRadar);
