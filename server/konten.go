package main

// Konten und Sitzungen.
//
// Bis zur Fassung 0.x konnte jeder, der den Dienst erreichte, jedes Projekt
// auflisten, ueberschreiben und loeschen. Fuer den Einsatz in einer Firma ist
// das ausgeschlossen: Projekte gehoeren jetzt einem Konto, und wer keines hat,
// sieht nur, was ihm ueber einen Freigabe-Link gezeigt wird.
//
// Gespeichert wird wie bei den Projekten in Dateien, nicht in einer Datenbank.
// Zwei Dinge sind dabei anders als dort:
//
//   - Die Dateien werden mit 0600 geschrieben. Sie enthalten Passwort-Hashes
//     und Sitzungen, die gehen niemanden auf dem Rechner etwas an.
//   - Von einer Sitzung wird nur der SHA-256 des Tokens abgelegt. Wer die
//     Datei in die Haende bekommt, kann damit keine Sitzung uebernehmen.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/mail"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	RolleAdmin  = "admin"
	RolleNutzer = "nutzer"

	minPasswortLaenge = 10
	maxPasswortLaenge = 72 // bcrypt liest nicht mehr als 72 Bytes
)

var (
	ErrEmailUngueltig = errors.New("Die E-Mail-Adresse ist ungültig.")
	ErrEmailVergeben  = errors.New("Für diese E-Mail-Adresse gibt es bereits ein Konto.")
	ErrPasswortKurz   = errors.New("Das Passwort braucht mindestens 10 Zeichen.")
	ErrPasswortLang   = errors.New("Das Passwort darf höchstens 72 Bytes lang sein.")
	ErrAnmeldung      = errors.New("E-Mail-Adresse oder Passwort stimmen nicht.")
	ErrKontoUnbekannt = errors.New("Konto unbekannt.")
	ErrLetzterAdmin   = errors.New("Das ist das letzte Administratorkonto. Lege zuerst ein weiteres an.")
	ErrKontoGesperrt  = errors.New("Dieses Konto ist gesperrt.")
	ErrRolleUnbekannt = errors.New("Unbekannte Rolle.")
	ErrPasswortFalsch = errors.New("Das bisherige Passwort stimmt nicht.")
)

type Konto struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Hash     string `json:"hash"`
	Rolle    string `json:"rolle"`
	Gesperrt bool   `json:"gesperrt"`
	Angelegt int64  `json:"angelegt"`
}

// Oeffentlich ist die Sicht auf ein Konto, die das Netz verlassen darf.
type KontoSicht struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Rolle    string `json:"rolle"`
	Gesperrt bool   `json:"gesperrt"`
	Angelegt int64  `json:"angelegt"`
}

func (k *Konto) Sicht() KontoSicht {
	return KontoSicht{ID: k.ID, Email: k.Email, Name: k.Name, Rolle: k.Rolle, Gesperrt: k.Gesperrt, Angelegt: k.Angelegt}
}

type sitzung struct {
	Konto  string `json:"konto"`
	Ablauf int64  `json:"ablauf"`
}

type Konten struct {
	mu        sync.Mutex
	dir       string
	dauer     time.Duration
	konten    map[string]*Konto
	sitzungen map[string]*sitzung // Schluessel: SHA-256 des Tokens
	// attrappe ist ein gueltiger bcrypt-Hash. Gegen ihn wird geprueft, wenn
	// es die E-Mail-Adresse nicht gibt -- sonst verraet die Antwortzeit, ob
	// ein Konto existiert.
	attrappe []byte
}

func NeueKonten(dir string, dauer time.Duration) (*Konten, error) {
	k := &Konten{dir: dir, dauer: dauer, konten: map[string]*Konto{}, sitzungen: map[string]*sitzung{}}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if raw, err := os.ReadFile(k.kontenDatei()); err == nil {
		var liste []*Konto
		if err := json.Unmarshal(raw, &liste); err != nil {
			return nil, err
		}
		for _, konto := range liste {
			if konto != nil && konto.ID != "" {
				k.konten[konto.ID] = konto
			}
		}
	}
	if raw, err := os.ReadFile(k.sitzungsDatei()); err == nil {
		_ = json.Unmarshal(raw, &k.sitzungen)
		if k.sitzungen == nil {
			k.sitzungen = map[string]*sitzung{}
		}
	}
	k.attrappe, _ = bcrypt.GenerateFromPassword([]byte("attrappe-ohne-bedeutung"), bcrypt.DefaultCost)
	return k, nil
}

func (k *Konten) kontenDatei() string   { return filepath.Join(k.dir, "konten.json") }
func (k *Konten) sitzungsDatei() string { return filepath.Join(k.dir, "sitzungen.json") }

