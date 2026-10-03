package main

// Einzelplatz-Betrieb: Planr als Programm auf einem Rechner.
//
// Der Server laeuft dann nur auf 127.0.0.1 und kennt genau ein Konto, das
// beim ersten Start entsteht. Statt einer Anmeldung gibt es einen
// Zufallsschluessel: das Programmfenster ruft /lokal/start?s=<schluessel>
// auf, bekommt dafuer ein Cookie und ist damit berechtigt. Andere Programme
// auf demselben Rechner kennen den Schluessel nicht; fremde Webseiten
// scheitern zusaetzlich an der Host-Pruefung (DNS-Rebinding) und am
// CSRF-Kopf.

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const lokalCookie = "planr_lokal"

type einzelplatz struct {
	schluessel string
	konto      *Konto
	port       string
}

// einzelplatzEinrichten legt beim ersten Start das lokale Konto an. Ein leerer
// Schluessel wird zufaellig erzeugt.
func (s *server) einzelplatzEinrichten(schluessel string) error {
	var konto *Konto
	for _, k := range s.konten.Liste() {
		if k.Rolle == "admin" {
			konto, _ = s.konten.Konto(k.ID)
			break
		}
	}
	if konto == nil {
		k, err := s.konten.Anlegen("ich@planr.lokal", "Planr", zufall(24), "admin")
		if err != nil {
			return fmt.Errorf("lokales Konto nicht anlegbar: %w", err)
		}
		konto = k
	}
	if schluessel == "" {
		schluessel = zufall(24)
	}
	s.lokal = &einzelplatz{schluessel: schluessel, konto: konto, port: s.cfg.port}
	return nil
}

func (e *einzelplatz) hostErlaubt(host string) bool {
	h, port, err := net.SplitHostPort(host)
	if err != nil {
		return false
	}
	return (h == "127.0.0.1" || h == "localhost") && (e.port == "" || e.port == "0" || port == e.port)
}

func (e *einzelplatz) berechtigt(r *http.Request) bool {
	c, err := r.Cookie(lokalCookie)
	return err == nil && subtle.ConstantTimeCompare([]byte(c.Value), []byte(e.schluessel)) == 1
}

func (s *server) lokalStart(w http.ResponseWriter, r *http.Request) {
	if s.lokal == nil {
		http.NotFound(w, r)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("s")), []byte(s.lokal.schluessel)) != 1 {
		http.Error(w, "falscher Schluessel", http.StatusForbidden)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     lokalCookie,
		Value:    s.lokal.schluessel,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// dateiDialoge oeffnet die Sichern- und Oeffnen-Dialoge des Systems. Leerer
// Pfad ohne Fehler heisst: abgebrochen.
type dateiDialoge interface {
	Speichern(vorschlag string) (string, error)
	Oeffnen() (string, error)
}

var errKeinDialog = errors.New("Dateidialoge gibt es nur im Desktop-Programm")

func (s *server) desktopSpeichern(w http.ResponseWriter, r *http.Request) {
	if s.lokal == nil || kontoAus(r) == nil {
		writeErr(w, http.StatusNotFound, "nicht verfügbar")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "nur POST")
		return
	}
	var body struct {
		Name   string `json:"name"`
		Inhalt string `json:"inhalt"`
	}
	// Eigenes Limit: lies() erlaubt nur 64 KB, ein PDF-Plan ist größer.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 200<<20)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "Anfrage nicht lesbar")
		return
	}
	daten, err := base64.StdEncoding.DecodeString(body.Inhalt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Inhalt ist kein Base64")
		return
	}
	name := dateiname(body.Name)
	pfad, err := systemDialoge.Speichern(name)
	if err != nil {
		writeErr(w, http.StatusNotImplemented, err.Error())
		return
	}
	if pfad == "" {
		writeJSON(w, http.StatusOK, map[string]any{"abgebrochen": true})
		return
	}
	if err := os.WriteFile(pfad, daten, 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, "Datei nicht schreibbar: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pfad": kurzerPfad(pfad)})
}

func (s *server) desktopOeffnen(w http.ResponseWriter, r *http.Request) {
	if s.lokal == nil || kontoAus(r) == nil {
		writeErr(w, http.StatusNotFound, "nicht verfügbar")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "nur POST")
		return
	}
	pfad, err := systemDialoge.Oeffnen()
	if err != nil {
		writeErr(w, http.StatusNotImplemented, err.Error())
		return
	}
	if pfad == "" {
		writeJSON(w, http.StatusOK, map[string]any{"abgebrochen": true})
		return
	}
	info, err := os.Stat(pfad)
	if err != nil || info.Size() > maxPlanBytes {
		writeErr(w, http.StatusBadRequest, "Datei fehlt oder ist zu groß")
		return
	}
	daten, err := os.ReadFile(pfad)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":   filepath.Base(pfad),
		"inhalt": base64.StdEncoding.EncodeToString(daten),
	})
}

// dateiname macht aus einem Vorschlag der Oberflaeche einen harmlosen Namen.
func dateiname(roh string) string {
	n := filepath.Base(strings.TrimSpace(roh))
	n = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, n)
	if n == "" || n == "." || n == ".." {
		return "Planr-Export"
	}
	return n
}

func kurzerPfad(p string) string {
	if home, err := os.UserHomeDir(); err == nil && strings.HasPrefix(p, home) {
		return "~" + strings.TrimPrefix(p, home)
	}
	return p
}
