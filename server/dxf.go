package main

// DXF-Export (AutoCAD R12, ASCII).
//
// Der Grund fuer dieses Format: SVG und PNG sind Bilder, DXF ist Geometrie.
// Damit kommt ein Grundriss in jedes CAD-Programm -- QCAD, LibreCAD,
// AutoCAD, FreeCAD -- und laesst sich dort weiterbearbeiten, bemassen und in
// eine Werkplanung uebernehmen.
//
// R12 ist die aelteste weit verbreitete Fassung und wird von allem gelesen.
// Sie kommt ohne Tabellenwerk fuer Objekte aus; Linien, Kreise und Text
// genuegen fuer einen Grundriss.
//
// Einheit ist Millimeter -- in der Bauplanung ueblich, waehrend Planr intern
// in Zentimetern rechnet. Deshalb wird beim Schreiben mit 10 multipliziert.
//
// Y wird gespiegelt: im Editor zeigt Y nach unten (Bildschirmkoordinaten),
// in CAD nach oben.

import (
	"fmt"
	"io"
	"math"
	"strings"
)

const mmPerCm = 10.0

type dxfWriter struct {
	b   strings.Builder
	err error
}

// pair schreibt ein DXF-Gruppenpaar: Code in einer Zeile, Wert in der naechsten.
func (d *dxfWriter) pair(code int, value string) {
	fmt.Fprintf(&d.b, "%d\n%s\n", code, value)
}

func (d *dxfWriter) num(code int, v float64) {
	d.pair(code, strings.Replace(fmt.Sprintf("%.3f", v), ",", ".", -1))
}

func (d *dxfWriter) line(layer string, a, b Point) {
	d.pair(0, "LINE")
	d.pair(8, layer)
	d.num(10, a.X*mmPerCm)
	d.num(20, -a.Y*mmPerCm) // Y gespiegelt
	d.num(30, 0)
	d.num(11, b.X*mmPerCm)
	d.num(21, -b.Y*mmPerCm)
	d.num(31, 0)
}

func (d *dxfWriter) polyline(layer string, pts []Point, closed bool) {
	for i := 0; i+1 < len(pts); i++ {
		d.line(layer, pts[i], pts[i+1])
	}
	if closed && len(pts) > 2 {
		d.line(layer, pts[len(pts)-1], pts[0])
	}
}

func (d *dxfWriter) text(layer string, at Point, heightMm float64, s string) {
	d.pair(0, "TEXT")
	d.pair(8, layer)
	d.num(10, at.X*mmPerCm)
	d.num(20, -at.Y*mmPerCm)
	d.num(30, 0)
	d.num(40, heightMm)
	d.pair(1, s)
	d.pair(72, "1") // horizontal zentriert
	d.num(11, at.X*mmPerCm)
	d.num(21, -at.Y*mmPerCm)
	d.num(31, 0)
}

// RenderDXF schreibt eine Ebene als DXF.
//
// Die Ebenen (Layer) trennen die Gewerke, damit sich im CAD einzelne Teile
// ausblenden lassen: WAENDE, OEFFNUNGEN, MOEBEL, BESCHRIFTUNG, RAEUME.
func RenderDXF(w io.Writer, p Project, l Level) error {
	d := &dxfWriter{}

	d.pair(0, "SECTION")
	d.pair(2, "HEADER")
	d.pair(9, "$ACADVER")
	d.pair(1, "AC1009") // R12
	d.pair(9, "$INSUNITS")
	d.pair(70, "4") // Millimeter
	d.pair(0, "ENDSEC")

	d.pair(0, "SECTION")
	d.pair(2, "ENTITIES")

	// Waende als geschlossene Umrisse ihrer tatsaechlichen Dicke -- eine
	// blosse Mittellinie waere fuer eine Werkplanung wertlos.
	for _, wl := range l.Walls {
		if q := wallQuad(wl); q != nil {
			d.polyline("WAENDE", q, true)
		}
	}

	byWall := map[string][]Opening{}
	for _, o := range l.Openings {
		byWall[o.WallID] = append(byWall[o.WallID], o)
	}
	for _, wl := range l.Walls {
		ops := byWall[wl.ID]
		if len(ops) == 0 {
			continue
		}
		dx, dy := wl.B.X-wl.A.X, wl.B.Y-wl.A.Y
		length := math.Hypot(dx, dy)
		if length < eps {
			continue
		}
		ux, uy := dx/length, dy/length
		nx, ny := -uy, ux
		th := wl.ThicknessCm / 2

		for _, o := range ops {
			cx := wl.A.X + ux*o.OffsetCm
			cy := wl.A.Y + uy*o.OffsetCm
			half := o.WidthCm / 2
			// Die beiden Laibungen quer durch die Wand
			for _, s := range []float64{-half, half} {
				a := Point{cx + ux*s + nx*th, cy + uy*s + ny*th}
				b := Point{cx + ux*s - nx*th, cy + uy*s - ny*th}
				d.line("OEFFNUNGEN", a, b)
			}
			if o.Type == "window" {
				// Glasebene
				d.line("OEFFNUNGEN",
					Point{cx - ux*half, cy - uy*half},
					Point{cx + ux*half, cy + uy*half})
			} else {
				swing := 1.0
				if o.Swing == -1 {
					swing = -1
				}
				hinge := Point{cx - ux*half, cy - uy*half}
				leaf := Point{hinge.X + nx*swing*o.WidthCm, hinge.Y + ny*swing*o.WidthCm}
				d.line("OEFFNUNGEN", hinge, leaf)
			}
		}
	}

	for _, f := range l.Furniture {
		corners := rectCorners(f.X, f.Y, f.WidthCm, f.DepthCm, f.RotationDeg*math.Pi/180)
		d.polyline("MOEBEL", corners, true)
		if f.Label != "" {
			d.text("BESCHRIFTUNG", Point{f.X, f.Y}, 80, f.Label)
		}
	}

	for _, r := range FindRooms(l.Walls, 1) {
		d.polyline("RAEUME", r.Points, true)
		d.text("BESCHRIFTUNG", PolygonCentroid(r.Points), 150, formatArea(math.Abs(r.Area)))
	}

	for _, wl := range l.Walls {
		length := dist(wl.A, wl.B)
		if length < 20 {
			continue
		}
		mid := Point{(wl.A.X + wl.B.X) / 2, (wl.A.Y + wl.B.Y) / 2}
		d.text("BESCHRIFTUNG", Point{mid.X, mid.Y - 20}, 100, formatLength(length))
	}

	d.pair(0, "ENDSEC")
	d.pair(0, "EOF")

	_, err := io.WriteString(w, d.b.String())
	return err
}
