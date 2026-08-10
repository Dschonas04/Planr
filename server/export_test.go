package main

import (
	"bytes"
	"encoding/json"
	"image/png"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// --- Format ---

func TestFormatHuelleRundlauf(t *testing.T) {
	raw, err := Wrap(json.RawMessage(beispielPlan))
	if err != nil {
		t.Fatalf("Verpacken fehlgeschlagen: %v", err)
	}
	var f File
	json.Unmarshal(raw, &f)
	if f.Format != FormatName || f.FormatVersion != FormatVersion {
		t.Errorf("Kennung falsch: %s / %d", f.Format, f.FormatVersion)
	}
	if f.SavedAt == "" || f.Generator == "" {
		t.Error("Zeitstempel oder Erzeuger fehlt")
	}

	back, err := Unwrap(raw)
	if err != nil {
		t.Fatalf("Auspacken fehlgeschlagen: %v", err)
	}
	var p Project
	if json.Unmarshal(back, &p) != nil || len(p.Levels[0].Walls) != 4 {
		t.Error("Grundriss kam nicht unveraendert zurueck")
	}
}

// Dateien aus der Zeit vor dem Format sollen weiter lesbar bleiben.
func TestNackteProjektDateiWirdAngenommen(t *testing.T) {
	back, err := Unwrap([]byte(beispielPlan))
	if err != nil {
		t.Fatalf("nackte Datei abgelehnt: %v", err)
	}
	var p Project
	if json.Unmarshal(back, &p) != nil || len(p.Levels) != 1 {
		t.Error("Grundriss nicht erkannt")
	}
}

func TestNeuereFormatversionWirdAbgelehnt(t *testing.T) {
	raw, _ := json.Marshal(File{
		Format: FormatName, FormatVersion: FormatVersion + 5,
		Project: json.RawMessage(beispielPlan),
	})
	_, err := Unwrap(raw)
	if err == nil {
		t.Fatal("neuere Version haette abgelehnt werden muessen")
	}
	// Die Meldung muss sagen, was zu tun ist -- nicht nur, dass es klemmt.
	if !strings.Contains(err.Error(), "aktualisieren") {
		t.Errorf("wenig hilfreiche Meldung: %v", err)
	}
}

func TestFremdeDateiWirdAbgelehnt(t *testing.T) {
	for _, raw := range []string{`{"foo":"bar"}`, `nicht mal json`, `{"levels":[]}`} {
		if _, err := Unwrap([]byte(raw)); err == nil {
			t.Errorf("%q haette abgelehnt werden muessen", raw)
		}
	}
}

// --- Pruefung ---

func TestValidateFindetMehrereMaengelAufEinmal(t *testing.T) {
	plan := `{"levels":[{"walls":[
	  {"id":"w1","a":{"x":0,"y":0},"b":{"x":0,"y":0},"thicknessCm":24},
	  {"id":"w1","a":{"x":0,"y":0},"b":{"x":400,"y":0},"thicknessCm":0}],
	 "openings":[{"id":"o1","wallId":"gibtsnicht","widthCm":90,"heightCm":200}],
	 "furniture":[{"id":"f1","widthCm":-5,"depthCm":50}]}]}`

	m := Validate(json.RawMessage(plan))
	if len(m) < 4 {
		t.Fatalf("nur %d Maengel gefunden: %v", len(m), m)
	}
	joined := strings.Join(m, " | ")
	for _, erwartet := range []string{"doppelt", "kürzer als 1 cm", "Dicke", "Wand, die es nicht gibt", "nicht positiv"} {
		if !strings.Contains(joined, erwartet) {
			t.Errorf("Mangel %q nicht gemeldet. Gefunden: %s", erwartet, joined)
		}
	}
}

func TestValidateMeldetUeberstehendeOeffnung(t *testing.T) {
	plan := `{"levels":[{"walls":[{"id":"w1","a":{"x":0,"y":0},"b":{"x":100,"y":0},"thicknessCm":24}],
	 "openings":[{"id":"o1","wallId":"w1","offsetCm":90,"widthCm":90,"heightCm":200}]}]}`
	m := Validate(json.RawMessage(plan))
	if !strings.Contains(strings.Join(m, " "), "ragt über die Wand hinaus") {
		t.Errorf("ueberstehende Oeffnung nicht erkannt: %v", m)
	}
}

func TestValidateAkzeptiertGesundenGrundriss(t *testing.T) {
	if m := Validate(json.RawMessage(beispielPlan)); len(m) != 0 {
		t.Errorf("gesunder Grundriss beanstandet: %v", m)
	}
}

// --- PNG ---

func TestPNGWirdErzeugtUndHatPassendeGroesse(t *testing.T) {
	var p Project
	json.Unmarshal([]byte(beispielPlan), &p)

	var buf bytes.Buffer
	if err := RenderPNG(&buf, p, p.Levels[0], 800); err != nil {
		t.Fatalf("PNG fehlgeschlagen: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("Ergebnis ist kein gueltiges PNG: %v", err)
	}
	b := img.Bounds()
	if b.Dx() < 100 || b.Dy() < 100 {
		t.Errorf("Bild zu klein: %dx%d", b.Dx(), b.Dy())
	}
	if b.Dx() > 900 || b.Dy() > 900 {
		t.Errorf("Bild ueberschreitet die Grenze: %dx%d", b.Dx(), b.Dy())
	}

	// Es muss tatsaechlich etwas gezeichnet worden sein: der dunkle Wandton
	// unterscheidet sich deutlich vom hellen Hintergrund.
	dunkel := 0
	for y := b.Min.Y; y < b.Max.Y; y += 3 {
		for x := b.Min.X; x < b.Max.X; x += 3 {
			r, g, bl, _ := img.At(x, y).RGBA()
			if r>>8 < 100 && g>>8 < 100 && bl>>8 < 100 {
				dunkel++
			}
		}
	}
	if dunkel < 50 {
		t.Errorf("nur %d dunkle Bildpunkte -- wurden die Waende gezeichnet?", dunkel)
	}
}

func TestPNGGroesseWirdBegrenzt(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Gross","plan":`+beispielPlan+`}`)
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)

	// Ohne Begrenzung wuerde der Dienst hier minutenlang rechnen.
	r := httptest.NewRequest(http.MethodGet, "/api/projects/"+meta.ID+"/png?size=99999", nil)
	w = httptest.NewRecorder()
	s.project(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("PNG ergab %d", w.Code)
	}
	img, err := png.Decode(bytes.NewReader(w.Body.Bytes()))
	if err != nil {
		t.Fatalf("kein gueltiges PNG: %v", err)
	}
	if img.Bounds().Dx() > 6100 {
		t.Errorf("Begrenzung greift nicht: %d Pixel breit", img.Bounds().Dx())
	}
}

func TestFarbwerteLesen(t *testing.T) {
	faelle := map[string][3]uint8{
		"#8fa6c4": {0x8f, 0xa6, 0xc4},
		"#fff":    {0xff, 0xff, 0xff},
		"kaputt":  {0xa0, 0xa0, 0xa0},
		"":        {0xa0, 0xa0, 0xa0},
		"#zzzzzz": {0xa0, 0xa0, 0xa0},
	}
	for in, want := range faelle {
		got := parseHexColor(in)
		if got.R != want[0] || got.G != want[1] || got.B != want[2] {
			t.Errorf("%q ergab %v, erwartet %v", in, got, want)
		}
	}
}

// --- DXF ---

func TestDXFHatGrundgeruestUndEbenen(t *testing.T) {
	var p Project
	json.Unmarshal([]byte(beispielPlan), &p)

	var buf bytes.Buffer
	if err := RenderDXF(&buf, p, p.Levels[0]); err != nil {
		t.Fatalf("DXF fehlgeschlagen: %v", err)
	}
	out := buf.String()

	for _, muss := range []string{"SECTION", "HEADER", "AC1009", "ENTITIES", "LINE", "WAENDE", "RAEUME", "EOF"} {
		if !strings.Contains(out, muss) {
			t.Errorf("DXF enthaelt %q nicht", muss)
		}
	}
	// Jedes Gruppenpaar belegt zwei Zeilen -- eine ungerade Zahl waere ein
	// abgeschnittener Eintrag.
	zeilen := strings.Count(strings.TrimRight(out, "\n"), "\n") + 1
	if zeilen%2 != 0 {
		t.Errorf("%d Zeilen -- Gruppenpaare sind unvollstaendig", zeilen)
	}
}

func TestDXFRechnetInMillimeterUndSpiegeltY(t *testing.T) {
	p := Project{Levels: []Level{{
		Walls: []Wall{{ID: "w1", A: Point{0, 0}, B: Point{100, 200}, ThicknessCm: 24, HeightCm: 250}},
	}}}
	var buf bytes.Buffer
	RenderDXF(&buf, p, p.Levels[0])
	zeilen := strings.Split(buf.String(), "\n")

	// Y-Werte stehen hinter den Gruppencodes 20 und 21. Die Wand wird als
	// Viereck ihrer Dicke ausgegeben, die Mittellinien-Endpunkte tauchen
	// darin also nicht exakt auf -- geprueft wird deshalb die Eigenschaft:
	// alle Y sind nicht positiv (gespiegelt) und liegen im Millimeterbereich.
	var ys []float64
	for i := 0; i+1 < len(zeilen); i++ {
		code := strings.TrimSpace(zeilen[i])
		if code != "20" && code != "21" {
			continue
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(zeilen[i+1]), 64)
		if err != nil {
			t.Fatalf("Y-Wert %q nicht lesbar", zeilen[i+1])
		}
		ys = append(ys, v)
	}
	if len(ys) == 0 {
		t.Fatal("keine Y-Werte im DXF gefunden")
	}

	// Jede Ecke des Wandvierecks muss als -Y*10 im DXF auftauchen. Das prueft
	// Spiegelung und Massstab in einem, ohne auf einen einzelnen Wert zu raten.
	for _, ecke := range wallQuad(p.Levels[0].Walls[0]) {
		erwartet := -ecke.Y * mmPerCm
		gefunden := false
		for _, v := range ys {
			if math.Abs(v-erwartet) < 0.01 {
				gefunden = true
				break
			}
		}
		if !gefunden {
			t.Errorf("Ecke mit Plan-Y %.3f cm fehlt als %.3f mm im DXF", ecke.Y, erwartet)
		}
	}

	var maxBetrag float64
	for _, v := range ys {
		if math.Abs(v) > maxBetrag {
			maxBetrag = math.Abs(v)
		}
	}
	// 200 cm sind 2000 mm; mit der halben Wanddicke etwas mehr. Bliebe die
	// Einheit Zentimeter, laege der groesste Betrag bei rund 200.
	if maxBetrag < 1900 {
		t.Errorf("groesster Y-Betrag %.1f -- nicht in Millimeter umgerechnet", maxBetrag)
	}
}

// --- Import ---

func TestImportLegtNeuesProjektAn(t *testing.T) {
	s := testServer(t)
	raw, _ := Wrap(json.RawMessage(beispielPlan))

	r := httptest.NewRequest(http.MethodPost, "/api/import?name=Importiert", bytes.NewReader(raw))
	w := httptest.NewRecorder()
	s.importFile(w, r)
	if w.Code != http.StatusCreated {
		t.Fatalf("Import ergab %d: %s", w.Code, w.Body.String())
	}
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)
	if meta.Name != "Importiert" {
		t.Errorf("Name %q", meta.Name)
	}
	if meta.Rooms != 1 {
		t.Errorf("%d Raeume erkannt, erwartet 1", meta.Rooms)
	}
}

