package main

// PNG-Export ohne Browser.
//
// Das Gegenstueck im Editor zeichnet auf ein Canvas-Element und braucht ein
// geoeffnetes Fenster. Diese Fassung erzeugt dasselbe Bild serverseitig --
// damit laesst sich ein Grundriss verlinken, in eine Mail haengen oder aus
// einem Skript abrufen.
//
// Gerastert wird ueber golang.org/x/image/vector (kantengeglaettet), Text
// ueber die Bitmap-Schrift aus x/image. Beides sind offizielle
// Go-Erweiterungen, keine Fremdbibliotheken.

import (
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"math"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

var (
	pngBackground = color.RGBA{0xf5, 0xf3, 0xee, 0xff}
	pngWall       = color.RGBA{0x2f, 0x34, 0x38, 0xff}
	// NRGBA und nicht RGBA: color.RGBA ist in Go alpha-vormultipliziert,
	// dort waeren RGB-Werte oberhalb des Alphawerts ungueltig und die
	// Flaeche wuerde nahezu deckend statt zu 16 Prozent gezeichnet.
	pngRoom      = color.NRGBA{0x7e, 0xa0, 0xbe, 0x29} // 16 % Deckkraft
	pngRoomText  = color.RGBA{0x4a, 0x55, 0x60, 0xff}
	pngDimension = color.RGBA{0x7b, 0x87, 0x94, 0xff}
	pngOpening   = color.RGBA{0x3d, 0x6b, 0x8c, 0xff}
	pngFurnLine  = color.RGBA{0x4a, 0x4a, 0x4a, 0xff}
)

// canvasPx ist die Zeichenflaeche samt Abbildung von Zentimetern auf Pixel.
type canvasPx struct {
	img   *image.RGBA
	zoom  float64
	origX float64
	origY float64
}

func (c *canvasPx) pt(p Point) (float32, float32) {
	return float32((p.X - c.origX) * c.zoom), float32((p.Y - c.origY) * c.zoom)
}

// fillPolygon fuellt ein Polygon kantengeglaettet.
func (c *canvasPx) fillPolygon(pts []Point, col color.Color) {
	if len(pts) < 3 {
		return
	}
	b := c.img.Bounds()
	r := vector.NewRasterizer(b.Dx(), b.Dy())
	x, y := c.pt(pts[0])
	r.MoveTo(x, y)
	for _, p := range pts[1:] {
		x, y = c.pt(p)
		r.LineTo(x, y)
	}
	r.ClosePath()
	r.Draw(c.img, b, image.NewUniform(col), image.Point{})
}

// strokeLine zeichnet eine Linie als Rechteck der gewuenschten Staerke --
// der Rasterizer kennt nur Flaechen.
func (c *canvasPx) strokeLine(a, b Point, widthCm float64, col color.Color) {
	dx, dy := b.X-a.X, b.Y-a.Y
	l := math.Hypot(dx, dy)
	if l < eps {
		return
	}
	nx, ny := -dy/l*widthCm/2, dx/l*widthCm/2
	c.fillPolygon([]Point{
		{a.X + nx, a.Y + ny}, {b.X + nx, b.Y + ny},
		{b.X - nx, b.Y - ny}, {a.X - nx, a.Y - ny},
	}, col)
}

// text zeichnet mittig ueber dem Punkt. Die Schrift ist ein Bitmap-Satz in
// fester Groesse, deshalb wird sie nicht mitskaliert -- genau wie im Editor,
// wo Beschriftung ebenfalls in konstanter Pixelgroesse gezeichnet wird.
func (c *canvasPx) text(s string, at Point, col color.Color) {
	face := basicfont.Face7x13
	w := font.MeasureString(face, s).Round()
	px := int((at.X-c.origX)*c.zoom) - w/2
	py := int((at.Y-c.origY)*c.zoom) + face.Metrics().Ascent.Round()/2

	d := &font.Drawer{
		Dst:  c.img,
		Src:  image.NewUniform(col),
		Face: face,
		Dot:  fixed.P(px, py),
	}
	d.DrawString(s)
}

// RenderPNG zeichnet eine Ebene und schreibt sie als PNG.
//
// maxPx begrenzt die laengere Bildkante. Gerastert wird intern doppelt so
// gross und danach halbiert -- das glaettet auch die Bitmap-Schrift und die
// wenigen Stellen, an denen der Rasterizer harte Kanten hinterlaesst.
func RenderPNG(w io.Writer, p Project, l Level, maxPx int) error {
	if maxPx <= 0 {
		maxPx = 2000
	}
	const supersample = 2

	b := extent(l)
	wCm, hCm := b.MaxX-b.MinX, b.MaxY-b.MinY
	if wCm <= 0 || hCm <= 0 {
		wCm, hCm = 500, 500
	}
	zoom := math.Min(float64(maxPx)/wCm, float64(maxPx)/hCm) * supersample
	widthPx := int(wCm * zoom)
	heightPx := int(hCm * zoom)
	if widthPx < 2 || heightPx < 2 {
		widthPx, heightPx = 2, 2
	}

	c := &canvasPx{
		img:   image.NewRGBA(image.Rect(0, 0, widthPx, heightPx)),
		zoom:  zoom,
		origX: b.MinX,
		origY: b.MinY,
	}
	draw.Draw(c.img, c.img.Bounds(), image.NewUniform(pngBackground), image.Point{}, draw.Src)

	rooms := FindRooms(l.Walls, 1)
	for _, r := range rooms {
		c.fillPolygon(r.Points, pngRoom)
	}

	for _, wl := range l.Walls {
		if q := wallQuad(wl); q != nil {
			c.fillPolygon(q, pngWall)
		}
	}

	// Oeffnungen werden mit der Hintergrundfarbe ausgestanzt, danach kommt
	// das Symbol darueber -- dieselbe Reihenfolge wie im Editor.
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
		th := wl.ThicknessCm + 2
		for _, o := range ops {
			cx := wl.A.X + ux*o.OffsetCm
			cy := wl.A.Y + uy*o.OffsetCm
			half := o.WidthCm / 2
			a := Point{cx - ux*half, cy - uy*half}
			e := Point{cx + ux*half, cy + uy*half}
			c.strokeLine(a, e, th, pngBackground)

			if o.Type == "window" {
				c.strokeLine(a, e, 3/zoom*supersample*2, pngOpening)
			} else {
				swing := 1.0
				if o.Swing == -1 {
					swing = -1
				}
				// Tuerblatt senkrecht zur Wand
				nx, ny := -uy*swing*o.WidthCm, ux*swing*o.WidthCm
				c.strokeLine(a, Point{a.X + nx, a.Y + ny}, 3/zoom*supersample*2, pngOpening)
			}
		}
	}

	for _, f := range l.Furniture {
		col := parseHexColor(f.Color)
		corners := rectCorners(f.X, f.Y, f.WidthCm, f.DepthCm, f.RotationDeg*math.Pi/180)
		c.fillPolygon(corners, col)
		for i := range corners {
			c.strokeLine(corners[i], corners[(i+1)%len(corners)], 2/zoom*supersample*2, pngFurnLine)
		}
	}

	// Erst verkleinern, dann beschriften. Die Bitmap-Schrift hat eine feste
	// Groesse; wuerde sie mitverkleinert, waere sie unlesbar.
	out := downsample(c.img, supersample)
	labels := &canvasPx{img: out, zoom: zoom / supersample, origX: b.MinX, origY: b.MinY}

	for _, r := range rooms {
		labels.text(formatAreaASCII(math.Abs(r.Area)), PolygonCentroid(r.Points), pngRoomText)
	}
	for _, wl := range l.Walls {
		length := dist(wl.A, wl.B)
		if length < 20 {
			continue
		}
		mid := Point{(wl.A.X + wl.B.X) / 2, (wl.A.Y + wl.B.Y) / 2}
		labels.text(formatLength(length), Point{mid.X, mid.Y - 20}, pngDimension)
	}

	return png.Encode(w, out)
}

