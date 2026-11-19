#!/usr/bin/env python3
# A stand-in for the desktop's notification service, for run.mjs: it owns
# org.freedesktop.Notifications on the session bus named in the environment
# (the test's own) and writes every notification it is asked to show to the
# file given, one JSON object per line. It shows nothing.
import json
import sys

from gi.repository import Gio, GLib

NAME = "org.freedesktop.Notifications"
INTERFACE = Gio.DBusNodeInfo.new_for_xml(
    """
<node>
  <interface name='org.freedesktop.Notifications'>
    <method name='Notify'>
      <arg type='s' direction='in'/>
      <arg type='u' direction='in'/>
      <arg type='s' direction='in'/>
      <arg type='s' direction='in'/>
      <arg type='s' direction='in'/>
      <arg type='as' direction='in'/>
      <arg type='a{sv}' direction='in'/>
      <arg type='i' direction='in'/>
      <arg type='u' direction='out'/>
    </method>
    <method name='GetCapabilities'>
      <arg type='as' direction='out'/>
    </method>
  </interface>
</node>
"""
).interfaces[0]

log = sys.argv[1]
shown = 0


def call(connection, sender, path, interface, method, parameters, invocation):
    global shown
    if method != "Notify":
        invocation.return_value(GLib.Variant("(as)", (["body"],)))
        return
    app, replaces, icon, title, body, actions, hints, timeout = parameters.unpack()
    if replaces == 0:
        shown += 1
    identifier = replaces or shown
    with open(log, "a", encoding="utf-8") as out:
        out.write(
            json.dumps(
                {
                    "id": identifier,
                    "app": app,
                    "replaces": replaces,
                    "title": title,
                    "body": body,
                    "timeout": timeout,
                }
            )
            + "\n"
        )
    invocation.return_value(GLib.Variant("(u)", (identifier,)))


def connected(connection, name):
    connection.register_object("/org/freedesktop/Notifications", INTERFACE, call, None, None)


def owned(connection, name):
    print("READY", flush=True)


def lost(connection, name):
    sys.exit(1)


Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE, connected, owned, lost)
GLib.MainLoop().run()
