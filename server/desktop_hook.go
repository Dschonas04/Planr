package main

// desktopStart setzt die Desktop-Fassung (fenster.go, Build-Tag "desktop").
// In der Server-Fassung bleibt er nil.
var desktopStart func()
