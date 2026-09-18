import httpx


OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "qwen3:4b-instruct"


async def ask_llm(
    system_prompt: str,
    user_prompt: str
) -> str:

    payload = {
        "model": MODEL,

        # Important avec Qwen3 :
        # évite de générer des centaines de tokens de raisonnement
        "think": False,

        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],

        "stream": False,

        # Force une sortie JSON
        "format": "json",

        "options": {
            "temperature": 0.3
        }
    }

    timeout = httpx.Timeout(
        connect=10.0,
        read=300.0,
        write=30.0,
        pool=30.0
    )

    async with httpx.AsyncClient(
        timeout=timeout,

        # Important sous Windows :
        # ignore les éventuels HTTP_PROXY / HTTPS_PROXY
        # configurés dans l'environnement.
        trust_env=False
    ) as client:

        response = await client.post(
            OLLAMA_URL,
            json=payload
        )

        if response.status_code != 200:
            raise RuntimeError(
                f"Ollama HTTP {response.status_code}: "
                f"{response.text}"
            )

        data = response.json()

        return data["message"]["content"]