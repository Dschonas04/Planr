package main

// Geometrie des Grundrisses -- die Go-Entsprechung von
// client/src/model/geometry.js.
//
// Der Server braucht sie fuer zwei Dinge: die Kennzahlen der Projektuebersicht
// (Raumzahl und Flaeche) und den serverseitigen SVG-Export. Beide Seiten
// muessen dieselben Raeume finden, deshalb pruefen beide dieselben Faelle --
// siehe geometry_test.go und tests/geometry.test.js.
//
// Alle Laengen sind Zentimeter, Winkel im Bogenmass.

import (
	"math"
	"sort"
)

const eps = 1e-6

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Wall struct {
	ID          string  `json:"id"`
	A           Point   `json:"a"`
	B           Point   `json:"b"`
	ThicknessCm float64 `json:"thicknessCm"`
	HeightCm    float64 `json:"heightCm"`
}

type Opening struct {
	ID       string  `json:"id"`
	WallID   string  `json:"wallId"`
	OffsetCm float64 `json:"offsetCm"`
	WidthCm  float64 `json:"widthCm"`
	HeightCm float64 `json:"heightCm"`
	SillCm   float64 `json:"sillCm"`
	Type     string  `json:"type"`
	Swing    int     `json:"swing"`
}

type Furniture struct {
	ID          string  `json:"id"`
	CatalogID   string  `json:"catalogId"`
	Label       string  `json:"label"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	WidthCm     float64 `json:"widthCm"`
	DepthCm     float64 `json:"depthCm"`
	HeightCm    float64 `json:"heightCm"`
	RotationDeg float64 `json:"rotationDeg"`
	Color       string  `json:"color"`
}

type Level struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	HeightCm  float64     `json:"heightCm"`
	Walls     []Wall      `json:"walls"`
	Openings  []Opening   `json:"openings"`
	Furniture []Furniture `json:"furniture"`
}

type Project struct {
	Version int     `json:"version"`
	Name    string  `json:"name"`
	GridCm  float64 `json:"gridCm"`
	Levels  []Level `json:"levels"`
}

type Room struct {
	Points []Point `json:"points"`
	Area   float64 `json:"area"`
}

type segment struct{ A, B Point }

func dist(a, b Point) float64 { return math.Hypot(b.X-a.X, b.Y-a.Y) }

// closestOnSegment liefert den Parameter t in [0,1] und den Abstand.
func closestOnSegment(p, a, b Point) (t, d float64) {
	abx, aby := b.X-a.X, b.Y-a.Y
	l2 := abx*abx + aby*aby
	if l2 < eps {
		return 0, dist(p, a)
	}
	t = ((p.X-a.X)*abx + (p.Y-a.Y)*aby) / l2
	t = math.Max(0, math.Min(1, t))
	q := Point{a.X + abx*t, a.Y + aby*t}
	return t, dist(p, q)
}

func segmentIntersection(a1, a2, b1, b2 Point) (Point, bool) {
	rx, ry := a2.X-a1.X, a2.Y-a1.Y
	sx, sy := b2.X-b1.X, b2.Y-b1.Y
	den := rx*sy - ry*sx
	if math.Abs(den) < eps {
		return Point{}, false
	}
	t := ((b1.X-a1.X)*sy - (b1.Y-a1.Y)*sx) / den
	u := ((b1.X-a1.X)*ry - (b1.Y-a1.Y)*rx) / den
	if t < -eps || t > 1+eps || u < -eps || u > 1+eps {
		return Point{}, false
	}
	return Point{a1.X + rx*t, a1.Y + ry*t}, true
}

// PolygonArea ist positiv bei mathematisch positivem Umlaufsinn.
func PolygonArea(pts []Point) float64 {
	a := 0.0
	for i := range pts {
		p, q := pts[i], pts[(i+1)%len(pts)]
		a += p.X*q.Y - q.X*p.Y
	}
	return a / 2
}

func PolygonCentroid(pts []Point) Point {
	a := PolygonArea(pts)
	if math.Abs(a) < eps {
		var sx, sy float64
		for _, p := range pts {
			sx, sy = sx+p.X, sy+p.Y
		}
		n := math.Max(float64(len(pts)), 1)
		return Point{sx / n, sy / n}
	}
	var cx, cy float64
	for i := range pts {
		p, q := pts[i], pts[(i+1)%len(pts)]
		f := p.X*q.Y - q.X*p.Y
		cx += (p.X + q.X) * f
		cy += (p.Y + q.Y) * f
	}
	return Point{cx / (6 * a), cy / (6 * a)}
}

// nodeSegments zerlegt Strecken an allen Beruehrpunkten.
//
// Ohne diesen Schritt haengt eine Zwischenwand, die mitten auf einer
// durchgehenden Aussenwand endet, im Graphen in der Luft: der T-Stoss waere
// kein Knoten, und die Flaechensuche saehe beide Raeume als einen.
func nodeSegments(segs []segment, tol float64) []segment {
	endpoints := make([]Point, 0, len(segs)*2)
	for _, s := range segs {
		endpoints = append(endpoints, s.A, s.B)
	}

	out := []segment{}
	for i, seg := range segs {
		l := dist(seg.A, seg.B)
		if l < tol {
			continue
		}
		cuts := []float64{}
		add := func(p Point) {
			t, d := closestOnSegment(p, seg.A, seg.B)
			along := t * l
			// Nur echte Zwischenpunkte -- die eigenen Enden teilen nichts.
			if d <= tol && along > tol && along < l-tol {
				cuts = append(cuts, along)
			}
		}
		for _, p := range endpoints {
			add(p)
		}
		for j, other := range segs {
			if i == j {
				continue
			}
			if x, ok := segmentIntersection(seg.A, seg.B, other.A, other.B); ok {
				add(x)
			}
		}
		sort.Float64s(cuts)

		dx, dy := (seg.B.X-seg.A.X)/l, (seg.B.Y-seg.A.Y)/l
		prev := 0.0
		for _, c := range cuts {
			if c-prev < tol {
				continue
			}
			out = append(out, segment{
				A: Point{seg.A.X + dx*prev, seg.A.Y + dy*prev},
				B: Point{seg.A.X + dx*c, seg.A.Y + dy*c},
			})
			prev = c
		}
		if l-prev > tol {
			out = append(out, segment{
				A: Point{seg.A.X + dx*prev, seg.A.Y + dy*prev},
				B: seg.B,
			})
		}
	}
	return out
}

type halfEdge struct {
	from, to int
	angle    float64
	visited  bool
}

// FindRooms findet die geschlossenen Raeume in einem Wandnetz.
//
// Die Wandmittellinien bilden einen planaren Graphen; jede innere Flaeche ist
// ein Raum. Ermittelt wird sie ueber Half-Edge-Traversal: an jedem Knoten wird
// immer die naechste Kante im Uhrzeigersinn genommen, dadurch laeuft man die
// minimalen Zyklen ab. Die Aussenflaeche faellt weg, weil sie als einzige den
// umgekehrten Umlaufsinn hat.
func FindRooms(walls []Wall, tol float64) []Room {
	segs := make([]segment, 0, len(walls))
	for _, w := range walls {
		segs = append(segs, segment{A: w.A, B: w.B})
	}
	noded := nodeSegments(segs, tol)

	nodes := []Point{}
	key := func(p Point) int {
		for i, n := range nodes {
			if dist(n, p) <= tol {
				return i
			}
		}
		nodes = append(nodes, p)
		return len(nodes) - 1
	}

	edges := []halfEdge{}
	outgoing := map[int][]int{}
	for _, s := range noded {
		from, to := key(s.A), key(s.B)
		if from == to {
			continue
		}
		for _, pair := range [2][2]int{{from, to}, {to, from}} {
			a, b := pair[0], pair[1]
			idx := len(edges)
			edges = append(edges, halfEdge{
				from:  a,
				to:    b,
				angle: math.Atan2(nodes[b].Y-nodes[a].Y, nodes[b].X-nodes[a].X),
			})
			outgoing[a] = append(outgoing[a], idx)
		}
	}
	for _, list := range outgoing {
		sort.Slice(list, func(i, j int) bool { return edges[list[i]].angle < edges[list[j]].angle })
	}

	twin := func(i int) int {
		if i%2 == 0 {
			return i + 1
		}
		return i - 1
	}

	next := func(idx int) int {
		he := edges[idx]
		list := outgoing[he.to]
		if len(list) == 0 {
			return -1
		}
		back := math.Atan2(nodes[he.from].Y-nodes[he.to].Y, nodes[he.from].X-nodes[he.to].X)
		best, bestDelta := -1, math.Inf(1)
		for _, cand := range list {
			delta := back - edges[cand].angle
			for delta <= eps {
				delta += 2 * math.Pi
			}
			if delta < bestDelta {
				bestDelta, best = delta, cand
			}
		}
		if best == -1 {
			return twin(idx) // Sackgasse: zurueck
		}
		return best
	}

	rooms := []Room{}
	for start := range edges {
		if edges[start].visited {
			continue
		}
		cycle := []int{}
		cur, guard := start, 0
		for !edges[cur].visited && guard < len(edges)+2 {
			guard++
			edges[cur].visited = true
			cycle = append(cycle, cur)
			cur = next(cur)
			if cur < 0 {
				break
			}
		}
		if len(cycle) < 3 {
			continue
		}
		pts := make([]Point, 0, len(cycle))
		for _, i := range cycle {
			pts = append(pts, nodes[edges[i].from])
		}
		area := PolygonArea(pts)
		// Nur Flaechen mit positivem Umlaufsinn sind Innenraeume; die
		// Aussenhuelle laeuft andersherum und wird verworfen.
		if area > 100 {
			rooms = append(rooms, Room{Points: pts, Area: area})
		}
	}
	return rooms
}

// WallSolid ist ein massives Stueck einer Wand zwischen den Oeffnungen.
type WallSolid struct {
	From, To    float64
	Bottom, Top float64
}

// WallSolids zerlegt eine Wand in ihre massiven Stuecke. Bruestung unter dem
// Fenster und Sturz darueber entstehen dabei von selbst -- ohne Boolesche
// Operationen auf Geometrie.
func WallSolids(w Wall, ops []Opening) []WallSolid {
	total := dist(w.A, w.B)
	height := w.HeightCm
	if height <= 0 {
		height = 250
	}

	type gap struct{ start, end, sill, top float64 }
	gaps := []gap{}
	for _, o := range ops {
		g := gap{
			start: math.Max(0, o.OffsetCm-o.WidthCm/2),
			end:   math.Min(total, o.OffsetCm+o.WidthCm/2),
			sill:  o.SillCm,
			top:   math.Min(height, o.SillCm+o.HeightCm),
		}
		if g.end > g.start {
			gaps = append(gaps, g)
		}
	}
	sort.Slice(gaps, func(i, j int) bool { return gaps[i].start < gaps[j].start })

	out := []WallSolid{}
	cursor := 0.0
	for _, g := range gaps {
		if g.start > cursor {
			out = append(out, WallSolid{cursor, g.start, 0, height})
		}
		if g.sill > 0 {
			out = append(out, WallSolid{g.start, g.end, 0, g.sill})
		}
		if g.top < height {
			out = append(out, WallSolid{g.start, g.end, g.top, height})
		}
		cursor = math.Max(cursor, g.end)
	}
	if cursor < total {
		out = append(out, WallSolid{cursor, total, 0, height})
	}
	return out
}
