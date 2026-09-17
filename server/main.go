package main

// Planr-Server: statische Auslieferung, Konten, Projekt-REST-API,
// Freigabe-Links und serverseitiger Export.
//
// Bis zur Fassung 0.x lagen Grundrisse ausschliesslich im localStorage eines
// einzelnen Browsers, und die API war fuer jeden offen, der den Dienst
// erreichte. Jetzt gehoert jedes Projekt einem Konto; geteilte Grundrisse
// sind ueber einen widerrufbaren Link nur lesend abrufbar.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// version wird beim Bauen gesetzt: -ldflags "-X main.version=1.0.0".
var version = "dev"

const maxPlanBytes = 12 << 20 // Grundrisse mit vielen Moebeln bleiben darunter

type config struct {
	port, daten, static string
	registrierungOffen  bool
	hinterProxy         bool
	sicheresCookie      bool
	metriken            bool
	sitzungTage         int
}

func ladeConfig() config {
	tage, err := strconv.Atoi(env("PLANR_SITZUNG_TAGE", "14"))
	if err != nil || tage < 1 {
		tage = 14
	}
	return config{
		port:               env("PORT", "8090"),
		daten:              env("PLANR_DATA", "data"),
		static:             env("PLANR_STATIC", "dist"),
		registrierungOffen: ja(env("PLANR_REGISTRIERUNG", "geschlossen"), "offen"),
		hinterProxy:        ja(env("PLANR_HINTER_PROXY", "nein"), "ja"),
		sicheresCookie:     ja(env("PLANR_SICHERES_COOKIE", "nein"), "ja"),
		metriken:           ja(env("PLANR_METRIKEN", "nein"), "ja"),
		sitzungTage:        tage,
	}
}

func ja(wert, erwartet string) bool {
	w := strings.ToLower(strings.TrimSpace(wert))
	return w == erwartet || w == "true" || w == "1" || (erwartet == "ja" && w == "yes")
}

type server struct {
	cfg           config
	store         *Store
	konten        *Konten
	apiBremse     *Bremse
	anmeldeBremse *Bremse
}

func logf(format string, args ...any) { log.Printf(format, args...) }

func neuerServer(cfg config) (*server, error) {
	store, err := NewStore(cfg.daten)
	if err != nil {
		return nil, fmt.Errorf("Datenverzeichnis %s nicht nutzbar: %w", cfg.daten, err)
	}
	konten, err := NeueKonten(cfg.daten, time.Duration(cfg.sitzungTage)*24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("Konten nicht lesbar: %w", err)
	}
	return &server{
		cfg:           cfg,
		store:         store,
		konten:        konten,
		apiBremse:     NeueBremse(20, 120),
		anmeldeBremse: NeueBremse(1.0/6, 10),
	}, nil
}

