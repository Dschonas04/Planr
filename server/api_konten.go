package main

// HTTP-Schnittstelle fuer Konten: Einrichtung, Anmeldung, das eigene Konto
// und die Verwaltung durch Administratoren.
//
// Die Sitzung wird einmal vorne gelesen und haengt danach am Request-Kontext.
// Jeder Handler fragt kontoAus(r) -- auch die Projekt-Handler selbst, nicht
// nur eine Schicht davor. So bleibt ein Handler geschuetzt, egal von wo aus er
// aufgerufen wird.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const sitzungsCookie = "planr_sitzung"

type kontextSchluessel struct{}

func kontoAus(r *http.Request) *Konto {
	k, _ := r.Context().Value(kontextSchluessel{}).(*Konto)
	return k
}

func mitKonto(r *http.Request, k *Konto) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), kontextSchluessel{}, k))
}

func (s *server) mitSitzung(weiter http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sitzungsCookie); err == nil {
			if k, ok := s.konten.SitzungKonto(c.Value); ok {
				r = mitKonto(r, k)
			}
		}
		weiter.ServeHTTP(w, r)
	})
}

func (s *server) setzeCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: sitzungsCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: s.istHTTPS(r), SameSite: http.SameSiteLaxMode, MaxAge: s.cfg.sitzungTage * 24 * 3600,
	})
}

func (s *server) loescheCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sitzungsCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: s.istHTTPS(r), SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

func (s *server) nurAdmin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		k := kontoAus(r)
		if k == nil {
			writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
			return
		}
		if k.Rolle != RolleAdmin {
			writeErr(w, http.StatusForbidden, "Nur für Administratoren.")
			return
		}
		h(w, r)
	}
}

func lies(w http.ResponseWriter, r *http.Request, ziel any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(ziel); err != nil {
		writeErr(w, http.StatusBadRequest, "Anfrage nicht lesbar")
		return false
	}
	return true
}

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	anzahl := s.konten.Anzahl()
	_, impressum := s.rechtstext("impressum")
	antwort := map[string]any{
		"version":       version,
		"einrichtung":   anzahl == 0,
		"registrierung": anzahl == 0 || s.cfg.registrierungOffen,
		"impressum":     impressum,
	}
	if k := kontoAus(r); k != nil {
		antwort["konto"] = k.Sicht()
	}
	writeJSON(w, http.StatusOK, antwort)
}

func (s *server) registrierung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	if !s.anmeldeBremse.Erlaubt("reg:" + s.clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "Zu viele Versuche. Bitte warte eine Minute.")
		return
	}
	if s.konten.Anzahl() > 0 && !s.cfg.registrierungOffen {
		writeErr(w, http.StatusForbidden, "Die Registrierung ist geschlossen. Konten legt ein Administrator an.")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Passwort string `json:"passwort"`
	}
	if !lies(w, r, &body) {
		return
	}
	k, err := s.konten.Anlegen(body.Email, body.Name, body.Passwort, RolleNutzer)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if k.Rolle == RolleAdmin {
		if n := s.store.WaisenZuordnen(k.ID); n > 0 {
			logf("%d Projekt(e) ohne Eigentuemer dem ersten Administrator zugeordnet", n)
		}
	}
	s.setzeCookie(w, r, s.konten.SitzungAnlegen(k.ID))
	writeJSON(w, http.StatusCreated, k.Sicht())
}

func (s *server) anmeldung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Passwort string `json:"passwort"`
	}
	if !lies(w, r, &body) {
		return
	}
	if !s.anmeldeBremse.Erlaubt("ip:"+s.clientIP(r)) ||
		!s.anmeldeBremse.Erlaubt("mail:"+strings.ToLower(strings.TrimSpace(body.Email))) {
		writeErr(w, http.StatusTooManyRequests, "Zu viele Anmeldeversuche. Bitte warte eine Minute.")
		return
	}
	k, err := s.konten.Pruefen(body.Email, body.Passwort)
	if err != nil {
		code := http.StatusUnauthorized
		if errors.Is(err, ErrKontoGesperrt) {
			code = http.StatusForbidden
		}
		writeErr(w, code, err.Error())
		return
	}
	s.setzeCookie(w, r, s.konten.SitzungAnlegen(k.ID))
	writeJSON(w, http.StatusOK, k.Sicht())
}

