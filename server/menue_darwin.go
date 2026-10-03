//go:build desktop && darwin

package main

// Das Programmmenue. Ohne Menue funktionieren in einem Cocoa-Programm weder
// ⌘C/⌘V in Eingabefeldern noch ⌘Q -- die Tastenkuerzel laufen ueber die
// Menueeintraege und die Responder-Kette. ⌘Z, ⌘S und ⌘P bleiben bewusst
// draussen: die behandelt die Oberflaeche selbst.

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static void planrMenue(void) {
	NSMenu *leiste = [[NSMenu alloc] init];

	NSMenuItem *appEintrag = [[NSMenuItem alloc] init];
	[leiste addItem:appEintrag];
	NSMenu *app = [[NSMenu alloc] initWithTitle:@"Planr"];
	[app addItemWithTitle:@"Über Planr" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
	[app addItem:[NSMenuItem separatorItem]];
	[app addItemWithTitle:@"Planr ausblenden" action:@selector(hide:) keyEquivalent:@"h"];
	NSMenuItem *andere = [app addItemWithTitle:@"Andere ausblenden" action:@selector(hideOtherApplications:) keyEquivalent:@"h"];
	[andere setKeyEquivalentModifierMask:(NSEventModifierFlagOption | NSEventModifierFlagCommand)];
	[app addItem:[NSMenuItem separatorItem]];
	[app addItemWithTitle:@"Planr beenden" action:@selector(terminate:) keyEquivalent:@"q"];
	[appEintrag setSubmenu:app];

	NSMenuItem *bearbeitenEintrag = [[NSMenuItem alloc] init];
	[leiste addItem:bearbeitenEintrag];
	NSMenu *bearbeiten = [[NSMenu alloc] initWithTitle:@"Bearbeiten"];
	[bearbeiten addItemWithTitle:@"Ausschneiden" action:@selector(cut:) keyEquivalent:@"x"];
	[bearbeiten addItemWithTitle:@"Kopieren" action:@selector(copy:) keyEquivalent:@"c"];
	[bearbeiten addItemWithTitle:@"Einsetzen" action:@selector(paste:) keyEquivalent:@"v"];
	[bearbeiten addItemWithTitle:@"Alles auswählen" action:@selector(selectAll:) keyEquivalent:@"a"];
	[bearbeitenEintrag setSubmenu:bearbeiten];

	NSMenuItem *fensterEintrag = [[NSMenuItem alloc] init];
	[leiste addItem:fensterEintrag];
	NSMenu *fenster = [[NSMenu alloc] initWithTitle:@"Fenster"];
	[fenster addItemWithTitle:@"Im Dock ablegen" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
	[fenster addItemWithTitle:@"Zoomen" action:@selector(performZoom:) keyEquivalent:@""];
	NSMenuItem *vollbild = [fenster addItemWithTitle:@"Vollbild" action:@selector(toggleFullScreen:) keyEquivalent:@"f"];
	[vollbild setKeyEquivalentModifierMask:(NSEventModifierFlagControl | NSEventModifierFlagCommand)];
	[fensterEintrag setSubmenu:fenster];
	[NSApp setWindowsMenu:fenster];

	[NSApp setMainMenu:leiste];
}
*/
import "C"

import webview "github.com/webview/webview_go"

func menueEinrichten(w webview.WebView) {
	// Muss auf dem Hauptthread laufen, nachdem NSApp existiert.
	w.Dispatch(func() { C.planrMenue() })
}
