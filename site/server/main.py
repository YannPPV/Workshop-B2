from dataclasses import dataclass
from pathlib import Path
from secrets import token_urlsafe
from time import monotonic
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from app.main import evaluate, router as humour_router
from app.models import JokeRequest

app = FastAPI(title="Warp Gate Detector")
app.include_router(humour_router)

BASE_DIR = Path(__file__).resolve().parent.parent
SITE_DIR = BASE_DIR / "site"

# Le site demande une blague nulle : « pas drôle » donne accès au radar.
SEUIL_BLAGUE_NULLE = 4
EXPIRATION_CAPTEURS = 10
DUREE_VALIDATION = 15 * 60


@dataclass
class AutorisationRecherche:
    expiration: float
    active: bool = False


# Une validation indépendante par tentative de jeu, jamais un déblocage global.
autorisations_recherche: dict[str, AutorisationRecherche] = {}


def token_recherche(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def verifier_recherche(authorization: str | None) -> AutorisationRecherche:
    token = token_recherche(authorization)
    autorisation = autorisations_recherche.get(token)
    if autorisation is None or monotonic() >= autorisation.expiration:
        autorisations_recherche.pop(token, None)
        raise HTTPException(403, "Valide une nouvelle blague avant de chercher le portail.")
    return autorisation


def autoriser_recherche() -> str:
    maintenant = monotonic()
    for token, autorisation in list(autorisations_recherche.items()):
        if maintenant >= autorisation.expiration:
            del autorisations_recherche[token]
    token = token_urlsafe(32)
    autorisations_recherche[token] = AutorisationRecherche(maintenant + DUREE_VALIDATION)
    return token


class TexteRecu(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    texte: str = Field(min_length=1, max_length=5000)


class DirectionRecue(BaseModel):
    direction: Literal["nord", "sud", "est", "ouest", "aucune"]


app.mount("/css", StaticFiles(directory=SITE_DIR / "css"), name="css")
app.mount("/src", StaticFiles(directory=SITE_DIR / "src"), name="src")


@app.get("/")
def afficher_page_accueil():
    return FileResponse(SITE_DIR / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/test")
def test():
    return {"status": "OK"}


@app.post("/analyse")
async def analyser_texte(
    donnees: TexteRecu, authorization: str | None = Header(default=None)
):
    # Une nouvelle analyse annule la validation précédente, même en cas d’échec LLM.
    autorisations_recherche.pop(token_recherche(authorization), None)
    evaluation = await evaluate(JokeRequest(text=donnees.texte))
    portail_ouvert = evaluation.score < SEUIL_BLAGUE_NULLE
    return {
        **evaluation.model_dump(),
        "texte": donnees.texte,
        "portailOuvert": portail_ouvert,
        "rechercheToken": autoriser_recherche() if portail_ouvert else None,
        "message": (
            "Blague validée ! La recherche du portail peut démarrer."
            if portail_ouvert
            else "Cette blague est encore trop drôle. Essaie une blague plus nulle !"
        ),
    }


derniere_direction_recue = "aucune"
derniere_reception = None


@app.post("/api/capteurs")
async def recevoir_direction(payload: DirectionRecue):
    global derniere_direction_recue, derniere_reception
    derniere_direction_recue = payload.direction
    derniere_reception = monotonic()
    return {"status": "ok", "direction": payload.direction}


@app.post("/api/recherche/demarrer")
async def demarrer_recherche(authorization: str | None = Header(default=None)):
    autorisation = verifier_recherche(authorization)
    autorisation.active = True
    return {"active": True}


@app.delete("/api/recherche", status_code=204)
async def arreter_recherche(authorization: str | None = Header(default=None)):
    autorisations_recherche.pop(token_recherche(authorization), None)
    return Response(status_code=204)


@app.get("/detector")
@app.get("/api/capteurs")
async def lire_direction(authorization: str | None = Header(default=None)):
    autorisation = verifier_recherche(authorization)
    if not autorisation.active:
        raise HTTPException(403, "Démarre la recherche après avoir fait valider ta blague.")
    connecte = (
        derniere_reception is not None
        and monotonic() - derniere_reception < EXPIRATION_CAPTEURS
    )
    return {
        "direction": derniere_direction_recue if connecte else "aucune",
        "connecte": connecte,
    }

