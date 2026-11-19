#!/usr/bin/env python3
# A stand-in for the desktop's Secret Service, for run.mjs: it owns
# org.freedesktop.secrets on the session bus named in the environment (the
# test's own) and implements enough of the protocol for the host's
# `secureStorage` provider - OpenSession, ReadAlias, CreateCollection,
# SearchItems, CreateItem, GetSecret, SetSecret and Delete.
#
# Secrets are kept in memory only. The file given as argv[1] is this
# stand-in's own persisted log, one JSON object per line: operation, item
# count, attributes, value length and the value's SHA-256. The value itself
# is never written there, the way a keyring keeps it encrypted; run.mjs
# checks that no plaintext reached the file.
#
# With SECRETS_LOCKED=1 the default collection is locked: ReadAlias answers
# with no collection and CreateCollection refuses, which is what a keyring
# asks the user to unlock first.
import hashlib
import json
import os
import sys

from gi.repository import Gio, GLib

NAME = "org.freedesktop.secrets"
SERVICE_PATH = "/org/freedesktop/secrets"
COLLECTION_PATH = "/org/freedesktop/secrets/collection/default"
BUS = "org.freedesktop.DBus"

log = sys.argv[1]
locked = os.environ.get("SECRETS_LOCKED") == "1"

# path -> {"attributes": {...}, "label": str, "value": bytes, "content_type": str}
items = {}
sessions = set()
counts = {"item": 0, "session": 0}
connection = None
# object path -> the id `register_object` returned, for unregistering.
registrations = {}


def interface(xml):
    return Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0]


SERVICE = interface(
    """
<node>
  <interface name='org.freedesktop.Secret.Service'>
    <method name='OpenSession'>
      <arg type='s' direction='in'/>
      <arg type='v' direction='in'/>
      <arg type='v' direction='out'/>
      <arg type='o' direction='out'/>
    </method>
    <method name='CreateCollection'>
      <arg type='a{sv}' direction='in'/>
      <arg type='s' direction='in'/>
      <arg type='o' direction='out'/>
      <arg type='o' direction='out'/>
    </method>
    <method name='SearchItems'>
      <arg type='a{ss}' direction='in'/>
      <arg type='ao' direction='out'/>
      <arg type='ao' direction='out'/>
    </method>
    <method name='Unlock'>
      <arg type='ao' direction='in'/>
      <arg type='ao' direction='out'/>
      <arg type='o' direction='out'/>
    </method>
    <method name='ReadAlias'>
      <arg type='s' direction='in'/>
      <arg type='o' direction='out'/>
    </method>
  </interface>
</node>
"""
)

COLLECTION = interface(
    """
<node>
  <interface name='org.freedesktop.Secret.Collection'>
    <method name='Delete'>
      <arg type='o' direction='out'/>
    </method>
    <method name='SearchItems'>
      <arg type='a{ss}' direction='in'/>
      <arg type='ao' direction='out'/>
      <arg type='ao' direction='out'/>
    </method>
    <method name='CreateItem'>
      <arg type='a{sv}' direction='in'/>
      <arg type='(oayays)' direction='in'/>
      <arg type='b' direction='in'/>
      <arg type='o' direction='out'/>
      <arg type='o' direction='out'/>
    </method>
  </interface>
</node>
"""
)

ITEM = interface(
    """
<node>
  <interface name='org.freedesktop.Secret.Item'>
    <method name='Delete'>
      <arg type='o' direction='out'/>
    </method>
    <method name='GetSecret'>
      <arg type='o' direction='in'/>
      <arg type='(oayays)' direction='out'/>
    </method>
    <method name='SetSecret'>
      <arg type='(oayays)' direction='in'/>
    </method>
  </interface>
</node>
"""
)

SESSION = interface(
    """
<node>
  <interface name='org.freedesktop.Secret.Session'>
    <method name='Close'/>
  </interface>
</node>
"""
)


def note(operation, **fields):
    """Appends one line about an operation. Never the secret's value."""
    entry = {"op": operation, "items": len(items)}
    entry.update(fields)
    with open(log, "a", encoding="utf-8") as out:
        out.write(json.dumps(entry, ensure_ascii=False) + "\n")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def matching(attributes):
    return [
        path
        for path, item in items.items()
        if all(item["attributes"].get(k) == v for k, v in attributes.items())
    ]


def is_locked(invocation):
    if not locked:
        return False
    invocation.return_dbus_error(
        "org.freedesktop.Secret.Error.IsLocked",
        "The default collection is locked",
    )
    return True


def search_items(invocation, parameters):
    attributes = parameters.unpack()[0]
    found = matching(attributes)
    unlocked, still_locked = ([], found) if locked else (found, [])
    note(
        "search",
        attributes=attributes,
        unlocked=len(unlocked),
        locked=len(still_locked),
    )
    invocation.return_value(GLib.Variant("(aoao)", (unlocked, still_locked)))


