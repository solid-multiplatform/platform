' One Animation + FloatFieldInterpolator per animated axis. A new run gets a
' FRESH Animation node: re-arming a reused node after `control = "stop"` can
' leave its `state` field unchanged (stopped -> stopped), so no state change
' is observed and the run never reports that it stopped. The id the
' interpolators address is written by the host (`setProp(dom, "id", ...)`)
' before any request arrives; init stays free of work so a screen full of
' nodes does not pay for motion it never uses.
sub init()
    m.channels = {}
end sub

sub onXValue()
    position = m.top.translation
    m.top.translation = [m.top.motionX, position[1]]
end sub

sub onYValue()
    position = m.top.translation
    m.top.translation = [position[0], m.top.motionY]
end sub

function currentValue(key as string) as float
    if key = "alpha" then return m.top.opacity
    if key = "x" then return m.top.translation[0]
    return m.top.translation[1]
end function

sub writeValue(key as string, value as float)
    if key = "alpha" then
        m.top.opacity = value
    else if key = "x" then
        m.top.motionX = value
    else
        m.top.motionY = value
    end if
end sub

sub publishState(key as string, state as string)
    channel = m.channels[key]
    m.top[key + "State"] = { serial: channel.request.serial, state: state, value: currentValue(key) }
end sub

function stateCallback(key as string) as string
    if key = "x" then return "onXState"
    if key = "y" then return "onYState"
    return "onAlphaState"
end function

' Removes the channel's Animation, if any, from the render tree.
sub releaseAnimation(channel as object)
    if channel.anim = invalid then return
    channel.anim.unobserveFieldScoped("state")
    channel.anim.control = "stop"
    parent = channel.anim.getParent()
    if parent <> invalid then parent.removeChild(channel.anim)
    channel.anim = invalid
    channel.interp = invalid
end function

' A fresh Animation + FloatFieldInterpolator for one run of `key`, observed.
sub armAnimation(key as string, channel as object)
    releaseAnimation(channel)
    anim = createObject("roSGNode", "Animation")
    interp = createObject("roSGNode", "FloatFieldInterpolator")
    interp.key = [0, 1]
    field = "opacity"
    if key = "x" then field = "motionX"
    if key = "y" then field = "motionY"
    interp.fieldToInterp = m.top.id + "." + field
    anim.appendChild(interp)
    m.top.appendChild(anim)
    channel.anim = anim
    channel.interp = interp
    ' The observer is attached before the run starts, so the transition to
    ' "stopped" is seen even when the run is shorter than a frame.
    anim.observeFieldScoped("state", stateCallback(key))
end sub

sub requestMotion(key as string, request as object)
    if request = invalid then return
    channel = m.channels[key]
    if channel = invalid then
        channel = { anim: invalid, interp: invalid, request: request, changing: false }
        m.channels[key] = channel
    end if
    channel.changing = true
    channel.request = request
    value = currentValue(key)
    action = request.action
    immediate = false
    if action = "start" then
        # A new run always starts from what is on screen now.
        writeValue(key, value)
        armAnimation(key, channel)
        channel.interp.keyValue = [value, request.to]
        channel.anim.duration = request.duration
        channel.anim.easeFunction = request.easing
        if request.duration <= 0 or abs(value - request.to) < 0.0001 then
            immediate = true
            channel.interp.keyValue = [request.to, request.to]
            writeValue(key, request.to)
        else
            channel.anim.control = "start"
        end if
    else if action = "pause" then
        if channel.anim <> invalid and channel.anim.state = "running" then channel.anim.control = "pause"
    else if action = "resume" then
        if channel.anim <> invalid and channel.anim.state = "paused" then channel.anim.control = "resume"
    else
        if channel.anim = invalid then
            channel.changing = false
            return
        end if
        if action = "snap" then value = request.to
        # Pin both keys before stop, which otherwise resets to the span's start.
        channel.interp.keyValue = [value, value]
        channel.anim.control = "stop"
        writeValue(key, value)
    end if
    channel.changing = false
    ' A running start is reported by the state observer; publishing the
    ' pre-start state here would settle the JS controller before the run.
    if channel.anim <> invalid and (action <> "start" or immediate) then
        publishState(key, channel.anim.state)
    end if
end sub

sub onXRequest()
    requestMotion("x", m.top.xRequest)
end sub
sub onYRequest()
    requestMotion("y", m.top.yRequest)
end sub
sub onAlphaRequest()
    requestMotion("alpha", m.top.alphaRequest)
end sub

sub animationState(key as string, event as object)
    channel = m.channels[key]
    if channel = invalid or channel.anim = invalid then return
    if channel.changing then return
    if event.getData() <> channel.anim.state then return
    publishState(key, channel.anim.state)
end sub
sub onXState(event as object)
    animationState("x", event)
end sub
sub onYState(event as object)
    animationState("y", event)
end sub
sub onAlphaState(event as object)
    animationState("alpha", event)
end sub
