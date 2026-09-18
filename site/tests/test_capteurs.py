import importlib
import unittest
from unittest.mock import Mock, patch

import requests

sensor = importlib.import_module("arduino.main")


class SensorTests(unittest.TestCase):
    def setUp(self):
        sensor.derniere_direction = None
        sensor.dernier_envoi = None
        sensor.derniere_tentative = None
        sensor.envoi_en_echec = False

    def test_crossing_threshold_is_sent_even_below_ten_percent(self):
        with patch.object(sensor.requests, "post", return_value=Mock()) as post:
            for distance in (31, 30, 31):
                self.assertTrue(sensor.traiter_distances([distance, 100, 100, 100]))
            self.assertEqual(
                [call.kwargs["json"]["direction"] for call in post.call_args_list],
                ["aucune", "nord", "aucune"],
            )

    def test_four_directions_and_no_echo(self):
        for index, direction in enumerate(sensor.DIRECTIONS):
            distances = [100, 100, 100, 100]
            distances[index] = 20
            self.assertEqual(sensor.calculer_direction(distances), direction)
        self.assertEqual(sensor.calculer_direction([0, 0, 0, 0]), "aucune")

    def test_connection_failure_is_retried_with_latest_measurement(self):
        with patch.object(sensor.requests, "post",
                          side_effect=[requests.ConnectionError("offline"), Mock()]) as post:
            with patch.object(sensor.time, "monotonic", return_value=10):
                self.assertFalse(sensor.traiter_distances([20, 100, 100, 100]))
                self.assertIsNone(sensor.derniere_direction)
            with patch.object(sensor.time, "monotonic", return_value=11):
                self.assertFalse(sensor.traiter_distances([100, 20, 100, 100]))
            with patch.object(sensor.time, "monotonic", return_value=12):
                self.assertTrue(sensor.traiter_distances([100, 20, 100, 100]))
            self.assertEqual(post.call_count, 2)
            self.assertEqual(sensor.derniere_direction, "sud")

    def test_http_error_does_not_acknowledge_direction(self):
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError("HTTP 500")
        with patch.object(sensor.requests, "post", return_value=response):
            self.assertFalse(sensor.envoyer_direction("nord"))
            self.assertIsNone(sensor.derniere_direction)

    def test_unchanged_direction_is_periodically_resent(self):
        with patch.object(sensor.requests, "post", return_value=Mock()) as post:
            for instant, expected in ((10, True), (11, False), (12, True)):
                with patch.object(sensor.time, "monotonic", return_value=instant):
                    self.assertEqual(sensor.traiter_distances([20, 100, 100, 100]), expected)
            self.assertEqual(post.call_count, 2)

    def test_invalid_measurements_are_rejected(self):
        for distances in ([1, 2], [float("nan"), 1, 2, 3],
                          [float("inf"), 1, 2, 3], [-1, 1, 2, 3]):
            with self.assertRaises(ValueError):
                sensor.calculer_direction(distances)


if __name__ == "__main__":
    unittest.main()
