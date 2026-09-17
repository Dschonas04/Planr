package main

// Zugriffsschutz gegen den vollstaendigen Handler mit Schutzschicht und
// Sitzung, so wie ein Browser ihn sieht.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
)

type browser struct {
	t    *testing.T
	base string
	c    *http.Client
}

func vollServer(t *testing.T, offen bool) (*server, *httptest.Server) {
	t.Helper()
	s, err := neuerServer(config{daten: t.TempDir(), static: t.TempDir(), sitzungTage: 14, registrierungOffen: offen})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routen())
	t.Cleanup(ts.Close)
	return s, ts
}

func neuerBrowser(t *testing.T, ts *httptest.Server) *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{t: t, base: ts.URL, c: &http.Client{Jar: jar}}
}

func (b *browser) rufe(methode, pfad, rumpf string, kennung bool) (int, string) {
	b.t.Helper()
	req, _ := http.NewRequest(methode, b.base+pfad, strings.NewReader(rumpf))
	req.Header.Set("Content-Type", "application/json")
	if kennung {
		req.Header.Set(csrfKopf, "planr")
	}
	res, err := b.c.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer res.Body.Close()
	var buf bytes.Buffer
	buf.ReadFrom(res.Body)
	return res.StatusCode, buf.String()
}

func (b *browser) registrieren(email string) int {
	code, _ := b.rufe("POST", "/api/registrierung", `{"email":"`+email+`","passwort":"sehr-geheim-1"}`, true)
	return code
}

func TestOhneAnmeldungKeineProjekte(t *testing.T) {
	s, ts := vollServer(t, false)
	s.store.Create("geheim", "irgendwer", json.RawMessage(beispielPlan))
	b := neuerBrowser(t, ts)
	for _, pfad := range []string{"/api/projects", "/api/import", "/api/validate"} {
		methode := "GET"
		if pfad != "/api/projects" {
			methode = "POST"
		}
		if code, _ := b.rufe(methode, pfad, beispielPlan, true); code != http.StatusUnauthorized {
			t.Errorf("%s %s ohne Anmeldung: %d, erwartet 401", methode, pfad, code)
		}
	}
}

func TestErstesKontoUebernimmtAlteProjekte(t *testing.T) {
	s, ts := vollServer(t, false)
	alt, _ := s.store.Create("vor den Konten", "", json.RawMessage(beispielPlan))
	b := neuerBrowser(t, ts)
	if code := b.registrieren("chefin@example.org"); code != http.StatusCreated {
		t.Fatalf("Einrichtung: %d", code)
	}
	_, liste := b.rufe("GET", "/api/projects", "", false)
	if !strings.Contains(liste, alt.ID) {
		t.Errorf("altes Projekt nicht beim ersten Konto: %s", liste)
	}
	if code := neuerBrowser(t, ts).registrieren("fremd@example.org"); code != http.StatusForbidden {
		t.Errorf("zweite Registrierung bei geschlossener Registrierung: %d, erwartet 403", code)
	}
}

func TestKontenSehenNurEigeneProjekte(t *testing.T) {
	_, ts := vollServer(t, true)
	neuerBrowser(t, ts).registrieren("chefin@example.org")
	anna := neuerBrowser(t, ts)
	anna.registrieren("anna@example.org")
	bert := neuerBrowser(t, ts)
	bert.registrieren("bert@example.org")

	code, antwort := anna.rufe("POST", "/api/projects", `{"name":"Annas Haus","plan":`+beispielPlan+`}`, true)
	if code != http.StatusCreated {
		t.Fatalf("Anlegen: %d %s", code, antwort)
	}
	var meta struct{ ID string }
	json.Unmarshal([]byte(antwort), &meta)

	if _, liste := bert.rufe("GET", "/api/projects", "", false); strings.Contains(liste, meta.ID) {
		t.Error("Bert sieht Annas Projekt in der Liste")
	}
	for _, fall := range [][2]string{{"GET", ""}, {"DELETE", ""}, {"GET", "/svg"}, {"POST", "/share"}} {
		if code, _ := bert.rufe(fall[0], "/api/projects/"+meta.ID+fall[1], "", true); code != http.StatusNotFound {
			t.Errorf("Bert %s %s: %d, erwartet 404", fall[0], fall[1], code)
		}
	}
	if code, _ := bert.rufe("PUT", "/api/projects/"+meta.ID, `{"name":"übernommen","plan":`+beispielPlan+`}`, true); code != http.StatusNotFound {
		t.Errorf("Bert überschreibt Annas Projekt: %d, erwartet 404", code)
	}
}

func TestAendernOhneKennungAbgelehnt(t *testing.T) {
	_, ts := vollServer(t, false)
	b := neuerBrowser(t, ts)
	b.registrieren("chefin@example.org")
	if code, _ := b.rufe("POST", "/api/projects", `{"name":"x","plan":`+beispielPlan+`}`, false); code != http.StatusForbidden {
		t.Errorf("POST ohne X-Requested-With: %d, erwartet 403", code)
	}
}

func TestGeteilterGrundrissOhneAnmeldungLesbar(t *testing.T) {
	_, ts := vollServer(t, false)
	eigen := neuerBrowser(t, ts)
	eigen.registrieren("chefin@example.org")
	_, antwort := eigen.rufe("POST", "/api/projects", `{"name":"Zum Zeigen","plan":`+beispielPlan+`}`, true)
	var meta struct{ ID string }
	json.Unmarshal([]byte(antwort), &meta)
	_, freigabe := eigen.rufe("POST", "/api/projects/"+meta.ID+"/share", "", true)
	var f struct{ Token string }
	json.Unmarshal([]byte(freigabe), &f)

	gast := neuerBrowser(t, ts)
	code, geteilt := gast.rufe("GET", "/api/shared/"+f.Token, "", false)
	if code != http.StatusOK || !strings.Contains(geteilt, "Zum Zeigen") {
		t.Fatalf("geteilter Grundriss: %d %s", code, geteilt)
	}
	if strings.Contains(geteilt, meta.ID) || strings.Contains(geteilt, "owner") {
		t.Error("öffentliche Antwort verrät Kennung oder Eigentümer")
	}
	if code, _ := gast.rufe("PUT", "/api/projects/"+meta.ID, `{"plan":`+beispielPlan+`}`, true); code != http.StatusUnauthorized {
		t.Errorf("Gast schreibt: %d, erwartet 401", code)
	}
}

func TestSicherheitsKoepfeGesetzt(t *testing.T) {
	_, ts := vollServer(t, false)
	res, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	for _, kopf := range []string{"Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"} {
		if res.Header.Get(kopf) == "" {
			t.Errorf("Kopf %s fehlt", kopf)
		}
	}
}
