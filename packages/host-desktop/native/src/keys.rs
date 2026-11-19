//! Keyboard keys in the web's terms: for an SDL key event, the DOM `code`
//! (the physical key), `key` (what it means in the current layout) and the
//! legacy `keyCode`.
//!
//! The table is by SDL scancode, which is the USB HID usage the UI Events
//! specifications also start from:
//!
//! - `code`: "UI Events KeyboardEvent code Values" (W3C), the "USB HID usage
//!   to code" mapping of its writing-system, functional, control-pad, arrow,
//!   numpad, function and media sections.
//! - `key` of a key that types nothing: "UI Events KeyboardEvent key Values"
//!   (W3C). A key that types takes its `key` from the layout instead, through
//!   `SDL_GetKeyFromScancode` with the modifiers applied.
//! - `keyCode`: "UI Events", section "Legacy Key Attributes", the fixed
//!   virtual key codes table and the optionally fixed ones for the US layout,
//!   which are the Windows virtual-key codes every browser reports.

use sdl3_sys::everything::*;
use std::ffi::CStr;

pub struct Key {
    scancode: i32,
    /// DOM `code`.
    pub code: &'static CStr,
    /// DOM `key` when the key types nothing; empty when the layout decides.
    name: &'static CStr,
    /// Legacy `keyCode`; for a key that types, the one of its US position.
    key_code: u16,
}

macro_rules! keys {
    ($($scancode:ident $code:literal $name:literal $key_code:literal;)*) => {
        const KEYS: &[Key] = &[$(Key {
            scancode: SDL_Scancode::$scancode.0,
            code: $code,
            name: $name,
            key_code: $key_code,
        },)*];
    };
}

