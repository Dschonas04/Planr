package main

// Datensicherung fuer Administratoren.
//
// Das Datenverzeichnis ist die ganze Wahrheit ueber eine Instanz: Boards,
// Index, Konten, rechtliche Texte. Die Sicherung packt es als tar.gz, nachdem
// alle offenen Boards geschrieben wurden. Sitzungen bleiben draussen -- wer
// die Sicherung einspielt, soll sich neu anmelden muessen, statt mit Tokens
// aus einem Archiv weiterzuarbeiten.

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *server) sicherung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	name := "planr-sicherung-" + time.Now().Format("2006-01-02-1504") + ".tar.gz"
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)

	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	err := filepath.WalkDir(s.cfg.daten, func(pfad string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(s.cfg.daten, pfad)
		if rel == "." || d.IsDir() {
			return nil
		}
		if rel == "sitzungen.json" || strings.HasSuffix(rel, ".tmp") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		kopf, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		kopf.Name = filepath.ToSlash(rel)
		if err := tw.WriteHeader(kopf); err != nil {
			return err
		}
		f, err := os.Open(pfad)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
	if err != nil {
		logf("Sicherung unvollstaendig: %v", err)
	}
	tw.Close()
	gz.Close()
}
