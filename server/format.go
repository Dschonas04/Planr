package main

// Das .planr-Dateiformat.
//
// Bewusst JSON und keine eigene Syntax: eine neue Syntax haette nichts
// gebracht, was JSON nicht kann, haette aber jedes vorhandene Werkzeug
// ausgesperrt. Was tatsaechlich gefehlt hat, ist Verbindlichkeit -- eine
// Versionsnummer, eine Pruefung beim Einlesen und die Zusage, dass eine
// aeltere Datei weiter funktioniert.
//
// Aufbau einer .planr-Datei:
//
//	{
//	  "format": "planr",        Kennung, damit eine fremde JSON-Datei
//	  "formatVersion": 1,       nicht versehentlich als Grundriss gilt
//	  "generator": "planr/…",
//	  "savedAt": "2026-08-10T…",
//	  "project": { … }          der eigentliche Grundriss
//	}
//
// Eine nackte Projekt-JSON ohne Huelle wird ebenfalls angenommen -- so
// bleiben die Dateien lesbar, die der Editor vor Einfuehrung des Formats
// geschrieben hat.

import (
	"encoding/json"
	"fmt"
	"math"
	"time"
)

const (
	FormatName    = "planr"
	FormatVersion = 1
	Generator     = "planr/1"
)

type File struct {
	Format        string          `json:"format"`
	FormatVersion int             `json:"formatVersion"`
	Generator     string          `json:"generator"`
	SavedAt       string          `json:"savedAt"`
	Project       json.RawMessage `json:"project"`
}

// Wrap verpackt einen Grundriss in die Formathuelle.
func Wrap(project json.RawMessage) ([]byte, error) {
	return json.MarshalIndent(File{
		Format:        FormatName,
		FormatVersion: FormatVersion,
		Generator:     Generator,
		SavedAt:       time.Now().UTC().Format(time.RFC3339),
		Project:       project,
	}, "", "  ")
}

// Unwrap liest eine .planr-Datei oder eine nackte Projekt-JSON.
//
// Rueckgabe ist immer der reine Grundriss, damit der Rest des Programms nur
// eine Form kennt.
func Unwrap(raw []byte) (json.RawMessage, error) {
	var f File
	if err := json.Unmarshal(raw, &f); err == nil && f.Format == FormatName {
		if f.FormatVersion > FormatVersion {
			return nil, fmt.Errorf(
				"Datei ist in Formatversion %d gespeichert, dieser Stand kennt nur %d — bitte Planr aktualisieren",
				f.FormatVersion, FormatVersion)
		}
		if len(f.Project) == 0 {
			return nil, fmt.Errorf("Datei enthält kein Projekt")
		}
		return f.Project, nil
	}

	// Kein Umschlag: als nacktes Projekt versuchen.
	var probe Project
	if json.Unmarshal(raw, &probe) != nil {
		return nil, fmt.Errorf("Datei ist kein gültiges JSON")
	}
	if len(probe.Levels) == 0 {
		return nil, fmt.Errorf("Datei enthält keinen Grundriss")
	}
	return json.RawMessage(raw), nil
}

// Validate prueft einen Grundriss auf Schluessigkeit und meldet alle
// gefundenen Maengel auf einmal -- wer eine Datei repariert, will nicht nach
// jedem Versuch den naechsten Einzelfehler serviert bekommen.
func Validate(raw json.RawMessage) []string {
	var p Project
	if err := json.Unmarshal(raw, &p); err != nil {
		return []string{"Grundriss nicht lesbar: " + err.Error()}
	}

	var m []string
	if len(p.Levels) == 0 {
		return []string{"keine Ebene enthalten"}
	}

	for li, l := range p.Levels {
		wallIDs := map[string]bool{}
		for wi, w := range l.Walls {
			where := fmt.Sprintf("Ebene %d, Wand %d", li+1, wi+1)
			if w.ID == "" {
				m = append(m, where+": ohne Kennung")
			} else if wallIDs[w.ID] {
				m = append(m, where+": Kennung "+w.ID+" doppelt vergeben")
			}
			wallIDs[w.ID] = true

			if !finite(w.A.X, w.A.Y, w.B.X, w.B.Y) {
				m = append(m, where+": Koordinaten sind keine Zahlen")
				continue
			}
			if dist(w.A, w.B) < 1 {
				m = append(m, where+": kürzer als 1 cm")
			}
			if w.ThicknessCm <= 0 {
				m = append(m, where+": Dicke ist nicht positiv")
			}
		}

		for oi, o := range l.Openings {
			where := fmt.Sprintf("Ebene %d, Öffnung %d", li+1, oi+1)
			if !wallIDs[o.WallID] {
				m = append(m, where+": verweist auf eine Wand, die es nicht gibt")
				continue
			}
			if o.WidthCm <= 0 || o.HeightCm <= 0 {
				m = append(m, where+": Breite oder Höhe ist nicht positiv")
			}
			// Eine Oeffnung, die ueber das Wandende hinausragt, laesst sich
			// weder zeichnen noch bauen.
			for _, w := range l.Walls {
				if w.ID != o.WallID {
					continue
				}
				total := dist(w.A, w.B)
				if o.OffsetCm-o.WidthCm/2 < -0.5 || o.OffsetCm+o.WidthCm/2 > total+0.5 {
					m = append(m, where+": ragt über die Wand hinaus")
				}
			}
		}

		for fi, f := range l.Furniture {
			where := fmt.Sprintf("Ebene %d, Möbel %d", li+1, fi+1)
			if !finite(f.X, f.Y, f.WidthCm, f.DepthCm) {
				m = append(m, where+": Maße oder Position sind keine Zahlen")
				continue
			}
			if f.WidthCm <= 0 || f.DepthCm <= 0 {
				m = append(m, where+": Breite oder Tiefe ist nicht positiv")
			}
		}
	}
	return m
}

func finite(vals ...float64) bool {
	for _, v := range vals {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}
