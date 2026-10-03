//go:build desktop

package main

// Desktop-Fassung: Planr als Programm mit eigenem Fenster.
//
// Der Server startet auf einer freien Loopback-Adresse, die Oberflaeche ist
// ins Programm eingebettet, und ein WebKit-Fenster (webview) zeigt sie an.
// Projekte liegen unter ~/Library/Application Support/Planr. Schliesst man
// das Fenster, beendet sich das Programm.

import (
	"context"
	"embed"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	webview "github.com/webview/webview_go"
)

//go:embed all:web
var eingebettet embed.FS

func init() { desktopStart = desktopFenster }

func datenVerzeichnis() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "Planr")
}

func protokollOeffnen() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	dir := filepath.Join(home, "Library", "Logs", "Planr")
	if os.MkdirAll(dir, 0o755) != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "planr.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
}

func desktopFenster() {
	protokollOeffnen()
	dir := datenVerzeichnis()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Fatalf("Datenverzeichnis %s: %v", dir, err)
	}
	web, err := fs.Sub(eingebettet, "web")
	if err != nil {
		log.Fatal(err)
	}

	// Fester Port, wenn frei: WebKit trennt seinen Speicher nach Herkunft, und
	// mit wechselndem Port sähe jedes Fenster einen leeren localStorage.
	ln, err := net.Listen("tcp", "127.0.0.1:47811")
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		log.Fatalf("Kein freier Port: %v", err)
	}
	port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)

	s, err := neuerServer(config{port: port, daten: dir, staticFS: web, sitzungTage: 3650})
	if err != nil {
		log.Fatal(err)
	}
	if err := s.einzelplatzEinrichten(""); err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Handler: s.routen(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("Server beendet: %v", err)
		}
	}()
	log.Printf("Planr %s (Desktop) auf 127.0.0.1:%s, Daten in %s", version, port, dir)

	w := webview.New(false)
	defer w.Destroy()
	w.SetTitle("Planr")
	w.SetSize(1440, 900, webview.HintNone)
	menueEinrichten(w)
	w.Navigate("http://127.0.0.1:" + port + "/lokal/start?s=" + s.lokal.schluessel)
	w.Run()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
