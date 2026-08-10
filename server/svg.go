package main

// Serverseitiger SVG-Export.
//
// Das Gegenstueck im Browser (client/src/export.js) braucht ein geoeffnetes
// Fenster. Diese Fassung erzeugt denselben Plan ohne Browser -- damit laesst
// sich ein Grundriss direkt verlinken, einbinden oder aus einem Skript heraus
// abrufen. Masseinheit im Dokument ist Millimeter, damit der Ausdruck
// massstabsgerecht herauskommt.

import (
	"fmt"
	"math"
	"strings"
)

const (
	paddingCm    = 120.0
	colBackgrd   = "#f5f3ee"
	colWall      = "#2f3438"
	colRoomFill  = "#7ea0be"
	colRoomText  = "#4a5560"
	colDimension = "#7b8794"
	colOpening   = "#3d6b8c"
	colFurnLine  = "#4a4a4a"
)

type bbox struct{ MinX, MinY, MaxX, MaxY float64 }

func extent(l Level) bbox {
	pts := []Point{}
	for _, w := range l.Walls {
		pts = append(pts, w.A, w.B)
	}
	for _, f := range l.Furniture {
		pts = append(pts, rectCorners(f.X, f.Y, f.WidthCm, f.DepthCm, f.RotationDeg*math.Pi/180)...)
	}
	if len(pts) == 0 {
		return bbox{0, 0, 500, 500}
	}
	b := bbox{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	for _, p := range pts {
		b.MinX, b.MinY = math.Min(b.MinX, p.X), math.Min(b.MinY, p.Y)
		b.MaxX, b.MaxY = math.Max(b.MaxX, p.X), math.Max(b.MaxY, p.Y)
	}
	b.MinX -= paddingCm
	b.MinY -= paddingCm
	b.MaxX += paddingCm
	b.MaxY += paddingCm
	return b
}

func rectCorners(cx, cy, w, d, rad float64) []Point {
	hw, hd := w/2, d/2
	cos, sin := math.Cos(rad), math.Sin(rad)
	rot := func(dx, dy float64) Point {
		return Point{cx + dx*cos - dy*sin, cy + dx*sin + dy*cos}
	}
	return []Point{rot(-hw, -hd), rot(hw, -hd), rot(hw, hd), rot(-hw, hd)}
}

// wallQuad liefert die vier Eckpunkte einer Wand aus Mittellinie und Dicke.
func wallQuad(w Wall) []Point {
	dx, dy := w.B.X-w.A.X, w.B.Y-w.A.Y
	l := math.Hypot(dx, dy)
	if l < eps {
		return nil
	}
	th := w.ThicknessCm
	if th <= 0 {
		th = 24
	}
	nx, ny := -dy/l*(th/2), dx/l*(th/2)
	return []Point{
		{w.A.X + nx, w.A.Y + ny},
		{w.B.X + nx, w.B.Y + ny},
		{w.B.X - nx, w.B.Y - ny},
		{w.A.X - nx, w.A.Y - ny},
	}
}

func poly(pts []Point) string {
	parts := make([]string, len(pts))
	for i, p := range pts {
		parts[i] = fmt.Sprintf("%.1f,%.1f", p.X, p.Y)
	}
	return strings.Join(parts, " ")
}

func esc(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;")
	return r.Replace(s)
}

func formatArea(cm2 float64) string {
	return strings.Replace(fmt.Sprintf("%.2f m²", cm2/10000), ".", ",", 1)
}

func formatLength(cm float64) string {
	if math.Abs(cm) < 100 {
		return fmt.Sprintf("%.0f cm", cm)
	}
	return strings.Replace(fmt.Sprintf("%.2f m", cm/100), ".", ",", 1)
}

// RenderSVG zeichnet eine Ebene als massstabsgerechtes SVG.
func RenderSVG(p Project, l Level) string {
	b := extent(l)
	w, h := b.MaxX-b.MinX, b.MaxY-b.MinY

	var s strings.Builder
	fmt.Fprintf(&s,
		`<svg xmlns="http://www.w3.org/2000/svg" width="%.0fmm" height="%.0fmm" viewBox="%.1f %.1f %.1f %.1f">`,
		w/10, h/10, b.MinX, b.MinY, w, h)
	fmt.Fprintf(&s, "\n<title>%s</title>", esc(p.Name))
	fmt.Fprintf(&s, "\n<rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"%.1f\" fill=\"%s\"/>",
		b.MinX, b.MinY, w, h, colBackgrd)

	// Raumflaechen zuerst, damit Waende und Moebel darueber liegen
	rooms := FindRooms(l.Walls, 1)
	for _, r := range rooms {
		fmt.Fprintf(&s, "\n<polygon points=\"%s\" fill=\"%s\" fill-opacity=\"0.16\"/>", poly(r.Points), colRoomFill)
	}

	for _, wl := range l.Walls {
		q := wallQuad(wl)
		if q == nil {
			continue
		}
		fmt.Fprintf(&s, "\n<polygon points=\"%s\" fill=\"%s\"/>", poly(q), colWall)
	}

	// Oeffnungen werden mit der Hintergrundfarbe ausgestanzt
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
		angle := math.Atan2(dy, dx) * 180 / math.Pi
		th := wl.ThicknessCm + 2
		for _, o := range ops {
			cx := wl.A.X + dx/length*o.OffsetCm
			cy := wl.A.Y + dy/length*o.OffsetCm
			fmt.Fprintf(&s, "\n<g transform=\"translate(%.1f %.1f) rotate(%.2f)\">", cx, cy, angle)
			fmt.Fprintf(&s, "<rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"%.1f\" fill=\"%s\"/>",
				-o.WidthCm/2, -th/2, o.WidthCm, th, colBackgrd)
			if o.Type == "window" {
				fmt.Fprintf(&s, "<line x1=\"%.1f\" y1=\"0\" x2=\"%.1f\" y2=\"0\" stroke=\"%s\" stroke-width=\"3\"/>",
					-o.WidthCm/2, o.WidthCm/2, colOpening)
			} else {
				swing := 1.0
				if o.Swing == -1 {
					swing = -1
				}
				fmt.Fprintf(&s, "<path d=\"M %.1f 0 L %.1f %.1f\" stroke=\"%s\" stroke-width=\"3\" fill=\"none\"/>",
					-o.WidthCm/2, -o.WidthCm/2, swing*o.WidthCm, colOpening)
			}
			s.WriteString("</g>")
		}
	}

	for _, f := range l.Furniture {
		color := f.Color
		if color == "" {
			color = "#a0a0a0"
		}
		fmt.Fprintf(&s,
			"\n<g transform=\"translate(%.1f %.1f) rotate(%.1f)\"><rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"%.1f\" fill=\"%s\" stroke=\"%s\" stroke-width=\"2\"/></g>",
			f.X, f.Y, f.RotationDeg, -f.WidthCm/2, -f.DepthCm/2, f.WidthCm, f.DepthCm, color, colFurnLine)
	}

	// Beschriftungen zuletzt, sonst verschwinden sie unter Moebeln
	for _, r := range rooms {
		c := PolygonCentroid(r.Points)
		fmt.Fprintf(&s,
			"\n<text x=\"%.1f\" y=\"%.1f\" font-size=\"22\" text-anchor=\"middle\" font-family=\"sans-serif\" fill=\"%s\">%s</text>",
			c.X, c.Y, colRoomText, esc(formatArea(math.Abs(r.Area))))
	}
	for _, wl := range l.Walls {
		length := dist(wl.A, wl.B)
		if length < 20 {
			continue
		}
		mx, my := (wl.A.X+wl.B.X)/2, (wl.A.Y+wl.B.Y)/2
		fmt.Fprintf(&s,
			"\n<text x=\"%.1f\" y=\"%.1f\" font-size=\"18\" text-anchor=\"middle\" font-family=\"sans-serif\" fill=\"%s\">%s</text>",
			mx, my-18, colDimension, esc(formatLength(length)))
	}

	s.WriteString("\n</svg>\n")
	return s.String()
}