def service_call(conn, sender, path, iface, method, parameters, invocation):
    if method == "OpenSession":
        algorithm, _input = parameters.unpack()
        if algorithm != "plain":
            invocation.return_dbus_error(
                "org.freedesktop.Secret.Error.NotSupported",
                "Only the plain session type is supported",
            )
            return
        counts["session"] += 1
        session = "%s/session/s%d" % (SERVICE_PATH, counts["session"])
        sessions.add(session)
        registrations[session] = conn.register_object(
            session, SESSION, session_call, None, None
        )
        note("open-session", session=session)
        invocation.return_value(
            GLib.Variant("(vo)", (GLib.Variant("s", ""), session))
        )
    elif method == "CreateCollection":
        _properties, alias = parameters.unpack()
        if is_locked(invocation):
            note("create-collection-refused", alias=alias)
            return
        note("create-collection", alias=alias)
        invocation.return_value(GLib.Variant("(oo)", (COLLECTION_PATH, "/")))
    elif method == "SearchItems":
        search_items(invocation, parameters)
    elif method == "Unlock":
        (objects,) = parameters.unpack()
        if is_locked(invocation):
            return
        note("unlock", unlocked=len(objects))
        invocation.return_value(GLib.Variant("(aoo)", (objects, "/")))
    elif method == "ReadAlias":
        (alias,) = parameters.unpack()
        path = "/" if locked or alias != "default" else COLLECTION_PATH
        note("read-alias", alias=alias, path=path)
        invocation.return_value(GLib.Variant("(o)", (path,)))
    else:
        invocation.return_dbus_error(
            "org.freedesktop.DBus.Error.UnknownMethod", method
        )


def collection_call(conn, sender, path, iface, method, parameters, invocation):
    if method == "SearchItems":
        search_items(invocation, parameters)
    elif method == "CreateItem":
        properties, secret, replace = parameters.unpack()
        if is_locked(invocation):
            note("create-item-refused")
            return
        session, _required, value, content_type = secret
        if session not in sessions:
            invocation.return_dbus_error(
                "org.freedesktop.Secret.Error.NoSession",
                "The secret was not made for a session of this service",
            )
            return
        value = bytes(value)
        attributes = properties.get(
            "org.freedesktop.Secret.Item.Attributes", {}
        )
        label = properties.get("org.freedesktop.Secret.Item.Label", "")
        existing = matching(attributes)
        if existing and replace:
            item_path = existing[0]
            items[item_path].update(
                label=label, value=value, content_type=content_type
            )
            note(
                "replace-item",
                account=attributes.get("account"),
                app=attributes.get("app"),
                service=attributes.get("service"),
                valueLength=len(value),
                valueSha256=digest(value),
                contentType=content_type,
            )
            invocation.return_value(
                GLib.Variant("(oo)", (item_path, "/"))
            )
            return
        counts["item"] += 1
        item_path = "%s/item/%d" % (COLLECTION_PATH, counts["item"])
        items[item_path] = {
            "attributes": dict(attributes),
            "label": label,
            "value": value,
            "content_type": content_type,
        }
        registrations[item_path] = conn.register_object(
            item_path, ITEM, item_call, None, None
        )
        note(
            "create-item",
            account=attributes.get("account"),
            app=attributes.get("app"),
            service=attributes.get("service"),
            valueLength=len(value),
            valueSha256=digest(value),
            contentType=content_type,
        )
        invocation.return_value(GLib.Variant("(oo)", (item_path, "/")))
    elif method == "Delete":
        if is_locked(invocation):
            return
        note("delete-collection")
        invocation.return_value(GLib.Variant("(o)", ("/",)))
    else:
        invocation.return_dbus_error(
            "org.freedesktop.DBus.Error.UnknownMethod", method
        )


def item_call(conn, sender, path, iface, method, parameters, invocation):
    item = items.get(path)
    if item is None:
        invocation.return_dbus_error(
            "org.freedesktop.DBus.Error.UnknownObject", path
        )
        return
    if method == "GetSecret":
        (session,) = parameters.unpack()
        if is_locked(invocation):
            return
        if session not in sessions:
            invocation.return_dbus_error(
                "org.freedesktop.Secret.Error.NoSession", session
            )
            return
        value = item["value"]
        note(
            "get-secret",
            account=item["attributes"].get("account"),
            session=session,
            valueLength=len(value),
            valueSha256=digest(value),
        )
        invocation.return_value(
            GLib.Variant(
                "((oayays))",
                ((session, b"", value, item["content_type"]),),
            )
        )
    elif method == "SetSecret":
        (session, _required, value, content_type) = parameters.unpack()[0]
        if is_locked(invocation):
            return
        if session not in sessions:
            invocation.return_dbus_error(
                "org.freedesktop.Secret.Error.NoSession", session
            )
            return
        value = bytes(value)
        item.update(value=value, content_type=content_type)
        note(
            "set-secret",
            account=item["attributes"].get("account"),
            session=session,
            valueLength=len(value),
            valueSha256=digest(value),
        )
        invocation.return_value(None)
    elif method == "Delete":
        if is_locked(invocation):
            return
        account = item["attributes"].get("account")
        del items[path]
        conn.unregister_object(registrations.pop(path))
        note("delete-item", account=account)
        invocation.return_value(GLib.Variant("(o)", ("/",)))
    else:
        invocation.return_dbus_error(
            "org.freedesktop.DBus.Error.UnknownMethod", method
        )


def session_call(conn, sender, path, iface, method, parameters, invocation):
    if method != "Close":
        invocation.return_dbus_error(
            "org.freedesktop.DBus.Error.UnknownMethod", method
        )
        return
    sessions.discard(path)
    conn.unregister_object(registrations.pop(path))
    note("close-session", session=path)
    invocation.return_value(None)


def connected(conn, name):
    global connection
    connection = conn
    registrations[SERVICE_PATH] = conn.register_object(
        SERVICE_PATH, SERVICE, service_call, None, None
    )
    registrations[COLLECTION_PATH] = conn.register_object(
        COLLECTION_PATH, COLLECTION, collection_call, None, None
    )


def owned(conn, name):
    print("READY", flush=True)


def lost(conn, name):
    sys.exit(1)


Gio.bus_own_name(
    Gio.BusType.SESSION,
    NAME,
    Gio.BusNameOwnerFlags.NONE,
    connected,
    owned,
    lost,
)
GLib.MainLoop().run()
