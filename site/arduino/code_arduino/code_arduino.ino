
#define TRIG_NORD 12
#define ECHO_NORD 13
#define TRIG_SUD 2
#define ECHO_SUD 3
#define TRIG_EST 10
#define ECHO_EST 11
#define TRIG_OUEST 6
#define ECHO_OUEST 7

void setup() {
  Serial.begin(9600);

  pinMode(TRIG_NORD, OUTPUT);
  pinMode(ECHO_NORD, INPUT);
  pinMode(TRIG_SUD, OUTPUT);
  pinMode(ECHO_SUD, INPUT);
  pinMode(TRIG_EST, OUTPUT);
  pinMode(ECHO_EST, INPUT);
  pinMode(TRIG_OUEST, OUTPUT);
  pinMode(ECHO_OUEST, INPUT);
}

long mesurerDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duree = pulseIn(echoPin, HIGH, 30000);
  long distance = duree * 0.034 / 2;
  return distance;
}

void loop() {
  long dNord = mesurerDistance(TRIG_NORD, ECHO_NORD);
  long dSud = mesurerDistance(TRIG_SUD, ECHO_SUD);
  long dEst = mesurerDistance(TRIG_EST, ECHO_EST);
  long dOuest = mesurerDistance(TRIG_OUEST, ECHO_OUEST);

  Serial.print(dNord);
  Serial.print(",");
  Serial.print(dSud);
  Serial.print(",");
  Serial.print(dEst);
  Serial.print(",");
  Serial.println(dOuest);

  delay(100);
}