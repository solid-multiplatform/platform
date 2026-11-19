' Copyright (c) 2026 Roku, Inc.
' SPDX-License-Identifier: MIT

sub Main()
    screen = CreateObject("roSGScreen")
    m.port = CreateObject("roMessagePort")
    screen.setMessagePort(m.port)

    scene = screen.CreateScene("BaseAppScene")
    screen.show()
    ' Back with nothing in the app to handle it: close the screen, which
    ' exits the channel.
    scene.observeField("exitApp", m.port)

    while(true)
        msg = wait(0, m.port)
        msgType = type(msg)
        if msgType = "roSGScreenEvent"
            if msg.isScreenClosed() then return
        else if msgType = "roSGNodeEvent"
            if msg.getField() = "exitApp" then
                screen.close()
                return
            end if
        else
            print "Unhandled message type: "; msgType
        end if
    end while
end sub
