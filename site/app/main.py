import httpx
from fastapi import APIRouter, FastAPI, HTTPException

from .evaluator import aggregate_results, evaluate_joke
from .models import EvaluationResponse, JokeRequest

router = APIRouter()


@router.get("/api/health")
async def health():
    return {"status": "ok"}


@router.post("/api/jokes/evaluate", response_model=EvaluationResponse)
async def evaluate(request: JokeRequest):
    try:
        judges = await evaluate_joke(request.text)
        score, confidence, verdict = aggregate_results(judges)
        return EvaluationResponse(
            score=score, verdict=verdict, confidence=confidence, judges=judges
        )
    except httpx.TimeoutException as error:
        raise HTTPException(504, "L'analyse a pris trop de temps. Réessaie.") from error
    except httpx.ConnectError as error:
        raise HTTPException(
            503, "Ollama est inaccessible. Démarre Ollama puis réessaie."
        ) from error
    except Exception as error:
        print(f"Erreur LLM : {type(error).__name__}: {error}")
        raise HTTPException(
            502, "L'analyse a échoué. Vérifie Ollama et le modèle qwen3:14b, puis réessaie."
        ) from error


# Cette entrée conserve l'API seule ; server.main:app sert aussi le site.
app = FastAPI(
    title="Humour AI",
    description="Analyse locale de blagues françaises avec Qwen3 14B",
    version="0.3.0",
)
app.include_router(router)
