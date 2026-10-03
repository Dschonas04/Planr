package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func einzelplatzServer(t *testing.T) (*server, http.Handler) {
	t.Helper()
	s, err := neuerServer(config{port: "4711", daten: t.TempDir(), static: t.TempDir(), sitzungTage: 14})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.einzelplatzEinrichten("geheim"); err != nil {
		t.Fatal(err)
	}
	return s, s.routen()
}

func anfrage(h http.Handler, methode, pfad, host, cookie, rumpf string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(methode, pfad, strings.NewReader(rumpf))
	r.Host = host
	r.Header.Set("X-Requested-With", "planr")
	if rumpf != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != "" {
		r.AddCookie(&http.Cookie{Name: lokalCookie, Value: cookie})
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestEinzelplatzStartSetztCookie(t *testing.T) {
	_, h := einzelplatzServer(t)
	w := anfrage(h, http.MethodGet, "/lokal/start?s=geheim", "127.0.0.1:4711", "", "")
	if w.Code != http.StatusSeeOther {
		t.Fatalf("Start ergab %d", w.Code)
	}
	if !strings.Contains(w.Header().Get("Set-Cookie"), lokalCookie+"=geheim") {
		t.Errorf("kein Cookie: %q", w.Header().Get("Set-Cookie"))
	}
	if w := anfrage(h, http.MethodGet, "/lokal/start?s=falsch", "127.0.0.1:4711", "", ""); w.Code != http.StatusForbidden {
		t.Errorf("falscher Schluessel ergab %d", w.Code)
	}
}

func TestEinzelplatzNurMitSchluesselUndLoopback(t *testing.T) {
	_, h := einzelplatzServer(t)
	plan := `{"name":"Haus","plan":` + beispielPlan + `}`

	if w := anfrage(h, http.MethodPost, "/api/projects", "127.0.0.1:4711", "", plan); w.Code != http.StatusUnauthorized {
		t.Errorf("ohne Schluessel: %d", w.Code)
	}
	if w := anfrage(h, http.MethodPost, "/api/projects", "127.0.0.1:4711", "falsch", plan); w.Code != http.StatusUnauthorized {
		t.Errorf("falscher Schluessel: %d", w.Code)
	}
	// DNS-Rebinding: fremder Hostname auf die Loopback-Adresse.
	if w := anfrage(h, http.MethodGet, "/api/status", "boese.example:4711", "geheim", ""); w.Code != http.StatusMisdirectedRequest {
		t.Errorf("fremder Host: %d", w.Code)
	}
	w := anfrage(h, http.MethodPost, "/api/projects", "127.0.0.1:4711", "geheim", plan)
	if w.Code != http.StatusCreated {
		t.Fatalf("mit Schluessel: %d %s", w.Code, w.Body.String())
	}

	w = anfrage(h, http.MethodGet, "/api/status", "localhost:4711", "geheim", "")
	var st map[string]any
	json.Unmarshal(w.Body.Bytes(), &st)
	if st["desktop"] != true || st["konto"] == nil {
		t.Errorf("Status ohne Desktop/Konto: %s", w.Body.String())
	}
}

func TestEinzelplatzKontoBleibtBeimNeustart(t *testing.T) {
	dir := t.TempDir()
	a, _ := neuerServer(config{daten: dir, static: dir, sitzungTage: 14})
	a.einzelplatzEinrichten("")
	b, _ := neuerServer(config{daten: dir, static: dir, sitzungTage: 14})
	b.einzelplatzEinrichten("")
	if a.lokal.konto.ID != b.lokal.konto.ID {
		t.Errorf("neues Konto beim Neustart: %s != %s", a.lokal.konto.ID, b.lokal.konto.ID)
	}
	if b.konten.Anzahl() != 1 {
		t.Errorf("%d Konten statt 1", b.konten.Anzahl())
	}
}

func TestDesktopSpeichernUndOeffnen(t *testing.T) {
	_, h := einzelplatzServer(t)
	ziel := t.TempDir()
	t.Setenv("PLANR_DIALOG_VERZ", ziel)
	// Groesser als die 64 KB, die lies() sonst zulaesst.
	inhalt := base64.StdEncoding.EncodeToString([]byte("%PDF-1.4 test" + strings.Repeat(" ", 200000)))
	w := anfrage(h, http.MethodPost, "/api/desktop/speichern", "127.0.0.1:4711", "geheim", `{"name":"../../Plan EG.pdf","inhalt":"`+inhalt+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("Speichern: %d %s", w.Code, w.Body.String())
	}
	// Der Name darf nicht aus dem gewaehlten Verzeichnis herausfuehren.
	daten, err := os.ReadFile(filepath.Join(ziel, "Plan EG.pdf"))
	if err != nil || !strings.HasPrefix(string(daten), "%PDF-1.4 test") || len(daten) != 200013 {
		t.Fatalf("Datei nicht wie erwartet: %v %q", err, daten)
	}

	t.Setenv("PLANR_DIALOG_OEFFNEN", filepath.Join(ziel, "Plan EG.pdf"))
	w = anfrage(h, http.MethodPost, "/api/desktop/oeffnen", "127.0.0.1:4711", "geheim", "{}")
	var res struct{ Name, Inhalt string }
	json.Unmarshal(w.Body.Bytes(), &res)
	if res.Name != "Plan EG.pdf" || res.Inhalt != inhalt {
		t.Errorf("Oeffnen lieferte %+v", res)
	}

	if w := anfrage(h, http.MethodPost, "/api/desktop/speichern", "127.0.0.1:4711", "", `{"name":"x","inhalt":""}`); w.Code != http.StatusNotFound {
		t.Errorf("ohne Schluessel speichern: %d", w.Code)
	}
}