func TestImportLehntFehlerhaftenGrundrissAb(t *testing.T) {
	s := testServer(t)
	kaputt := `{"levels":[{"walls":[{"id":"w1","a":{"x":0,"y":0},"b":{"x":0,"y":0},"thicknessCm":0}]}]}`

	r := httptest.NewRequest(http.MethodPost, "/api/import", strings.NewReader(kaputt))
	w := httptest.NewRecorder()
	s.importFile(w, r)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("ergab %d, erwartet 422", w.Code)
	}
	var resp struct {
		Issues []string `json:"issues"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Issues) == 0 {
		t.Error("keine Maengelliste zurueckgegeben")
	}
}

// Ein Import darf nie stillschweigend etwas Bestehendes ueberschreiben.
func TestImportUeberschreibtNichts(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Bestehend","plan":`+beispielPlan+`}`)
	var erst ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &erst)

	raw, _ := Wrap(json.RawMessage(beispielPlan))
	r := httptest.NewRequest(http.MethodPost, "/api/import?name=Bestehend", bytes.NewReader(raw))
	w = httptest.NewRecorder()
	s.importFile(w, r)

	var zweit ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &zweit)
	if zweit.ID == erst.ID {
		t.Error("Import hat das bestehende Projekt ueberschrieben")
	}
	if len(s.store.List()) != 2 {
		t.Errorf("%d Projekte, erwartet 2", len(s.store.List()))
	}
}

