package main

// Projektablage.
//
// Ein Projekt ist eine JSON-Datei mit dem Grundriss, dazu ein Index mit Namen
// und Zeitstempeln. Bewusst keine Datenbank: die Datenmenge ist klein, und ein
// Verzeichnis mit lesbaren Dateien laesst sich sichern, kopieren und im
// Zweifel von Hand reparieren.
//
// Geschrieben wird immer erst in eine temporaere Datei und dann umbenannt.
// os.Rename ist auf einem POSIX-Dateisystem atomar -- ein Absturz mitten im
// Schreiben kann so keinen halben Grundriss hinterlassen.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrNichtGefunden = errors.New("Projekt unbekannt")

type ProjectMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	// ShareToken ist leer, solange nicht geteilt wurde. Nach aussen wird er
	// nur beim Anlegen und in der Einzelansicht ausgegeben, nie in der Liste.
	ShareToken string `json:"shareToken,omitempty"`
	Rooms      int    `json:"rooms"`
	AreaCm2    int64  `json:"areaCm2"`
}

type Store struct {
	mu       sync.RWMutex
	dir      string
	projects map[string]*ProjectMeta
	byToken  map[string]string // Freigabe-Token -> Projekt-ID
}

var unsafeID = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func NewStore(dir string) (*Store, error) {
	s := &Store{dir: dir, projects: map[string]*ProjectMeta{}, byToken: map[string]string{}}
	if err := os.MkdirAll(filepath.Join(dir, "projects"), 0o755); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(s.indexFile())
	if err == nil {
		var idx struct {
			Projects []*ProjectMeta `json:"projects"`
		}
		if json.Unmarshal(raw, &idx) == nil {
			for _, p := range idx.Projects {
				if p == nil || p.ID == "" {
					continue
				}
				s.projects[p.ID] = p
				if p.ShareToken != "" {
					s.byToken[p.ShareToken] = p.ID
				}
			}
		}
	}
	return s, nil
}

func (s *Store) indexFile() string { return filepath.Join(s.dir, "index.json") }

// projectFile reduziert die ID auf unbedenkliche Zeichen. Ohne das koennte
// eine praeparierte ID aus dem Datenverzeichnis herausfuehren.
func (s *Store) projectFile(id string) string {
	return filepath.Join(s.dir, "projects", unsafeID.ReplaceAllString(id, "")+".json")
}

func writeAtomic(path string, data []byte) error {
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func token(n int) string {
	buf := make([]byte, n)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

// persistIndex erwartet, dass der Aufrufer die Sperre haelt.
func (s *Store) persistIndex() {
	list := make([]*ProjectMeta, 0, len(s.projects))
	for _, p := range s.projects {
		list = append(list, p)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt < list[j].CreatedAt })
	raw, err := json.MarshalIndent(struct {
		Projects []*ProjectMeta `json:"projects"`
	}{list}, "", "  ")
	if err != nil {
		return
	}
	if err := writeAtomic(s.indexFile(), raw); err != nil {
		logf("Index konnte nicht geschrieben werden: %v", err)
	}
}

// List gibt die Uebersicht ohne Freigabe-Token aus -- der gehoert nicht in
// eine Liste, die jeder abrufen kann.
func (s *Store) List() []ProjectMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ProjectMeta, 0, len(s.projects))
	for _, p := range s.projects {
		m := *p
		m.ShareToken = ""
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *Store) Meta(id string) (ProjectMeta, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.projects[id]
	if !ok {
		return ProjectMeta{}, false
	}
	return *p, true
}

func (s *Store) Create(name string, plan json.RawMessage) (ProjectMeta, error) {
	now := time.Now().UnixMilli()
	meta := &ProjectMeta{ID: token(4), Name: trim(name, 120), CreatedAt: now, UpdatedAt: now}
	stats(plan, meta)

	if err := writeAtomic(s.projectFile(meta.ID), plan); err != nil {
		return ProjectMeta{}, err
	}
	s.mu.Lock()
	s.projects[meta.ID] = meta
	s.persistIndex()
	s.mu.Unlock()
	return *meta, nil
}

func (s *Store) Save(id, name string, plan json.RawMessage) (ProjectMeta, error) {
	s.mu.Lock()
	p, ok := s.projects[id]
	if !ok {
		s.mu.Unlock()
		return ProjectMeta{}, ErrNichtGefunden
	}
	if name != "" {
		p.Name = trim(name, 120)
	}
	p.UpdatedAt = time.Now().UnixMilli()
	stats(plan, p)
	meta := *p
	s.persistIndex()
	s.mu.Unlock()

	if err := writeAtomic(s.projectFile(id), plan); err != nil {
		return ProjectMeta{}, err
	}
	return meta, nil
}

func (s *Store) Plan(id string) (json.RawMessage, error) {
	if _, ok := s.Meta(id); !ok {
		return nil, ErrNichtGefunden
	}
	raw, err := os.ReadFile(s.projectFile(id))
	if err != nil {
		return nil, ErrNichtGefunden
	}
	return raw, nil
}

func (s *Store) Remove(id string) bool {
	s.mu.Lock()
	p, ok := s.projects[id]
	if !ok {
		s.mu.Unlock()
		return false
	}
	if p.ShareToken != "" {
		delete(s.byToken, p.ShareToken)
	}
	delete(s.projects, id)
	s.persistIndex()
	s.mu.Unlock()
	os.Remove(s.projectFile(id))
	return true
}

// Share legt einen Freigabe-Token an oder gibt den bestehenden zurueck.
func (s *Store) Share(id string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.projects[id]
	if !ok {
		return "", false
	}
	if p.ShareToken == "" {
		p.ShareToken = token(16)
		s.byToken[p.ShareToken] = id
		s.persistIndex()
	}
	return p.ShareToken, true
}

func (s *Store) Unshare(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.projects[id]
	if !ok || p.ShareToken == "" {
		return false
	}
	delete(s.byToken, p.ShareToken)
	p.ShareToken = ""
	s.persistIndex()
	return true
}

func (s *Store) ByToken(t string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.byToken[t]
	return id, ok
}

// stats liest Raumzahl und Flaeche aus dem Plan, damit die Uebersicht sie
// anzeigen kann, ohne jede Datei zu oeffnen. Fehlerhafte Plaene fuehren zu
// Nullwerten, nicht zu einem Abbruch.
func stats(plan json.RawMessage, meta *ProjectMeta) {
	var p Project
	if json.Unmarshal(plan, &p) != nil || len(p.Levels) == 0 {
		meta.Rooms, meta.AreaCm2 = 0, 0
		return
	}
	rooms := FindRooms(p.Levels[0].Walls, 1)
	var area float64
	for _, r := range rooms {
		area += abs(r.Area)
	}
	meta.Rooms = len(rooms)
	meta.AreaCm2 = int64(area)
}

func trim(s string, max int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		s = "Unbenanntes Projekt"
	}
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}