// formatAreaASCII gibt die Flaeche ohne hochgestelltes Zwei aus.
//
// basicfont.Face7x13 deckt nur ASCII ab; ein "²" wuerde als Ersatzzeichen
// erscheinen. SVG und DXF benutzen weiterhin die richtige Schreibweise, dort
// gibt es diese Einschraenkung nicht.
func formatAreaASCII(cm2 float64) string {
	return strings.Replace(formatArea(cm2), "m²", "m2", 1)
}

// downsample mittelt je factor x factor Pixel zu einem -- das ist die
// Kantenglaettung fuer alles, was der Rasterizer hart gezeichnet hat.
func downsample(src *image.RGBA, factor int) *image.RGBA {
	if factor <= 1 {
		return src
	}
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx()/factor, b.Dy()/factor))
	n := uint32(factor * factor)
	for y := dst.Bounds().Min.Y; y < dst.Bounds().Max.Y; y++ {
		for x := dst.Bounds().Min.X; x < dst.Bounds().Max.X; x++ {
			var r, g, bl, a uint32
			for dy := 0; dy < factor; dy++ {
				for dx := 0; dx < factor; dx++ {
					cr, cg, cb, ca := src.At(x*factor+dx, y*factor+dy).RGBA()
					r += cr >> 8
					g += cg >> 8
					bl += cb >> 8
					a += ca >> 8
				}
			}
			dst.Set(x, y, color.RGBA{uint8(r / n), uint8(g / n), uint8(bl / n), uint8(a / n)})
		}
	}
	return dst
}

// parseHexColor liest #rgb und #rrggbb; unbekannte Werte werden grau.
func parseHexColor(s string) color.RGBA {
	fallback := color.RGBA{0xa0, 0xa0, 0xa0, 0xff}
	if len(s) == 0 || s[0] != '#' {
		return fallback
	}
	hex := s[1:]
	if len(hex) == 3 {
		hex = string([]byte{hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]})
	}
	if len(hex) != 6 {
		return fallback
	}
	var v [3]uint8
	for i := 0; i < 3; i++ {
		hi, ok1 := hexVal(hex[i*2])
		lo, ok2 := hexVal(hex[i*2+1])
		if !ok1 || !ok2 {
			return fallback
		}
		v[i] = hi<<4 | lo
	}
	return color.RGBA{v[0], v[1], v[2], 0xff}
}

func hexVal(b byte) (uint8, bool) {
	switch {
	case b >= '0' && b <= '9':
		return b - '0', true
	case b >= 'a' && b <= 'f':
		return b - 'a' + 10, true
	case b >= 'A' && b <= 'F':
		return b - 'A' + 10, true
	}
	return 0, false
}