func TestValidateEndpunktMeldetOhneZuSpeichern(t *testing.T) {
	s := testServer(t)
	r := httptest.NewRequest(http.MethodPost, "/api/validate", strings.NewReader(beispielPlan))
	w := httptest.NewRecorder()
	s.validate(w, r)

	var resp struct {
		OK     bool     `json:"ok"`
		Issues []string `json:"issues"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.OK {
		t.Errorf("gesunder Grundriss als fehlerhaft gemeldet: %v", resp.Issues)
	}
	if len(s.store.List()) != 0 {
		t.Error("Pruefung hat etwas gespeichert")
	}
}

func TestAlleExportformateAntworten(t *testing.T) {
	s := testServer(t)
	w := post(t, s, "/api/projects", `{"name":"Export","plan":`+beispielPlan+`}`)
	var meta ProjectMeta
	json.Unmarshal(w.Body.Bytes(), &meta)

	faelle := map[string]string{
		"svg":   "image/svg+xml",
		"png":   "image/png",
		"dxf":   "application/dxf",
		"planr": "application/json",
	}
	for format, ct := range faelle {
		r := httptest.NewRequest(http.MethodGet, "/api/projects/"+meta.ID+"/"+format, nil)
		w := httptest.NewRecorder()
		s.project(w, r)
		if w.Code != http.StatusOK {
			t.Errorf("%s ergab %d", format, w.Code)
			continue
		}
		if !strings.HasPrefix(w.Header().Get("Content-Type"), ct) {
			t.Errorf("%s hat Content-Type %q, erwartet %q", format, w.Header().Get("Content-Type"), ct)
		}
		if w.Body.Len() < 100 {
			t.Errorf("%s lieferte nur %d Bytes", format, w.Body.Len())
		}
	}
}