keys! {
    A c"KeyA" c"" 65; B c"KeyB" c"" 66; C c"KeyC" c"" 67; D c"KeyD" c"" 68;
    E c"KeyE" c"" 69; F c"KeyF" c"" 70; G c"KeyG" c"" 71; H c"KeyH" c"" 72;
    I c"KeyI" c"" 73; J c"KeyJ" c"" 74; K c"KeyK" c"" 75; L c"KeyL" c"" 76;
    M c"KeyM" c"" 77; N c"KeyN" c"" 78; O c"KeyO" c"" 79; P c"KeyP" c"" 80;
    Q c"KeyQ" c"" 81; R c"KeyR" c"" 82; S c"KeyS" c"" 83; T c"KeyT" c"" 84;
    U c"KeyU" c"" 85; V c"KeyV" c"" 86; W c"KeyW" c"" 87; X c"KeyX" c"" 88;
    Y c"KeyY" c"" 89; Z c"KeyZ" c"" 90;
    _1 c"Digit1" c"" 49; _2 c"Digit2" c"" 50; _3 c"Digit3" c"" 51;
    _4 c"Digit4" c"" 52; _5 c"Digit5" c"" 53; _6 c"Digit6" c"" 54;
    _7 c"Digit7" c"" 55; _8 c"Digit8" c"" 56; _9 c"Digit9" c"" 57;
    _0 c"Digit0" c"" 48;
    RETURN c"Enter" c"Enter" 13;
    ESCAPE c"Escape" c"Escape" 27;
    BACKSPACE c"Backspace" c"Backspace" 8;
    TAB c"Tab" c"Tab" 9;
    SPACE c"Space" c"" 32;
    MINUS c"Minus" c"" 189; EQUALS c"Equal" c"" 187;
    LEFTBRACKET c"BracketLeft" c"" 219; RIGHTBRACKET c"BracketRight" c"" 221;
    BACKSLASH c"Backslash" c"" 220; NONUSHASH c"Backslash" c"" 220;
    SEMICOLON c"Semicolon" c"" 186; APOSTROPHE c"Quote" c"" 222;
    GRAVE c"Backquote" c"" 192; COMMA c"Comma" c"" 188;
    PERIOD c"Period" c"" 190; SLASH c"Slash" c"" 191;
    NONUSBACKSLASH c"IntlBackslash" c"" 226;
    CAPSLOCK c"CapsLock" c"CapsLock" 20;
    F1 c"F1" c"F1" 112; F2 c"F2" c"F2" 113; F3 c"F3" c"F3" 114;
    F4 c"F4" c"F4" 115; F5 c"F5" c"F5" 116; F6 c"F6" c"F6" 117;
    F7 c"F7" c"F7" 118; F8 c"F8" c"F8" 119; F9 c"F9" c"F9" 120;
    F10 c"F10" c"F10" 121; F11 c"F11" c"F11" 122; F12 c"F12" c"F12" 123;
    F13 c"F13" c"F13" 124; F14 c"F14" c"F14" 125; F15 c"F15" c"F15" 126;
    F16 c"F16" c"F16" 127; F17 c"F17" c"F17" 128; F18 c"F18" c"F18" 129;
    F19 c"F19" c"F19" 130; F20 c"F20" c"F20" 131; F21 c"F21" c"F21" 132;
    F22 c"F22" c"F22" 133; F23 c"F23" c"F23" 134; F24 c"F24" c"F24" 135;
    PRINTSCREEN c"PrintScreen" c"PrintScreen" 44;
    SCROLLLOCK c"ScrollLock" c"ScrollLock" 145;
    PAUSE c"Pause" c"Pause" 19;
    INSERT c"Insert" c"Insert" 45; HOME c"Home" c"Home" 36;
    PAGEUP c"PageUp" c"PageUp" 33; DELETE c"Delete" c"Delete" 46;
    END c"End" c"End" 35; PAGEDOWN c"PageDown" c"PageDown" 34;
    RIGHT c"ArrowRight" c"ArrowRight" 39; LEFT c"ArrowLeft" c"ArrowLeft" 37;
    DOWN c"ArrowDown" c"ArrowDown" 40; UP c"ArrowUp" c"ArrowUp" 38;
    NUMLOCKCLEAR c"NumLock" c"NumLock" 144;
    KP_DIVIDE c"NumpadDivide" c"" 111; KP_MULTIPLY c"NumpadMultiply" c"" 106;
    KP_MINUS c"NumpadSubtract" c"" 109; KP_PLUS c"NumpadAdd" c"" 107;
    KP_ENTER c"NumpadEnter" c"Enter" 13;
    KP_1 c"Numpad1" c"" 97; KP_2 c"Numpad2" c"" 98; KP_3 c"Numpad3" c"" 99;
    KP_4 c"Numpad4" c"" 100; KP_5 c"Numpad5" c"" 101; KP_6 c"Numpad6" c"" 102;
    KP_7 c"Numpad7" c"" 103; KP_8 c"Numpad8" c"" 104; KP_9 c"Numpad9" c"" 105;
    KP_0 c"Numpad0" c"" 96; KP_PERIOD c"NumpadDecimal" c"" 110;
    KP_EQUALS c"NumpadEqual" c"" 12; KP_COMMA c"NumpadComma" c"" 194;
    APPLICATION c"ContextMenu" c"ContextMenu" 93;
    POWER c"Power" c"Power" 0;
    HELP c"Help" c"Help" 47; MENU c"ContextMenu" c"ContextMenu" 93;
    SELECT c"Select" c"Select" 41; STOP c"BrowserStop" c"Cancel" 3;
    AGAIN c"Again" c"Again" 0; UNDO c"Undo" c"Undo" 0; CUT c"Cut" c"Cut" 0;
    COPY c"Copy" c"Copy" 0; PASTE c"Paste" c"Paste" 0; FIND c"Find" c"Find" 0;
    MUTE c"AudioVolumeMute" c"AudioVolumeMute" 173;
    VOLUMEUP c"AudioVolumeUp" c"AudioVolumeUp" 175;
    VOLUMEDOWN c"AudioVolumeDown" c"AudioVolumeDown" 174;
    LCTRL c"ControlLeft" c"Control" 17; LSHIFT c"ShiftLeft" c"Shift" 16;
    LALT c"AltLeft" c"Alt" 18; LGUI c"MetaLeft" c"Meta" 91;
    RCTRL c"ControlRight" c"Control" 17; RSHIFT c"ShiftRight" c"Shift" 16;
    RALT c"AltRight" c"Alt" 18; RGUI c"MetaRight" c"Meta" 92;
    MODE c"AltRight" c"AltGraph" 225;
    SLEEP c"Sleep" c"Standby" 95; WAKE c"WakeUp" c"WakeUp" 0;
    MEDIA_PLAY c"MediaPlay" c"MediaPlay" 250;
    MEDIA_PAUSE c"MediaPause" c"MediaPause" 19;
    MEDIA_RECORD c"MediaRecord" c"MediaRecord" 0;
    MEDIA_FAST_FORWARD c"MediaFastForward" c"MediaFastForward" 0;
    MEDIA_REWIND c"MediaRewind" c"MediaRewind" 0;
    MEDIA_NEXT_TRACK c"MediaTrackNext" c"MediaTrackNext" 176;
    MEDIA_PREVIOUS_TRACK c"MediaTrackPrevious" c"MediaTrackPrevious" 177;
    MEDIA_STOP c"MediaStop" c"MediaStop" 178;
    MEDIA_EJECT c"Eject" c"Eject" 0;
    MEDIA_PLAY_PAUSE c"MediaPlayPause" c"MediaPlayPause" 179;
    MEDIA_SELECT c"MediaSelect" c"LaunchMediaPlayer" 181;
    AC_SEARCH c"BrowserSearch" c"BrowserSearch" 170;
    AC_HOME c"BrowserHome" c"BrowserHome" 172;
    AC_BACK c"BrowserBack" c"BrowserBack" 166;
    AC_FORWARD c"BrowserForward" c"BrowserForward" 167;
    AC_STOP c"BrowserStop" c"BrowserStop" 169;
    AC_REFRESH c"BrowserRefresh" c"BrowserRefresh" 168;
    AC_BOOKMARKS c"BrowserFavorites" c"BrowserFavorites" 171;
}

