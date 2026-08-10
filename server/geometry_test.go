package main

import (
	"encoding/json"
	"math"
	"testing"
)

func wand(ax, ay, bx, by float64) Wall {
	return Wall{A: Point{ax, ay}, B: Point{bx, by}, ThicknessCm: 24, HeightCm: 250}
}

func TestPolygonflaeche(t *testing.T) {
	a := PolygonArea([]Point{{0, 0}, {400, 0}, {400, 300}, {0, 300}})
	if math.Abs(math.Abs(a)-120000) > 0.001 {
		t.Errorf("Flaeche %.0f, erwartet 120000 (4 m x 3 m)", math.Abs(a))
	}
}

func TestEinzelnerGeschlossenerRaum(t *testing.T) {
	rooms := FindRooms([]Wall{
		wand(0, 0, 400, 0), wand(400, 0, 400, 300),
		wand(400, 300, 0, 300), wand(0, 300, 0, 0),
	}, 1)
	if len(rooms) != 1 {
		t.Fatalf("%d Raeume, erwartet 1", len(rooms))
	}
	if math.Abs(math.Abs(rooms[0].Area)-120000) > 0.001 {
		t.Errorf("Flaeche %.0f, erwartet 120000", math.Abs(rooms[0].Area))
	}
}

// Der T-Stoss ist der kritische Fall: die Zwischenwand endet mitten auf der
// durchgehenden Aussenwand. Ohne Noding waeren beide Raeume einer.
func TestZwischenwandTrenntZweiRaeume(t *testing.T) {
	rooms := FindRooms([]Wall{
		wand(0, 0, 600, 0), wand(600, 0, 600, 300),
		wand(600, 300, 0, 300), wand(0, 300, 0, 0),
		wand(300, 0, 300, 300),
	}, 1)
	if len(rooms) != 2 {
		t.Fatalf("%d Raeume, erwartet 2", len(rooms))
	}
	for _, r := range rooms {
		if math.Abs(math.Abs(r.Area)-90000) > 0.001 {
			t.Errorf("Flaeche %.0f, erwartet 90000", math.Abs(r.Area))
		}
	}
}

func TestOffeneWandketteIstKeinRaum(t *testing.T) {
	rooms := FindRooms([]Wall{wand(0, 0, 400, 0), wand(400, 0, 400, 300)}, 1)
	if len(rooms) != 0 {
		t.Errorf("%d Raeume, erwartet 0", len(rooms))
	}
}

// Dieselbe Beispielwohnung wie im Browser: 9 m x 6 m, drei Raeume, zusammen
// exakt 54 m2. Weicht die Go-Seite hier ab, rechnet sie anders als der Client.
func TestBeispielwohnungWieImBrowser(t *testing.T) {
	rooms := FindRooms([]Wall{
		wand(0, 0, 900, 0), wand(900, 0, 900, 600),
		wand(900, 600, 0, 600), wand(0, 600, 0, 0),
		wand(560, 0, 560, 600),
		wand(560, 360, 900, 360),
	}, 1)

	if len(rooms) != 3 {
		t.Fatalf("%d Raeume, erwartet 3", len(rooms))
	}
	var gesamt float64
	for _, r := range rooms {
		gesamt += math.Abs(r.Area)
	}
	if math.Abs(gesamt-540000) > 1 {
		t.Errorf("Gesamtflaeche %.0f cm2, erwartet 540000 (54 m2)", gesamt)
	}
}

func TestWandzerlegungLaesstBruestungUndSturzStehen(t *testing.T) {
	w := wand(0, 0, 400, 0)
	solids := WallSolids(w, []Opening{
		{OffsetCm: 200, WidthCm: 100, SillCm: 90, HeightCm: 140, Type: "window"},
	})
	if len(solids) != 4 {
		t.Fatalf("%d Stuecke, erwartet 4 (links, Bruestung, Sturz, rechts)", len(solids))
	}
	var bruestung, sturz bool
	for _, s := range solids {
		if s.Bottom == 0 && s.Top == 90 {
			bruestung = true
		}
		if s.Bottom == 230 && s.Top == 250 {
			sturz = true
		}
	}
	if !bruestung {
		t.Error("Bruestung fehlt")
	}
	if !sturz {
		t.Error("Sturz fehlt")
	}
}

func TestTuerWirdBisZumBodenDurchgestanzt(t *testing.T) {
	solids := WallSolids(wand(0, 0, 300, 0), []Opening{
		{OffsetCm: 150, WidthCm: 90, SillCm: 0, HeightCm: 200, Type: "door"},
	})
	for _, s := range solids {
		if s.Bottom == 0 && s.From >= 105 && s.To <= 195 {
			t.Errorf("Mauerwerk im Tuerdurchgang: %+v", s)
		}
	}
}

func TestSVGEnthaeltMasseUndFlaechen(t *testing.T) {
	p := Project{Name: "Test", Levels: []Level{{
		Walls: []Wall{
			wand(0, 0, 400, 0), wand(400, 0, 400, 300),
			wand(400, 300, 0, 300), wand(0, 300, 0, 0),
		},
		Furniture: []Furniture{{X: 200, Y: 150, WidthCm: 140, DepthCm: 200, RotationDeg: 0, Color: "#8fa6c4"}},
	}}}

	svg := RenderSVG(p, p.Levels[0])
	for _, muss := range []string{"<svg", "mm\"", "12,00 m²", "4,00 m", "</svg>"} {
		if !contains(svg, muss) {
			t.Errorf("SVG enthaelt %q nicht", muss)
		}
	}
}

func TestSVGEntschaerftSonderzeichenImNamen(t *testing.T) {
	p := Project{Name: `Haus <script>alert(1)</script> & "Co"`, Levels: []Level{{}}}
	svg := RenderSVG(p, p.Levels[0])
	if contains(svg, "<script>") {
		t.Error("Sonderzeichen im Namen wurden nicht entschaerft")
	}
	if !contains(svg, "&lt;script&gt;") {
		t.Error("erwartete Ersetzung fehlt")
	}
}

func TestKennzahlenAusDemPlan(t *testing.T) {
	plan, _ := json.Marshal(Project{Levels: []Level{{
		Walls: []Wall{
			wand(0, 0, 400, 0), wand(400, 0, 400, 300),
			wand(400, 300, 0, 300), wand(0, 300, 0, 0),
		},
	}}})
	var meta ProjectMeta
	stats(plan, &meta)
	if meta.Rooms != 1 {
		t.Errorf("%d Raeume, erwartet 1", meta.Rooms)
	}
	if meta.AreaCm2 != 120000 {
		t.Errorf("Flaeche %d, erwartet 120000", meta.AreaCm2)
	}
}

func TestKaputterPlanErgibtNullwerteStattAbbruch(t *testing.T) {
	var meta ProjectMeta
	stats(json.RawMessage(`{"kaputt":`), &meta)
	if meta.Rooms != 0 || meta.AreaCm2 != 0 {
		t.Errorf("erwartet Nullwerte, bekommen %+v", meta)
	}
}

func contains(h, n string) bool {
	return len(n) == 0 || (len(h) >= len(n) && indexOf(h, n) >= 0)
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
