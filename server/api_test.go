package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testServer(t *testing.T) *server {
	t.Helper()
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Store nicht anlegbar: %v", err)
	}
	return &server{store: store, static: t.TempDir()}
}

const beispielPlan = `{"version":1,"name":"Test","gridCm":10,"levels":[{"id":"l1","name":"EG","heightCm":250,
"walls":[
 {"id":"w1","a":{"x":0,"y":0},"b":{"x":400,"y":0},"thicknessCm":24,"heightCm":250},
 {"id":"w2","a":{"x":400,"y":0},"b":{"x":400,"y":300},"thicknessCm":24,"heightCm":250},
 {"id":"w3","a":{"x":400,"y":300},"b":{"x":0,"y":300},"thicknessCm":24,"heightCm":250},
 {"id":"w4","a":{"x":0,"y":300},"b":{"x":0,"y":0},"thicknessCm":24,"heightCm":250}],
"openings":[],"furniture":[]}]}`

func post(t *testing.T, s *server, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	w := httptest.NewRecorder()
	switch {
	case path == "/api/projects":
		s.projects(w, r)
	default:
		s.project(w, r)
	}
	return w
}

func TestProjektAnlegenLesenSpeichern(t *testing.T) {
	s := testServer(t)

	w := post(t, s, "/api/projects", `{"name":"Mein Haus","plan":`+beispielPlan+`}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("Anlegen ergab %d: %s", w.Code, w.Body.String())
	}
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)
	if meta.Name != "Mein Haus" {
		t.Errorf("Name %q", meta.Name)
	}
	// Kennzahlen kommen aus der Geometrie, nicht vom Client.
	if meta.Rooms != 1 || meta.AreaCm2 != 120000 {
		t.Errorf("Kennzahlen falsch: %d Raeume, %d cm2", meta.Rooms, meta.AreaCm2)
	}

	r := httptest.NewRequest(http.MethodGet, "/api/projects/"+meta.ID, nil)
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("Lesen ergab %d", w.Code)
	}
	var back struct {
		Meta ProjectMeta     `json:"meta"`
		Plan json.RawMessage `json:"plan"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &back); err != nil {
		t.Fatalf("Antwort nicht lesbar: %v", err)
	}
	var p Project
	if err := json.Unmarshal(back.Plan, &p); err != nil || len(p.Levels[0].Walls) != 4 {
		t.Errorf("Grundriss kam nicht unveraendert zurueck")
	}

	r = httptest.NewRequest(http.MethodPut, "/api/projects/"+meta.ID,
		strings.NewReader(`{"name":"Umbenannt","plan":`+beispielPlan+`}`))
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("Speichern ergab %d: %s", w.Code, w.Body.String())
	}
	if m, _ := s.store.Meta(meta.ID); m.Name != "Umbenannt" {
		t.Errorf("Name nach dem Speichern %q", m.Name)
	}
}

func TestKaputterGrundrissWirdAbgewiesen(t *testing.T) {
	s := testServer(t)
	for _, body := range []string{
		`{"name":"x"}`,
		`{"name":"x","plan":{"levels":[]}}`,
		`{"name":"x","plan":{"kein":"grundriss"}}`,
	} {
		w := post(t, s, "/api/projects", body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("Rumpf %s ergab %d, erwartet 400", body, w.Code)
		}
	}
}

func TestFreigabeLinkGiltNurLesendUndLaesstSichZurueckziehen(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Geteilt","plan":`+beispielPlan+`}`)
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)

	r := httptest.NewRequest(http.MethodPost, "/api/projects/"+meta.ID+"/share", nil)
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("Teilen ergab %d", w.Code)
	}
	var share struct {
		Token string `json:"token"`
	}
	json.Unmarshal(w.Body.Bytes(), &share)
	if len(share.Token) != 32 {
		t.Errorf("Token hat %d Zeichen, erwartet 32", len(share.Token))
	}

	r = httptest.NewRequest(http.MethodGet, "/api/shared/"+share.Token, nil)
	w = httptest.NewRecorder()
	s.shared(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("geteilter Abruf ergab %d", w.Code)
	}
	// Kennung und Token duerfen in einer oeffentlich abrufbaren Antwort
	// nicht auftauchen -- sonst waere aus einem Lese- ein Schreibrecht.
	body := w.Body.String()
	if strings.Contains(body, meta.ID) || strings.Contains(body, share.Token) {
		t.Error("Antwort verraet Projekt-ID oder Token")
	}

	r = httptest.NewRequest(http.MethodDelete, "/api/projects/"+meta.ID+"/share", nil)
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("Zurueckziehen ergab %d", w.Code)
	}

	r = httptest.NewRequest(http.MethodGet, "/api/shared/"+share.Token, nil)
	w = httptest.NewRecorder()
	s.shared(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("zurueckgezogener Link antwortet noch mit %d", w.Code)
	}
}

func TestListeGibtKeineFreigabeTokenAus(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Geheim","plan":`+beispielPlan+`}`)
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)
	tok, _ := s.store.Share(meta.ID)

	r := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	w = httptest.NewRecorder()
	s.projects(w, r)
	if strings.Contains(w.Body.String(), tok) {
		t.Error("Freigabe-Token steht in der Projektliste")
	}
}

func TestSVGExport(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Plan A","plan":`+beispielPlan+`}`)
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)

	r := httptest.NewRequest(http.MethodGet, "/api/projects/"+meta.ID+"/svg", nil)
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("SVG ergab %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/svg+xml") {
		t.Errorf("Content-Type %q", ct)
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), "plan-a.svg") {
		t.Errorf("Dateiname: %q", w.Header().Get("Content-Disposition"))
	}
	if !strings.Contains(w.Body.String(), "12,00 m²") {
		t.Error("Raumflaeche fehlt im SVG")
	}
}

func TestUnbekanntesProjekt(t *testing.T) {
	s := testServer(t)
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		r := httptest.NewRequest(method, "/api/projects/gibtsnicht", nil)
		w := httptest.NewRecorder()
		s.project(w, r)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s ergab %d, erwartet 404", method, w.Code)
		}
	}
}

func TestLoeschenEntferntProjekt(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Wegwerf","plan":`+beispielPlan+`}`)
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)

	r := httptest.NewRequest(http.MethodDelete, "/api/projects/"+meta.ID, nil)
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("Loeschen ergab %d", w.Code)
	}
	if _, ok := s.store.Meta(meta.ID); ok {
		t.Error("Projekt steht noch im Index")
	}
}
