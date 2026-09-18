import importlib
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.models import JudgeResult

api = importlib.import_module("app.main")
server = importlib.import_module("server.main")


def judges(score):
    return [
        JudgeResult(judge=name, score=score, originality=5, surprise=5,
                    punchline=5, clarity=8, confidence=8, reason="Test.")
        for name in ("standup", "absurde", "public_francais")
    ]


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        server.derniere_direction_recue = "aucune"
        server.derniere_reception = None
        server.autorisations_recherche.clear()

    def validate_joke(self, client=None, score=2, previous_token=None):
        client = client or self.client
        headers = {"Authorization": "Bearer " + previous_token} if previous_token else {}
        with patch.object(api, "evaluate_joke", new=AsyncMock(return_value=judges(score))):
            response = client.post("/analyse", json={"texte": "Une blague"}, headers=headers)
        self.assertEqual(response.status_code, 200)
        return response.json()["rechercheToken"]

    def start_search(self, token, client=None):
        client = client or self.client
        headers = {"Authorization": "Bearer " + token}
        self.assertEqual(client.post("/api/recherche/demarrer", headers=headers).status_code, 200)
        return headers

    def test_site_and_assets_are_served(self):
        for path in ("/", "/css/style.css", "/src/script.js",
                     "/src/images/bg-img.png", "/src/images/background-gate.png"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_analysis_calls_ai_and_opens_only_for_bad_joke(self):
        for score, opened in ((0, True), (3.9, True), (4, False), (8, False)):
            with self.subTest(score=score), patch.object(
                api, "evaluate_joke", new=AsyncMock(return_value=judges(score))
            ) as evaluate:
                response = self.client.post("/analyse", json={"texte": " Une blague "})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["portailOuvert"], opened)
                self.assertEqual(response.json()["score"], score)
                self.assertEqual(response.json()["confidence"], 0.8)
                self.assertEqual(bool(response.json()["rechercheToken"]), opened)
                evaluate.assert_awaited_once_with("Une blague")

    def test_ai_routes_are_available_on_same_server_and_standalone(self):
        for application in (server.app, api.app):
            with patch.object(api, "evaluate_joke", new=AsyncMock(return_value=judges(5))):
                client = TestClient(application)
                self.assertEqual(client.get("/api/health").status_code, 200)
                self.assertEqual(client.post("/api/jokes/evaluate",
                                            json={"text": "Test"}).status_code, 200)

    def test_invalid_text_is_rejected_before_calling_ai(self):
        with patch.object(api, "evaluate_joke", new=AsyncMock()) as evaluate:
            for text in ("", "   ", "x" * 5001):
                self.assertEqual(self.client.post("/analyse", json={"texte": text}).status_code, 422)
            evaluate.assert_not_awaited()

    def test_ai_failures_are_actionable(self):
        for error, status in ((httpx.ConnectError("offline"), 503),
                              (httpx.ReadTimeout("slow"), 504),
                              (ValueError("bad JSON"), 502)):
            with self.subTest(status=status), patch.object(
                api, "evaluate_joke", new=AsyncMock(side_effect=error)
            ):
                response = self.client.post("/analyse", json={"texte": "Une blague"})
                self.assertEqual(response.status_code, status)
                self.assertIsInstance(response.json()["detail"], str)

    def test_sensor_validation_and_expiration(self):
        with patch.object(server, "monotonic", return_value=100):
            headers = self.start_search(self.validate_joke())
            self.assertEqual(self.client.get("/api/capteurs", headers=headers).json(),
                             {"direction": "aucune", "connecte": False})
            for payload in ({}, {"direction": "haut"}, {"direction": None}):
                self.assertEqual(self.client.post("/api/capteurs", json=payload).status_code, 422)
            self.assertEqual(self.client.post("/api/capteurs",
                                             json={"direction": "nord"}).status_code, 200)
            self.assertEqual(self.client.get("/api/capteurs", headers=headers).json(),
                             {"direction": "nord", "connecte": True})
        with patch.object(server, "monotonic", return_value=111):
            self.assertEqual(self.client.get("/api/capteurs", headers=headers).json(),
                             {"direction": "aucune", "connecte": False})

    def test_direction_requires_validation_and_active_search_on_both_routes(self):
        self.client.post("/api/capteurs", json={"direction": "nord"})
        for path in ("/api/capteurs", "/detector"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 403)
            self.assertNotIn("direction", response.json())
        self.assertEqual(self.client.post("/api/recherche/demarrer").status_code, 403)
        token = self.validate_joke()
        headers = {"Authorization": "Bearer " + token}
        for path in ("/api/capteurs", "/detector"):
            self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
        self.start_search(token)
        for path in ("/api/capteurs", "/detector"):
            self.assertEqual(self.client.get(path, headers=headers).json()["direction"], "nord")

    def test_rejected_joke_does_not_grant_access(self):
        self.assertIsNone(self.validate_joke(score=8))
        self.assertEqual(self.client.get("/api/capteurs").status_code, 403)
        self.assertEqual(self.client.post("/api/recherche/demarrer",
                         headers={"Authorization": "Bearer invented"}).status_code, 403)

    def test_stop_revokes_access_and_cannot_restart_without_new_validation(self):
        token = self.validate_joke()
        headers = self.start_search(token)
        self.assertEqual(self.client.delete("/api/recherche", headers=headers).status_code, 204)
        self.assertEqual(self.client.get("/api/capteurs", headers=headers).status_code, 403)
        self.assertEqual(self.client.post("/api/recherche/demarrer", headers=headers).status_code, 403)
        self.start_search(self.validate_joke())

    def test_authorization_is_independent_for_each_player(self):
        first_headers = self.start_search(self.validate_joke())
        other = TestClient(server.app)
        self.assertEqual(other.get("/api/capteurs").status_code, 403)
        second_headers = self.start_search(self.validate_joke(client=other), client=other)
        self.client.delete("/api/recherche", headers=first_headers)
        self.assertEqual(other.get("/api/capteurs", headers=second_headers).status_code, 200)

    def test_expired_validation_cannot_read_direction(self):
        with patch.object(server, "monotonic", return_value=100):
            headers = self.start_search(self.validate_joke())
        with patch.object(server, "monotonic", return_value=100 + server.DUREE_VALIDATION):
            self.assertEqual(self.client.get("/api/capteurs", headers=headers).status_code, 403)

    def test_new_analysis_revokes_previous_authorization_even_if_llm_fails(self):
        token = self.validate_joke()
        headers = self.start_search(token)
        with patch.object(api, "evaluate_joke", new=AsyncMock(side_effect=httpx.ConnectError("offline"))):
            response = self.client.post("/analyse", json={"texte": "Nouvelle blague"}, headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.get("/api/capteurs", headers=headers).status_code, 403)


if __name__ == "__main__":
    unittest.main()
