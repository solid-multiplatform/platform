' Copyright (c) 2026 Roku, Inc.
' SPDX-License-Identifier: MIT

sub init()
    print "BaseAppScene init"

    di = CreateObject("roDeviceInfo")
    uiResolution = di.GetUIResolution()

    print "uiResolution: "; uiResolution.name

    ' Set a simple background color for the scene
    m.top.backgroundColor = "0x000000FF"

    ' The Scene template ships a Geneva-theme background Poster. Point the
    ' Scene's background at a black asset instead of the purple wash.
    m.top.backgroundUri = "pkg:/assets/black.png"

    m.video = m.top.findNode("videoLayer")
    m.solidApp = m.top.findNode("solidApp")
    m.videoSeq = 0
    m.pendingSeek = -1
    m.readySent = false
    m.lastVideoCommand = ""
    if m.video <> invalid
        m.video.notificationInterval = 1
        m.video.enableUI = false
        m.video.observeField("state", "onVideoState")
        m.video.observeField("position", "onVideoPosition")
        m.video.observeField("duration", "onVideoDuration")
        m.video.observeField("availableAudioTracks", "onVideoTracks")
        m.video.observeField("availableSubtitleTracks", "onVideoTracks")
        m.video.observeField("audioTrack", "onVideoTracks")
        m.video.observeField("subtitleTrack", "onVideoTracks")
    end if

    if m.solidApp <> invalid
        print "SolidApp component found and initialized"
        m.solidApp.setFocus(true) ' Set initial focus to the SolidApp component
        ' The app sets exitApp when Back was pressed and nothing handled it.
        m.solidApp.observeField("exitApp", "onExitApp")
        ' The app's video adapter sends one JSON command per change.
        m.solidApp.observeField("videocommand", "onVideoCommand")
    else
        print "ERROR: SolidApp component (id solidApp) not found; initial focus not set"
    end if
end sub

sub onExitApp()
    m.top.exitApp = true
end sub

' ---- the video bridge -------------------------------------------------------

' The adapter's events reach the SolidApp anchor's input field as JSON. A
' sequence number makes every event a field change, even a repeated state.
sub sendVideoEvent(event as object)
    if m.solidApp = invalid then return
    m.videoSeq = m.videoSeq + 1
    event.seq = m.videoSeq
    m.solidApp.videoevent = FormatJson(event)
end sub

function labelOf(track as object, id as string) as string
    label = id
    if track.Description <> invalid and track.Description <> ""
        label = track.Description
    else if track.Name <> invalid and track.Name <> ""
        label = track.Name
    else if track.Language <> invalid and track.Language <> ""
        label = track.Language
    end if
    return label
end function

function trackList(list as dynamic, idField as string) as object
    out = []
    if type(list) <> "roArray" then return out
    for each track in list
        if type(track) = "roAssociativeArray"
            id = track[idField]
            if type(id) = "roString" and id <> ""
                item = { id: id, label: labelOf(track, id), available: true }
                if track.Language <> invalid then item.language = track.Language
                out.push(item)
            end if
        end if
    end for
    return out
end function

sub onVideoState()
    if m.video = invalid then return
    state = m.video.state
    ' The adapter asked for a start position; seek while silent, before play.
    if state = "paused" and m.pendingSeek >= 0
        m.video.seek = m.pendingSeek
        m.pendingSeek = -1
    end if
    event = { type: "state", state: state, position: m.video.position, duration: m.video.duration }
    if state = "error"
        if m.video.hasField("errorCode") then event.code = m.video.errorCode
        if m.video.hasField("errorMsg") then event.message = m.video.errorMsg
    end if
    sendVideoEvent(event)
    if not m.readySent and (state = "paused" or state = "playing")
        m.readySent = true
        sendVideoEvent({ type: "ready" })
    end if
end sub

sub onVideoPosition()
    if m.video = invalid then return
    sendVideoEvent({ type: "position", position: m.video.position })
end sub

sub onVideoDuration()
    if m.video = invalid then return
    sendVideoEvent({ type: "duration", duration: m.video.duration })
    ' Duration is known once the stream's metadata is in; the adapter may
    ' seek and control playback from here even while the state is buffering.
    if not m.readySent and m.video.duration > 0
        m.readySent = true
        sendVideoEvent({ type: "ready" })
    end if
end sub

sub onVideoTracks()
    if m.video = invalid then return
    selectedText = m.video.subtitleTrack
    if selectedText = "off" then selectedText = ""
    sendVideoEvent({
        type: "tracks",
        audio: trackList(m.video.availableAudioTracks, "Track"),
        text: trackList(m.video.availableSubtitleTracks, "TrackName"),
        selectedAudioId: m.video.audioTrack,
        selectedTextId: selectedText
    })
end sub

sub onVideoCommand()
    raw = m.solidApp.videocommand
    if raw = "" or raw = m.lastVideoCommand then return
    m.lastVideoCommand = raw
    cmd = ParseJson(raw)
    if type(cmd) <> "roAssociativeArray" then return
    op = cmd.op
    if op = "open"
        openVideo(cmd)
    else if op = "play"
        if m.video.state = "paused" then m.video.control = "resume" else m.video.control = "play"
    else if op = "pause"
        m.video.control = "pause"
    else if op = "stop"
        m.video.control = "stop"
    else if op = "seek"
        m.video.seek = cmd.seconds
    else if op = "mute"
        m.video.mute = cmd.value
    else if op = "audioTrack"
        m.video.audioTrack = cmd.id
    else if op = "textTrack"
        m.video.subtitleTrack = cmd.id
    else if op = "rate"
        if m.video.hasField("trickPlaySpeed")
            m.video.trickPlaySpeed = cmd.value
        end if
    else if op = "pictureMode"
        if m.video.hasField("scaleMode")
            if cmd.mode = "fill" then m.video.scaleMode = "zoomToFill" else m.video.scaleMode = "scaleToFit"
        end if
    else if op = "dispose"
        m.video.control = "stop"
        m.video.content = invalid
        m.video.visible = false
        m.pendingSeek = -1
    end if
end sub

sub openVideo(cmd as object)
    content = CreateObject("roSGNode", "ContentNode")
    content.url = cmd.url
    if cmd.streamFormat <> invalid then content.streamFormat = cmd.streamFormat
    if cmd.httpHeaders <> invalid then content.httpHeaders = cmd.httpHeaders
    if cmd.keySystem <> invalid then content.keySystem = cmd.keySystem
    if cmd.licenseServerURL <> invalid then content.licenseServerURL = cmd.licenseServerURL
    if cmd.drmParams <> invalid then content.drmParams = cmd.drmParams
    m.video.content = content
    ' The certificate goes through the Video node, not the ContentNode; only
    ' the host bridge can make this call.
    if cmd.certificate <> invalid and cmd.keySystem <> invalid
        m.video.setCertificate(cmd.certificate, cmd.keySystem)
    end if
    if cmd.mute <> invalid then m.video.mute = cmd.mute
    if cmd.audioTrack <> invalid and cmd.audioTrack <> "" then m.video.audioTrack = cmd.audioTrack
    if cmd.textTrack <> invalid and cmd.textTrack <> "" then m.video.subtitleTrack = cmd.textTrack
    if cmd.trickPlay = true and m.video.hasField("enableTrickPlay") then m.video.enableTrickPlay = true
    m.pendingSeek = -1
    m.readySent = false
    if cmd.startAt <> invalid and cmd.startAt > 0 then m.pendingSeek = cmd.startAt
    m.video.visible = true
    ' Buffer first and stay silent; the adapter seeks, then plays or pauses.
    m.video.control = "prebuffer"
end sub