func main() {
	cfg := ladeConfig()
	s, err := neuerServer(cfg)
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           s.routen(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      60 * time.Second,
	}

	go func() {
		log.Printf("Planr %s laeuft auf http://localhost:%s (%d Projekt(e), %d Konto/Konten, Registrierung %s)",
			version, cfg.port, len(s.store.List()), s.konten.Anzahl(),
			map[bool]string{true: "offen", false: "geschlossen"}[cfg.registrierungOffen])
		if s.konten.Anzahl() == 0 {
			log.Printf("Noch kein Konto: das erste, das sich registriert, wird Administrator.")
		}
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server beendet: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("beendet")
}

func (s *server) routen() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	if s.cfg.metriken {
		mux.HandleFunc("/metrics", s.metrics)
	}
	mux.HandleFunc("/api/status", s.status)
	mux.HandleFunc("/api/registrierung", s.registrierung)
	mux.HandleFunc("/api/anmeldung", s.anmeldung)
	mux.HandleFunc("/api/abmeldung", s.abmeldung)
	mux.HandleFunc("/api/konto", s.kontoAPI)
	mux.HandleFunc("/api/konto/passwort", s.kontoPasswort)
	mux.HandleFunc("/api/konto/export", s.kontoExport)
	mux.HandleFunc("/api/admin/konten", s.nurAdmin(s.adminKonten))
	mux.HandleFunc("/api/admin/konten/", s.nurAdmin(s.adminKonto))
	mux.HandleFunc("/api/admin/sicherung", s.nurAdmin(s.sicherung))
	mux.HandleFunc("/api/rechtliches/", s.rechtliches)

	mux.HandleFunc("/api/projects", s.projects)
	mux.HandleFunc("/api/projects/", s.project)
	mux.HandleFunc("/api/shared/", s.shared)
	mux.HandleFunc("/api/import", s.importFile)
	mux.HandleFunc("/api/validate", s.validate)
	mux.Handle("/", s.spa())
	return s.schutz(s.mitSitzung(mux))
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func (s *server) spa() http.Handler {
	files := http.FileServer(http.Dir(s.cfg.static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(s.cfg.static, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(s.cfg.static, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": version})
}

func (s *server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP planr_konten Anzahl der Konten\n# TYPE planr_konten gauge\nplanr_konten %d\n", s.konten.Anzahl())
	fmt.Fprintf(w, "# HELP planr_projekte Anzahl der Projekte\n# TYPE planr_projekte gauge\nplanr_projekte %d\n", len(s.store.List()))
	fmt.Fprintf(w, "# HELP planr_anfragen_gesamt HTTP-Anfragen seit dem Start\n# TYPE planr_anfragen_gesamt counter\nplanr_anfragen_gesamt %d\n", anfragenGesamt.Load())
}

type planBody struct {
	Name string          `json:"name"`
	Plan json.RawMessage `json:"plan"`
}

// readPlan liest den Rumpf und stellt sicher, dass der Grundriss ueberhaupt
// auswertbar ist -- eine kaputte Datei soll gar nicht erst in die Ablage.
func readPlan(w http.ResponseWriter, r *http.Request) (planBody, bool) {
	var body planBody
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxPlanBytes))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "Anfrage nicht lesbar")
		return planBody{}, false
	}
	if len(body.Plan) == 0 {
		writeErr(w, http.StatusBadRequest, "Grundriss fehlt")
		return planBody{}, false
	}
	var probe Project
	if json.Unmarshal(body.Plan, &probe) != nil || len(probe.Levels) == 0 {
		writeErr(w, http.StatusBadRequest, "Grundriss enthält keine Ebene")
		return planBody{}, false
	}
	return body, true
}

// projektSicht ist, was ein Konto von einem Projekt zu sehen bekommt.
type projektSicht struct {
	ProjectMeta
	Eigen    bool   `json:"eigen"`
	Geteilt  bool   `json:"geteilt"`
	Besitzer string `json:"besitzer,omitempty"`
}

func (s *server) sicht(p ProjectMeta, k *Konto) projektSicht {
	v := projektSicht{ProjectMeta: p, Eigen: p.Owner == k.ID, Geteilt: p.ShareToken != ""}
	v.Owner = ""
	if !v.Eigen && s.konten != nil {
		if besitzer, ok := s.konten.Konto(p.Owner); ok {
			v.Besitzer = besitzer.Name
		} else {
			v.Besitzer = "–"
		}
	}
	return v
}

func darf(k *Konto, p ProjectMeta) bool {
	return k != nil && (p.Owner == k.ID || k.Rolle == RolleAdmin)
}

func (s *server) projects(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	if k == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		out := []projektSicht{}
		for _, p := range s.store.Alle() {
			if darf(k, p) {
				// Der Freigabe-Token steht nie in der Liste, nur in der
				// Einzelansicht des Projekts.
				v := s.sicht(p, k)
				v.ShareToken = ""
				out = append(out, v)
			}
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		body, ok := readPlan(w, r)
		if !ok {
			return
		}
		meta, err := s.store.Create(body.Name, k.ID, body.Plan)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen")
			return
		}
		writeJSON(w, http.StatusCreated, s.sicht(meta, k))

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

// project bedient /api/projects/<id> sowie die Unterpfade /share und die
// Exportformate.
func (s *server) project(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	if k == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(rest, "/")
	id := parts[0]
	meta, ok := s.store.Meta(id)
	// Fremde Projekte melden dasselbe wie unbekannte.
	if id == "" || !ok || !darf(k, meta) {
		writeErr(w, http.StatusNotFound, "Projekt unbekannt")
		return
	}
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}

	switch sub {
	case "share":
		s.share(w, r, k, id)
		return
	case "svg", "png", "dxf", "planr":
		s.export(w, r, id, sub)
		return
	case "":
	default:
		writeErr(w, http.StatusNotFound, "unbekannter Pfad")
		return
	}

	switch r.Method {
	case http.MethodGet:
		plan, err := s.store.Plan(id)
		if err != nil {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]any{"meta": s.sicht(meta, k), "plan": json.RawMessage(plan)})

	case http.MethodPut:
		body, ok := readPlan(w, r)
		if !ok {
			return
		}
		neu, err := s.store.Save(id, body.Name, body.Plan)
		if errors.Is(err, ErrNichtGefunden) {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen")
			return
		}
		writeJSON(w, http.StatusOK, s.sicht(neu, k))

	case http.MethodDelete:
		if !s.store.Remove(id) {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

func (s *server) share(w http.ResponseWriter, r *http.Request, k *Konto, id string) {
	switch r.Method {
	case http.MethodPost:
		t, ok := s.store.Share(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": t, "url": "/#/geteilt/" + t})

	case http.MethodDelete:
		if !s.store.Unshare(id) {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt oder nicht geteilt")
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

// shared liefert einen geteilten Grundriss nur lesend aus. Der Token ist die
// einzige Berechtigung -- deshalb ist er 32 Zeichen lang und wird nie in der
// Projektliste ausgegeben.
func (s *server) shared(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	t := strings.TrimPrefix(r.URL.Path, "/api/shared/")
	id, ok := s.store.ByToken(t)
	if !ok {
		writeErr(w, http.StatusNotFound, "Link unbekannt oder zurückgezogen")
		return
	}
	meta, _ := s.store.Meta(id)
	plan, err := s.store.Plan(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "Projekt unbekannt")
		return
	}
	// Kennung, Token und Eigentuemer gehoeren nicht in eine oeffentlich
	// abrufbare Antwort.
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"name":      meta.Name,
		"rooms":     meta.Rooms,
		"areaCm2":   meta.AreaCm2,
		"updatedAt": meta.UpdatedAt,
		"plan":      json.RawMessage(plan),
	})
}

// export bedient alle Ausgabeformate ueber denselben Weg -- Laden, Pruefen
// und Benennen sind fuer alle gleich, nur das Schreiben unterscheidet sich.
func (s *server) export(w http.ResponseWriter, r *http.Request, id, format string) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	plan, err := s.store.Plan(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "Projekt unbekannt")
		return
	}
	var p Project
	if json.Unmarshal(plan, &p) != nil || len(p.Levels) == 0 {
		writeErr(w, http.StatusUnprocessableEntity, "Grundriss nicht auswertbar")
		return
	}
	meta, _ := s.store.Meta(id)
	name := safeName(meta.Name)

	switch format {
	case "svg":
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".svg\"")
		io.WriteString(w, RenderSVG(p, p.Levels[0]))

	case "png":
		size := 2000
		if v := r.URL.Query().Get("size"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				// Nach oben begrenzt: ein Bild mit 20000 Pixel Kantenlaenge
				// wuerde den Dienst minutenlang beschaeftigen.
				size = clamp(n, 200, 6000)
			}
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".png\"")
		if err := RenderPNG(w, p, p.Levels[0], size); err != nil {
			logf("PNG fuer %s fehlgeschlagen: %v", id, err)
		}

	case "dxf":
		w.Header().Set("Content-Type", "application/dxf")
		w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".dxf\"")
		if err := RenderDXF(w, p, p.Levels[0]); err != nil {
			logf("DXF fuer %s fehlgeschlagen: %v", id, err)
		}

	case "planr":
		raw, err := Wrap(plan)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Datei konnte nicht erzeugt werden")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\""+name+".planr.json\"")
		w.Write(raw)
	}
}

