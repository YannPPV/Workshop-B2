from pydantic import BaseModel, ConfigDict, Field


class JokeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(
        min_length=1,
        max_length=5000
    )


class JudgeResult(BaseModel):
    judge: str

    score: float = Field(ge=0, le=10)
    originality: float = Field(ge=0, le=10)
    surprise: float = Field(ge=0, le=10)
    punchline: float = Field(ge=0, le=10)
    clarity: float = Field(ge=0, le=10)

    confidence: float = Field(ge=0, le=10)

    reason: str


class LLMResponse(BaseModel):
    judges: list[JudgeResult]


class EvaluationResponse(BaseModel):
    score: float
    verdict: str

    # Ici l'API finale expose bien 0 → 1
    confidence: float = Field(ge=0, le=1)

    judges: list[JudgeResult]
