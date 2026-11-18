#!/usr/bin/env python3
"""Native desktop menu/tray provider for the SDL3 host.

Reads newline-delimited JSON from stdin and renders the menu with
AyatanaAppIndicator3 (GTK3). Item activation is written back as
{"type":"select","id":...} so the Node host can run the JavaScript callback.
"""
import json
import sys
import threading

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import GLib, Gtk, AyatanaAppIndicator3 as AppIndicator  # noqa: E402

indicator = AppIndicator.Indicator.new(
    "solid-multiplatform",
    "dialog-information",
    AppIndicator.IndicatorCategory.APPLICATION_STATUS,
)
indicator.set_status(AppIndicator.IndicatorStatus.ACTIVE)
menu = Gtk.Menu()
indicator.set_menu(menu)


def emit(value):
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()


def add_items(target, items):
    for item in items or []:
        kind = item.get("type")
        if kind == "separator":
            target.append(Gtk.SeparatorMenuItem())
            continue
        label = item.get("label") or ""
        shortcut = item.get("shortcut")
        if shortcut:
            label = f"{label}   {shortcut}"
        if kind in ("checkbox", "radio"):
            entry = Gtk.CheckMenuItem(label=label)
            entry.set_active(bool(item.get("checked")))
        else:
            entry = Gtk.MenuItem(label=label)
        entry.set_sensitive(
            not item.get("disabled") and item.get("enabled", True) is not False
        )
        item_id = item.get("id")
        if item_id:
            entry.connect(
                "activate", lambda _widget, selected=item_id: emit(
                    {"type": "select", "id": selected}
                )
            )
        if item.get("submenu"):
            submenu = Gtk.Menu()
            add_items(submenu, item["submenu"])
            entry.set_submenu(submenu)
        target.append(entry)
    target.show_all()


def render(message):
    for child in menu.get_children():
        menu.remove(child)
    add_items(menu, message.get("items", []))
    tooltip = message.get("tooltip")
    if tooltip:
        indicator.set_title(tooltip)
    icon = message.get("icon")
    if icon:
        indicator.set_icon_full(str(icon), tooltip or "Application")


def handle(line):
    try:
        message = json.loads(line)
    except json.JSONDecodeError:
        return
    if message.get("type") == "menu":
        render(message)
    elif message.get("type") == "quit":
        Gtk.main_quit()


def read_stdin():
    for line in sys.stdin:
        GLib.idle_add(handle, line)
    GLib.idle_add(Gtk.main_quit)


threading.Thread(target=read_stdin, daemon=True).start()
emit({"type": "ready"})
Gtk.main()