fn find(scancode: i32) -> Option<&'static Key> {
    KEYS.iter().find(|key| key.scancode == scancode)
}

/// What the numeric keypad's keys mean without Num Lock, by the digit each
/// types with it.
const KEYPAD_NAVIGATION: [(&CStr, u16); 11] = [
    (c"Insert", 45),
    (c"End", 35),
    (c"ArrowDown", 40),
    (c"PageDown", 34),
    (c"ArrowLeft", 37),
    (c"Clear", 12),
    (c"ArrowRight", 39),
    (c"Home", 36),
    (c"ArrowUp", 38),
    (c"PageUp", 33),
    (c"Delete", 46),
];

/// A key event's `key`: a name from the table, or the character it types.
pub enum Name {
    Named(&'static CStr),
    Character(char),
}

pub struct Translated {
    pub code: &'static CStr,
    pub key: Name,
    pub key_code: u16,
}

const UNIDENTIFIED: Translated = Translated { code: c"", key: Name::Named(c"Unidentified"), key_code: 0 };

/// The DOM's view of an SDL key event. `keycode` is the event's own (what the
/// key means in the layout, without modifiers); the character comes from the
/// layout with `modifiers` applied, so Shift+1 is `!` where the layout says so.
pub unsafe fn translate(scancode: SDL_Scancode, keycode: SDL_Keycode, modifiers: SDL_Keymod) -> Translated {
    let physical = find(scancode.0);
    let code = physical.map_or(c"", |key| key.code);

    // The numeric keypad: digits with Num Lock, navigation without.
    let keypad = match scancode {
        SDL_Scancode::KP_0 => Some(0),
        SDL_Scancode::KP_PERIOD => Some(10),
        _ if (SDL_Scancode::KP_1.0..=SDL_Scancode::KP_9.0).contains(&scancode.0) => {
            Some((scancode.0 - SDL_Scancode::KP_1.0 + 1) as usize)
        }
        _ => None,
    };
    if let (Some(index), Some(physical)) = (keypad, physical) {
        if modifiers.0 & SDL_KMOD_NUM.0 == 0 {
            let (name, key_code) = KEYPAD_NAVIGATION[index];
            return Translated { code, key: Name::Named(name), key_code };
        }
        let character = if index == 10 { '.' } else { (b'0' + index as u8) as char };
        return Translated { code, key: Name::Character(character), key_code: physical.key_code };
    }
    let operator = match scancode {
        SDL_Scancode::KP_DIVIDE => Some('/'),
        SDL_Scancode::KP_MULTIPLY => Some('*'),
        SDL_Scancode::KP_MINUS => Some('-'),
        SDL_Scancode::KP_PLUS => Some('+'),
        SDL_Scancode::KP_EQUALS => Some('='),
        SDL_Scancode::KP_COMMA => Some(','),
        _ => None,
    };
    if let (Some(character), Some(physical)) = (operator, physical) {
        return Translated { code, key: Name::Character(character), key_code: physical.key_code };
    }

    // A key that types nothing is named by its keycode, which a layout may
    // have moved from the physical key (Caps Lock as Control, say). Such a
    // keycode is a scancode with a flag, or one of a few control characters.
    let meaning = if keycode.0 & SDLK_SCANCODE_MASK.0 != 0 {
        find((keycode.0 & !SDLK_SCANCODE_MASK.0) as i32)
    } else {
        match keycode {
            SDLK_RETURN => find(SDL_Scancode::RETURN.0),
            SDLK_ESCAPE => find(SDL_Scancode::ESCAPE.0),
            SDLK_BACKSPACE => find(SDL_Scancode::BACKSPACE.0),
            SDLK_TAB => find(SDL_Scancode::TAB.0),
            SDLK_DELETE => find(SDL_Scancode::DELETE.0),
            _ => None,
        }
    };
    if let Some(named) = meaning.filter(|key| !key.name.is_empty()) {
        return Translated { code, key: Name::Named(named.name), key_code: named.key_code };
    }

    // A key that types: the character the layout gives with these modifiers.
    let typed = SDL_GetKeyFromScancode(scancode, modifiers, false).0;
    let character = char::from_u32(typed).filter(|c| !c.is_control() && typed & SDLK_SCANCODE_MASK.0 == 0);
    let Some(character) = character.or_else(|| char::from_u32(keycode.0).filter(|c| !c.is_control())) else {
        return Translated { code, ..UNIDENTIFIED };
    };
    // Letters and digits are their own code whatever the layout, as in every
    // browser; other characters report the code of their US position.
    let key_code = match character {
        'a'..='z' => character as u16 - 32,
        'A'..='Z' | '0'..='9' | ' ' => character as u16,
        _ => physical.map_or(0, |key| key.key_code),
    };
    Translated { code, key: Name::Character(character), key_code }
}
