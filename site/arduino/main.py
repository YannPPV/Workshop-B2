import argparse
import math
import os
import time

import requests
import serial

SERIAL_PORT = os.environ.get("SERIAL_PORT", "COM3")
BAUDRATE = 9600
SEUIL_CM = 30
DIRECTIONS = ["nord", "sud", "est", "ouest"]
URL_API = os.environ.get("CAPTEURS_URL", "http://127.0.0.1:8000/api/capteurs")
INTERVALLE_RENVOI = 2.0

derniere_direction = None
dernier_envoi = None
derniere_tentative = None
envoi_en_echec = False


def calculer_direction(distances):
    if len(distances) != 4 or not all(math.isfinite(d) and d >= 0 for d in distances):
        raise ValueError("Quatre distances positives ou nulles sont attendues.")
    d_min = SEUIL_CM
    direction = "aucune"
    for i, distance in enumerate(distances):
        if 0 < distance <= d_min:
            d_min = distance
            direction = DIRECTIONS[i]
    return direction


def changement_direction(distances):
    direction = calculer_direction(distances)
    return direction if direction != derniere_direction else None


def envoyer_direction(direction):
    global derniere_direction, dernier_envoi, derniere_tentative, envoi_en_echec
    derniere_tentative = time.monotonic()
    try:
        response = requests.post(URL_API, json={"direction": direction}, timeout=2)
        response.raise_for_status()
    except requests.exceptions.RequestException as error:
        envoi_en_echec = True
        print(f"[api] erreur d'envoi : {error}")
        return False
    envoi_en_echec = False
    derniere_direction = direction
    dernier_envoi = time.monotonic()
    return True


def traiter_distances(distances):
    direction = calculer_direction(distances)
    maintenant = time.monotonic()
    if (
        envoi_en_echec and derniere_tentative is not None
        and maintenant - derniere_tentative < INTERVALLE_RENVOI
    ):
        return False
    # Chaque changement est transmis, même un passage de 31 à 30 cm.
    # Le renvoi périodique maintient les mesures valides pendant la recherche.
    if (
        direction != derniere_direction or dernier_envoi is None
        or maintenant - dernier_envoi >= INTERVALLE_RENVOI
    ):
        return envoyer_direction(direction)
    return False


def lire_serie(port=SERIAL_PORT):
    try:
        with serial.Serial(port, BAUDRATE, timeout=1) as ser:
            time.sleep(2)
            print(f"[série] port {port} ouvert, en écoute…")
            while True:
                ligne = ser.readline().decode("utf-8", errors="ignore").strip()
                valeurs = ligne.split(",")
                if len(valeurs) != 4:
                    continue
                try:
                    distances = [float(valeur) for valeur in valeurs]
                    traiter_distances(distances)
                except ValueError:
                    continue
    except serial.SerialException as error:
        print(f"[série] impossible de lire {port} : {error}")
        return 1
    except KeyboardInterrupt:
        print("\n[série] lecture arrêtée.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transmettre les capteurs Arduino au site.")
    parser.add_argument("--port", default=SERIAL_PORT, help="Port de l'Arduino, par exemple COM3.")
    arguments = parser.parse_args()
    raise SystemExit(lire_serie(arguments.port))
