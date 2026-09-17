package main

// Schutzschicht vor allen Handlern.
//
//   - Sicherheits-Header: Planr laedt nichts von fremden Servern, also darf
//     die Seite das auch nicht. Die CSP haelt eingeschleustes Skript und
//     fremde Einbettung draussen.
//   - CSRF: Seit Projekte an einer Sitzung haengen, koennte eine fremde Seite
//     im Namen eines angemeldeten Browsers loeschen. Jede aendernde
//     API-Anfrage muss deshalb den Kopf X-Requested-With tragen. Ein Formular
//     kann ihn nicht setzen, und ein fremdes fetch() loest einen Preflight
//     aus, den dieser Dienst nie beantwortet.
//   - Bremse: je IP ein Eimer fuer die API und ein deutlich kleinerer fuer
//     Anmeldung und Registrierung. Das bremst Passwortraten und Fluten, ohne
//     normale Arbeit zu stoeren.
//   - Protokoll: Methode, Pfad, Status, Dauer. Bewusst ohne IP und ohne
//     Query -- IPs sind personenbezogen.

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const csrfKopf = "X-Requested-With"

var anfragenGesamt atomic.Int64

func sicherheitsKoepfe(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy",
		"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
			"img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "+
			"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
}

type protokollSchreiber struct {
	http.ResponseWriter
	status int
}

func (p *protokollSchreiber) WriteHeader(code int) {
	p.status = code
	p.ResponseWriter.WriteHeader(code)
}

func (p *protokollSchreiber) Flush() {
	if f, ok := p.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

type eimer struct {
	tokens  float64
	zuletzt time.Time
}

// Bremse ist ein Token-Eimer je Schluessel.
type Bremse struct {
	mu      sync.Mutex
	rate    float64 // Tokens je Sekunde
	fassung float64
	eimer   map[string]*eimer
}

func NeueBremse(proSekunde, fassung float64) *Bremse {
	b := &Bremse{rate: proSekunde, fassung: fassung, eimer: map[string]*eimer{}}
	go func() {
		for range time.Tick(time.Minute) {
			b.aufraeumen()
		}
	}()
	return b
}

func (b *Bremse) Erlaubt(schluessel string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	jetzt := time.Now()
	e, ok := b.eimer[schluessel]
	if !ok {
		e = &eimer{tokens: b.fassung, zuletzt: jetzt}
		b.eimer[schluessel] = e
	}
	e.tokens += jetzt.Sub(e.zuletzt).Seconds() * b.rate
	if e.tokens > b.fassung {
		e.tokens = b.fassung
	}
	e.zuletzt = jetzt
	if e.tokens < 1 {
		return false
	}
	e.tokens--
	return true
}

func (b *Bremse) aufraeumen() {
	b.mu.Lock()
	defer b.mu.Unlock()
	grenze := time.Now().Add(-10 * time.Minute)
	for k, e := range b.eimer {
		if e.zuletzt.Before(grenze) {
			delete(b.eimer, k)
		}
	}
}

// clientIP nimmt X-Forwarded-For nur ernst, wenn der Dienst ausdruecklich
// hinter einem Proxy steht. Sonst koennte jeder die Bremse umgehen, indem er
// den Kopf selbst setzt.
func (s *server) clientIP(r *http.Request) string {
	if s.cfg.hinterProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return strings.TrimSpace(xr)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// istHTTPS entscheidet ueber das Secure-Attribut des Cookies.
func (s *server) istHTTPS(r *http.Request) bool {
	if r.TLS != nil || s.cfg.sicheresCookie {
		return true
	}
	return s.cfg.hinterProxy && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func aendernd(methode string) bool {
	switch methode {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

func (s *server) schutz(weiter http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		anfragenGesamt.Add(1)
		sicherheitsKoepfe(w)
		pw := &protokollSchreiber{ResponseWriter: w, status: http.StatusOK}

		if strings.HasPrefix(r.URL.Path, "/api/") {
			if !s.apiBremse.Erlaubt(s.clientIP(r)) {
				writeErr(pw, http.StatusTooManyRequests, "Zu viele Anfragen. Bitte kurz warten.")
				s.protokoll(r, pw.status, start)
				return
			}
			if aendernd(r.Method) && r.Header.Get(csrfKopf) != "planr" {
				writeErr(pw, http.StatusForbidden, "Anfrage ohne Planr-Kennung abgelehnt.")
				s.protokoll(r, pw.status, start)
				return
			}
		}

		weiter.ServeHTTP(pw, r)
		s.protokoll(r, pw.status, start)
	})
}

func (s *server) protokoll(r *http.Request, status int, start time.Time) {
	if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/assets/") {
		return
	}
	logf("%s %s %d %s", r.Method, r.URL.Path, status, time.Since(start).Round(time.Millisecond))
}
