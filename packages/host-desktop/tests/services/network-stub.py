#!/usr/bin/env python3
# A stand-in for NetworkManager, for run.mjs: it owns
# org.freedesktop.NetworkManager on the bus the environment names as the
# system bus (the test's own), says it is connected, and goes offline and
# back online each time it is sent SIGUSR1, with NetworkManager's signal.
import signal
import sys

from gi.repository import Gio, GLib

NAME = "org.freedesktop.NetworkManager"
PATH = "/org/freedesktop/NetworkManager"
CONNECTED_GLOBAL, DISCONNECTED = 70, 20
INTERFACE = Gio.DBusNodeInfo.new_for_xml(
    """
<node>
  <interface name='org.freedesktop.NetworkManager'>
    <property name='State' type='u' access='read'/>
    <signal name='StateChanged'>
      <arg type='u'/>
    </signal>
  </interface>
</node>
"""
).interfaces[0]

state = CONNECTED_GLOBAL
bus = None


def get(connection, sender, path, interface, name):
    return GLib.Variant("u", state)


def toggle():
    global state
    state = DISCONNECTED if state == CONNECTED_GLOBAL else CONNECTED_GLOBAL
    bus.emit_signal(None, PATH, NAME, "StateChanged", GLib.Variant("(u)", (state,)))
    return True


def connected(connection, name):
    global bus
    bus = connection
    connection.register_object(PATH, INTERFACE, None, get, None)


def owned(connection, name):
    # The function moved between versions of the bindings, and some builds
    # have neither: a plain Python handler plus a timer that keeps the loop
    # waking is enough for a test stand-in.
    added = False
    for add in (
        lambda: __import__("gi.repository", fromlist=["GLibUnix"]).GLibUnix.signal_add(
            GLib.PRIORITY_DEFAULT, signal.SIGUSR1, toggle
        ),
        lambda: GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, toggle),
    ):
        try:
            add()
            added = True
            break
        except (ImportError, AttributeError):
            continue
    if not added:
        signal.signal(signal.SIGUSR1, lambda *_: toggle())
        GLib.timeout_add(50, lambda: True)
    print("READY", flush=True)


def lost(connection, name):
    sys.exit(1)


Gio.bus_own_name(Gio.BusType.SYSTEM, NAME, Gio.BusNameOwnerFlags.NONE, connected, owned, lost)
GLib.MainLoop().run()