// importFile nimmt eine .planr-Datei oder eine nackte Projekt-JSON entgegen
// und legt daraus ein neues Projekt an. Bewusst immer ein neues -- ein Import,
// der stillschweigend etwas Bestehendes ueberschreibt, ist eine Falle.
func (s *server) importFile(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	if k == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPlanBytes))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "Datei zu groß")
		return
	}
	plan, err := Unwrap(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if maengel := Validate(plan); len(maengel) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "Grundriss enthält Fehler",
			"issues": maengel,
		})
		return
	}

	name := r.URL.Query().Get("name")
	if name == "" {
		var p Project
		json.Unmarshal(plan, &p)
		name = p.Name
	}
	meta, err := s.store.Create(name, k.ID, plan)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen")
		return
	}
	writeJSON(w, http.StatusCreated, s.sicht(meta, k))
}

// validate prueft einen Grundriss, ohne ihn zu speichern.
func (s *server) validate(w http.ResponseWriter, r *http.Request) {
	if kontoAus(r) == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPlanBytes))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "Datei zu groß")
		return
	}
	plan, err := Unwrap(raw)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "issues": []string{err.Error()}})
		return
	}
	maengel := Validate(plan)
	writeJSON(w, http.StatusOK, map[string]any{"ok": len(maengel) == 0, "issues": maengel})
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func safeName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('-')
		}
	}
	if b.Len() == 0 {
		return "grundriss"
	}
	return b.String()
}