func writePrivate(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Der Aufrufer haelt k.mu.
func (k *Konten) speichernKonten() {
	liste := make([]*Konto, 0, len(k.konten))
	for _, konto := range k.konten {
		liste = append(liste, konto)
	}
	sort.Slice(liste, func(i, j int) bool { return liste[i].Angelegt < liste[j].Angelegt })
	raw, _ := json.MarshalIndent(liste, "", "  ")
	if err := writePrivate(k.kontenDatei(), raw); err != nil {
		logf("Konten konnten nicht geschrieben werden: %v", err)
	}
}

// Der Aufrufer haelt k.mu.
func (k *Konten) speichernSitzungen() {
	raw, _ := json.Marshal(k.sitzungen)
	if err := writePrivate(k.sitzungsDatei(), raw); err != nil {
		logf("Sitzungen konnten nicht geschrieben werden: %v", err)
	}
}

func zufall(n int) string {
	buf := make([]byte, n)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func normEmail(email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	adresse, err := mail.ParseAddress(email)
	if err != nil || adresse.Address != email || len(email) > 254 {
		return "", ErrEmailUngueltig
	}
	return email, nil
}

func pruefePasswort(passwort string) error {
	if len([]rune(passwort)) < minPasswortLaenge {
		return ErrPasswortKurz
	}
	if len(passwort) > maxPasswortLaenge {
		return ErrPasswortLang
	}
	return nil
}

func kontoName(name, email string) string {
	name = saubererName(name)
	if name == "" {
		name = saubererName(strings.SplitN(email, "@", 2)[0])
	}
	return name
}

func (k *Konten) Anzahl() int {
	k.mu.Lock()
	defer k.mu.Unlock()
	return len(k.konten)
}

// adminAnzahl zaehlt nicht gesperrte Administratoren. Der Aufrufer haelt k.mu.
func (k *Konten) adminAnzahl() int {
	n := 0
	for _, konto := range k.konten {
		if konto.Rolle == RolleAdmin && !konto.Gesperrt {
			n++
		}
	}
	return n
}

// Anlegen legt ein Konto an. Das allererste wird immer Administrator, egal was
// verlangt war -- sonst gaebe es niemanden, der weitere Konten anlegen kann.
func (k *Konten) Anlegen(email, name, passwort, rolle string) (*Konto, error) {
	email, err := normEmail(email)
	if err != nil {
		return nil, err
	}
	if err := pruefePasswort(passwort); err != nil {
		return nil, err
	}
	if rolle != RolleAdmin && rolle != RolleNutzer {
		return nil, ErrRolleUnbekannt
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(passwort), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	k.mu.Lock()
	defer k.mu.Unlock()
	for _, konto := range k.konten {
		if konto.Email == email {
			return nil, ErrEmailVergeben
		}
	}
	if len(k.konten) == 0 {
		rolle = RolleAdmin
	}
	konto := &Konto{
		ID: zufall(12), Email: email, Name: kontoName(name, email), Hash: string(hash),
		Rolle: rolle, Angelegt: time.Now().UnixMilli(),
	}
	k.konten[konto.ID] = konto
	k.speichernKonten()
	kopie := *konto
	return &kopie, nil
}

// Pruefen meldet das Konto zu E-Mail und Passwort. Gesperrte Konten melden
// denselben Fehler wie ein falsches Passwort erst, nachdem das Passwort
// stimmte -- sonst liesse sich die Sperre von aussen erkennen.
func (k *Konten) Pruefen(email, passwort string) (*Konto, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	k.mu.Lock()
	var gefunden *Konto
	for _, konto := range k.konten {
		if konto.Email == email {
			kopie := *konto
			gefunden = &kopie
			break
		}
	}
	k.mu.Unlock()

	if gefunden == nil {
		bcrypt.CompareHashAndPassword(k.attrappe, []byte(passwort))
		return nil, ErrAnmeldung
	}
	if bcrypt.CompareHashAndPassword([]byte(gefunden.Hash), []byte(passwort)) != nil {
		return nil, ErrAnmeldung
	}
	if gefunden.Gesperrt {
		return nil, ErrKontoGesperrt
	}
	return gefunden, nil
}

func (k *Konten) Konto(id string) (*Konto, bool) {
	k.mu.Lock()
	defer k.mu.Unlock()
	konto, ok := k.konten[id]
	if !ok {
		return nil, false
	}
	kopie := *konto
	return &kopie, true
}

func (k *Konten) Liste() []KontoSicht {
	k.mu.Lock()
	defer k.mu.Unlock()
	out := make([]KontoSicht, 0, len(k.konten))
	for _, konto := range k.konten {
		out = append(out, konto.Sicht())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Angelegt < out[j].Angelegt })
	return out
}

// SitzungAnlegen gibt das Token zurueck, das in den Cookie gehoert.
func (k *Konten) SitzungAnlegen(kontoID string) string {
	token := zufall(32)
	k.mu.Lock()
	defer k.mu.Unlock()
	k.aufraeumen()
	k.sitzungen[tokenHash(token)] = &sitzung{Konto: kontoID, Ablauf: time.Now().Add(k.dauer).UnixMilli()}
	k.speichernSitzungen()
	return token
}

// SitzungKonto liefert das Konto zu einem Cookie-Token. Eine Sitzung, die mehr
// als die Haelfte ihrer Laufzeit hinter sich hat, wird verlaengert -- wer
// regelmaessig arbeitet, wird nicht mitten in der Woche abgemeldet.
func (k *Konten) SitzungKonto(token string) (*Konto, bool) {
	if token == "" {
		return nil, false
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	h := tokenHash(token)
	s, ok := k.sitzungen[h]
	if !ok {
		return nil, false
	}
	jetzt := time.Now()
	if jetzt.UnixMilli() > s.Ablauf {
		delete(k.sitzungen, h)
		k.speichernSitzungen()
		return nil, false
	}
	konto, ok := k.konten[s.Konto]
	if !ok || konto.Gesperrt {
		delete(k.sitzungen, h)
		k.speichernSitzungen()
		return nil, false
	}
	if time.UnixMilli(s.Ablauf).Sub(jetzt) < k.dauer/2 {
		s.Ablauf = jetzt.Add(k.dauer).UnixMilli()
		k.speichernSitzungen()
	}
	kopie := *konto
	return &kopie, true
}

func (k *Konten) SitzungBeenden(token string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.sitzungen, tokenHash(token))
	k.speichernSitzungen()
}

// Der Aufrufer haelt k.mu.
func (k *Konten) sitzungenBeenden(kontoID string) {
	for h, s := range k.sitzungen {
		if s.Konto == kontoID {
			delete(k.sitzungen, h)
		}
	}
	k.speichernSitzungen()
}

// Der Aufrufer haelt k.mu.
func (k *Konten) aufraeumen() {
	jetzt := time.Now().UnixMilli()
	for h, s := range k.sitzungen {
		if jetzt > s.Ablauf {
			delete(k.sitzungen, h)
		}
	}
}

func (k *Konten) NameSetzen(id, name string) (*Konto, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	konto, ok := k.konten[id]
	if !ok {
		return nil, ErrKontoUnbekannt
	}
	konto.Name = kontoName(name, konto.Email)
	k.speichernKonten()
	kopie := *konto
	return &kopie, nil
}

// PasswortAendern verlangt das bisherige Passwort. Alle anderen Sitzungen des
// Kontos enden damit -- wer das Passwort aendert, weil es bekannt geworden
// ist, will genau das.
func (k *Konten) PasswortAendern(id, alt, neu, behalteToken string) error {
	k.mu.Lock()
	konto, ok := k.konten[id]
	if !ok {
		k.mu.Unlock()
		return ErrKontoUnbekannt
	}
	hash := konto.Hash
	k.mu.Unlock()
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(alt)) != nil {
		return ErrPasswortFalsch
	}
	return k.passwortSetzen(id, neu, behalteToken)
}

// PasswortSetzen ist der Weg fuer Administratoren: ohne das alte Passwort,
// und alle Sitzungen des Kontos enden.
func (k *Konten) PasswortSetzen(id, neu string) error {
	return k.passwortSetzen(id, neu, "")
}

func (k *Konten) passwortSetzen(id, neu, behalteToken string) error {
	if err := pruefePasswort(neu); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(neu), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	konto, ok := k.konten[id]
	if !ok {
		return ErrKontoUnbekannt
	}
	konto.Hash = string(hash)
	behalte := ""
	if behalteToken != "" {
		behalte = tokenHash(behalteToken)
	}
	for h, s := range k.sitzungen {
		if s.Konto == id && h != behalte {
			delete(k.sitzungen, h)
		}
	}
	k.speichernKonten()
	k.speichernSitzungen()
	return nil
}

// Aendern ist die Verwaltung durch Administratoren: Rolle und Sperre. Das
// letzte aktive Administratorkonto laesst sich weder herabstufen noch sperren.
func (k *Konten) Aendern(id string, rolle *string, gesperrt *bool) (*Konto, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	konto, ok := k.konten[id]
	if !ok {
		return nil, ErrKontoUnbekannt
	}
	vorher := *konto
	if rolle != nil {
		if *rolle != RolleAdmin && *rolle != RolleNutzer {
			return nil, ErrRolleUnbekannt
		}
		konto.Rolle = *rolle
	}
	if gesperrt != nil {
		konto.Gesperrt = *gesperrt
	}
	if vorher.Rolle == RolleAdmin && !vorher.Gesperrt && k.adminAnzahl() == 0 {
		*konto = vorher
		return nil, ErrLetzterAdmin
	}
	if konto.Gesperrt {
		k.sitzungenBeenden(id)
	}
	k.speichernKonten()
	kopie := *konto
	return &kopie, nil
}

func (k *Konten) Loeschen(id string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	konto, ok := k.konten[id]
	if !ok {
		return ErrKontoUnbekannt
	}
	if konto.Rolle == RolleAdmin && !konto.Gesperrt && k.adminAnzahl() == 1 && len(k.konten) > 1 {
		return ErrLetzterAdmin
	}
	delete(k.konten, id)
	k.sitzungenBeenden(id)
	k.speichernKonten()
	return nil
}

// saubererName macht aus einer Eingabe einen anzeigbaren Namen: ohne
// Steuerzeichen, hoechstens 40 Zeichen, gekuerzt nach Runen.
func saubererName(roh string) string {
	gefiltert := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, strings.TrimSpace(roh))
	runen := []rune(gefiltert)
	if len(runen) > 40 {
		runen = runen[:40]
	}
	return strings.TrimSpace(string(runen))
}
