//go:build !darwin

package main

// Ausserhalb von macOS gibt es keine Systemdialoge. Fuer Tests laesst sich
// mit PLANR_DIALOG_VERZ ein Verzeichnis angeben: Speichern legt die Datei
// dort ab, Oeffnen nimmt die Datei PLANR_DIALOG_OEFFNEN.

import (
	"os"
	"path/filepath"
)

type ersatzDialoge struct{}

var systemDialoge dateiDialoge = ersatzDialoge{}

func (ersatzDialoge) Speichern(vorschlag string) (string, error) {
	verz := os.Getenv("PLANR_DIALOG_VERZ")
	if verz == "" {
		return "", errKeinDialog
	}
	return filepath.Join(verz, vorschlag), nil
}

func (ersatzDialoge) Oeffnen() (string, error) {
	pfad := os.Getenv("PLANR_DIALOG_OEFFNEN")
	if pfad == "" {
		return "", errKeinDialog
	}
	return pfad, nil
}
