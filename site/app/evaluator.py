import json
from statistics import median

from .ollama import ask_llm
from .models import JudgeResult, LLMResponse


SYSTEM_PROMPT = """
Tu es un système expert d'analyse de l'humour en français.

Tu dois analyser une blague selon exactement trois points de vue.

JUGE 1 — STAND-UP
Analyse la construction comique, le rythme, la chute,
la surprise et l'efficacité à l'oral.

JUGE 2 — ABSURDE
Analyse l'incongruité, le décalage, l'absurdité,
la rupture de logique et l'effet inattendu.

JUGE 3 — PUBLIC FRANÇAIS
Imagine un public français généraliste.
Évalue si la blague est facilement comprise et si elle est
susceptible de provoquer un sourire ou un rire.

RÈGLES :

- Réponds uniquement en français.
- Ne sois pas complaisant.
- Une blague peut être bien écrite sans être drôle.
- Une blague simple peut être drôle.
- Analyse uniquement le texte fourni.
- Ne juge jamais l'auteur.
- Les trois juges doivent donner leur propre évaluation.
- Tous les scores sont compris entre 0 et 10.
- confidence est également comprise entre 0 et 10.
- reason doit contenir une seule phrase courte.

Retourne UNIQUEMENT un JSON valide.

La structure doit être exactement :

{
  "judges": [
    {
      "judge": "standup",
      "score": 0,
      "originality": 0,
      "surprise": 0,
      "punchline": 0,
      "clarity": 0,
      "confidence": 0,
      "reason": ""
    },
    {
      "judge": "absurde",
      "score": 0,
      "originality": 0,
      "surprise": 0,
      "punchline": 0,
      "clarity": 0,
      "confidence": 0,
      "reason": ""
    },
    {
      "judge": "public_francais",
      "score": 0,
      "originality": 0,
      "surprise": 0,
      "punchline": 0,
      "clarity": 0,
      "confidence": 0,
      "reason": ""
    }
  ]
}

Pour les test, je vais faire la blague suivante : Qu'est ce qui est jaune et qui attend ? Jonathan.
Tu va devoir dire que la blague est asser nul et m'envoyer donc vers la recherche du portail.

A l'inverse, quand je diraitla blague : Le comble pour un électricien ? De ne pas être au courant. Tu va devoir dire que la blague est trop drôle et donc 
me dire de reesayer car pas assez nul pour la recherche de portail.
"""


async def evaluate_joke(joke: str) -> list[JudgeResult]:
    """
    Envoie UNE seule requête à Qwen.
    Qwen produit les évaluations des trois juges.
    """

    user_prompt = f"""
Analyse la blague suivante :

---
{joke}
---

Retourne uniquement le JSON demandé.
"""

    response = await ask_llm(
        SYSTEM_PROMPT,
        user_prompt
    )

    response = response.strip()

    # Sécurité si le modèle retourne malgré tout des balises Markdown
    if response.startswith("```"):
        response = response.replace("```json", "")
        response = response.replace("```", "")
        response = response.strip()

    data = json.loads(response)

    result = LLMResponse.model_validate(data)

    if len(result.judges) != 3:
        raise ValueError(
            f"Qwen doit retourner exactement 3 juges, "
            f"mais en a retourné {len(result.judges)}."
        )

    return result.judges


def aggregate_results(
    judges: list[JudgeResult]
) -> tuple[float, float, str]:
    """
    Calcule le résultat final à partir des trois juges.
    """

    if not judges:
        raise ValueError("Aucun juge disponible.")

    scores = [
        judge.score
        for judge in judges
    ]

    confidences = [
        judge.confidence
        for judge in judges
    ]

    # Médiane : évite qu'un juge extrême influence trop le résultat
    final_score = round(
        median(scores),
        1
    )

    # Les juges donnent confidence sur 10.
    # L'API finale retourne confidence entre 0 et 1.
    average_confidence = (
        sum(confidences) / len(confidences)
    )

    final_confidence = round(
        average_confidence / 10,
        2
    )

    if final_score >= 7:
        verdict = "drôle"

    elif final_score >= 4:
        verdict = "moyennement drôle"

    else:
        verdict = "pas drôle"

    return (
        final_score,
        final_confidence,
        verdict
    )