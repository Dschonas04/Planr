package main

// Planr-Server: statische Auslieferung, Projekt-REST-API, Freigabe-Links und
// serverseitiger SVG-Export.
//
// Bis hierher lagen Grundrisse ausschliesslich im localStorage eines einzelnen
// Browsers. Wer den Browser wechselte oder den Speicher leerte, war die Arbeit
// los -- und teilen liess sich gar nichts.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const maxPlanBytes = 12 << 20 // Grundrisse mit vielen Moebeln bleiben darunter

type server struct {
	store  *Store
	static string
}

func logf(format string, args ...any) { log.Printf(format, args...) }

func main() {
	port := env("PORT", "8090")
	dataDir := env("PLANR_DATA", "data")
	staticDir := env("PLANR_STATIC", "dist")

	store, err := NewStore(dataDir)
	if err != nil {
		log.Fatalf("Datenverzeichnis %s nicht nutzbar: %v", dataDir, err)
	}
	s := &server{store: store, static: staticDir}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/api/projects", s.projects)
	mux.HandleFunc("/api/projects/", s.project)
	mux.HandleFunc("/api/shared/", s.shared)
	mux.Handle("/", s.spa())

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      60 * time.Second,
	}

	go func() {
		log.Printf("Planr laeuft auf http://localhost:%s (%d Projekt(e), Daten in %s)",
			port, len(store.List()), dataDir)
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

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func (s *server) spa() http.Handler {
	files := http.FileServer(http.Dir(s.static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(s.static, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(s.static, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "projects": len(s.store.List())})
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

func (s *server) projects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.List())

	case http.MethodPost:
		body, ok := readPlan(w, r)
		if !ok {
			return
		}
		meta, err := s.store.Create(body.Name, body.Plan)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen")
			return
		}
		writeJSON(w, http.StatusCreated, meta)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

// project bedient /api/projects/<id> sowie die Unterpfade /share und /svg.
func (s *server) project(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.Split(rest, "/")
	id := parts[0]
	if id == "" {
		writeErr(w, http.StatusNotFound, "Projekt unbekannt")
		return
	}
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}

	switch sub {
	case "share":
		s.share(w, r, id)
		return
	case "svg":
		s.svg(w, r, id)
		return
	case "":
	default:
		writeErr(w, http.StatusNotFound, "unbekannter Pfad")
		return
	}

	switch r.Method {
	case http.MethodGet:
		meta, ok := s.store.Meta(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		plan, err := s.store.Plan(id)
		if err != nil {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(map[string]any{"meta": meta, "plan": json.RawMessage(plan)})

	case http.MethodPut:
		body, ok := readPlan(w, r)
		if !ok {
			return
		}
		meta, err := s.store.Save(id, body.Name, body.Plan)
		if errors.Is(err, ErrNichtGefunden) {
			writeErr(w, http.StatusNotFound, "Projekt unbekannt")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen")
			return
		}
		writeJSON(w, http.StatusOK, meta)

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

func (s *server) share(w http.ResponseWriter, r *http.Request, id string) {
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
	// Kennung und Token gehoeren nicht in eine oeffentlich abrufbare Antwort.
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]any{
		"name":      meta.Name,
		"rooms":     meta.Rooms,
		"areaCm2":   meta.AreaCm2,
		"updatedAt": meta.UpdatedAt,
		"plan":      json.RawMessage(plan),
	})
}

func (s *server) svg(w http.ResponseWriter, r *http.Request, id string) {
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

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+safeName(meta.Name)+".svg\"")
	io.WriteString(w, RenderSVG(p, p.Levels[0]))
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