func (s *server) abmeldung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	if c, err := r.Cookie(sitzungsCookie); err == nil {
		s.konten.SitzungBeenden(c.Value)
	}
	s.loescheCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) kontoAPI(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	if k == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, k.Sicht())

	case http.MethodPatch:
		var body struct {
			Name string `json:"name"`
		}
		if !lies(w, r, &body) {
			return
		}
		neu, err := s.konten.NameSetzen(k.ID, body.Name)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, neu.Sicht())

	case http.MethodDelete:
		var body struct {
			Passwort string `json:"passwort"`
		}
		if !lies(w, r, &body) {
			return
		}
		if _, err := s.konten.Pruefen(k.Email, body.Passwort); err != nil {
			writeErr(w, http.StatusForbidden, "Das Passwort stimmt nicht.")
			return
		}
		if err := s.konten.Loeschen(k.ID); err != nil {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		for _, p := range s.store.VonKonto(k.ID) {
			s.store.Remove(p.ID)
		}
		s.loescheCookie(w, r)
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

func (s *server) kontoPasswort(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	if k == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	var body struct {
		Alt string `json:"alt"`
		Neu string `json:"neu"`
	}
	if !lies(w, r, &body) {
		return
	}
	behalte := ""
	if c, err := r.Cookie(sitzungsCookie); err == nil {
		behalte = c.Value
	}
	if err := s.konten.PasswortAendern(k.ID, body.Alt, body.Neu, behalte); err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, ErrPasswortFalsch) {
			code = http.StatusForbidden
		}
		writeErr(w, code, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// kontoExport liefert alle Daten eines Kontos als Datei (Art. 15 und 20
// DSGVO): die Kontoangaben und jedes eigene Projekt samt Grundriss.
func (s *server) kontoExport(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	if k == nil {
		writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
		return
	}
	type exportProjekt struct {
		Name      string          `json:"name"`
		CreatedAt int64           `json:"createdAt"`
		UpdatedAt int64           `json:"updatedAt"`
		Geteilt   bool            `json:"geteilt"`
		Grundriss json.RawMessage `json:"grundriss"`
	}
	projekte := []exportProjekt{}
	for _, p := range s.store.VonKonto(k.ID) {
		plan, err := s.store.Plan(p.ID)
		if err != nil {
			continue
		}
		projekte = append(projekte, exportProjekt{Name: p.Name, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, Geteilt: p.ShareToken != "", Grundriss: plan})
	}
	w.Header().Set("Content-Disposition", `attachment; filename="planr-meine-daten-`+time.Now().Format("2006-01-02")+`.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"exportiert": time.Now().Format(time.RFC3339),
		"konto": map[string]any{
			"email": k.Email, "name": k.Name, "rolle": k.Rolle, "angelegt": time.UnixMilli(k.Angelegt).Format(time.RFC3339),
		},
		"projekte": projekte,
	})
}

type adminKontoSicht struct {
	KontoSicht
	Projekte int `json:"projekte"`
}

func (s *server) adminKonten(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		zaehler := map[string]int{}
		for _, p := range s.store.Alle() {
			zaehler[p.Owner]++
		}
		out := []adminKontoSicht{}
		for _, konto := range s.konten.Liste() {
			out = append(out, adminKontoSicht{KontoSicht: konto, Projekte: zaehler[konto.ID]})
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		var body struct {
			Email    string `json:"email"`
			Name     string `json:"name"`
			Passwort string `json:"passwort"`
			Rolle    string `json:"rolle"`
		}
		if !lies(w, r, &body) {
			return
		}
		if body.Rolle == "" {
			body.Rolle = RolleNutzer
		}
		neu, err := s.konten.Anlegen(body.Email, body.Name, body.Passwort, body.Rolle)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, neu.Sicht())

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

func (s *server) adminKonto(w http.ResponseWriter, r *http.Request) {
	k := kontoAus(r)
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/konten/")
	ziel, ok := s.konten.Konto(id)
	if id == "" || !ok {
		writeErr(w, http.StatusNotFound, "Konto unbekannt")
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var body struct {
			Rolle    *string `json:"rolle"`
			Gesperrt *bool   `json:"gesperrt"`
			Passwort string  `json:"passwort"`
		}
		if !lies(w, r, &body) {
			return
		}
		if body.Passwort != "" {
			if err := s.konten.PasswortSetzen(id, body.Passwort); err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if body.Rolle != nil || body.Gesperrt != nil {
			if _, err := s.konten.Aendern(id, body.Rolle, body.Gesperrt); err != nil {
				writeErr(w, http.StatusConflict, err.Error())
				return
			}
		}
		neu, _ := s.konten.Konto(id)
		writeJSON(w, http.StatusOK, neu.Sicht())

	case http.MethodDelete:
		if id == k.ID {
			writeErr(w, http.StatusConflict, "Das eigene Konto löschst du unter „Konto“.")
			return
		}
		loeschen := r.URL.Query().Get("projekte") == "loeschen"
		if err := s.konten.Loeschen(id); err != nil {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		if loeschen {
			for _, p := range s.store.VonKonto(ziel.ID) {
				s.store.Remove(p.ID)
			}
		} else {
			s.store.Uebertragen(ziel.ID, k.ID)
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}
