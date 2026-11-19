//! `__solid.a11y`: the scene's semantics, for the system's assistive
//! technology (a screen reader, a switch device). On Linux that is AT-SPI
//! over D-Bus, spoken by AccessKit's adapter.
//!
//! JavaScript owns the semantics and tells this module when they change:
//! `set(id, parent, role, …)` and `remove(id)` edit the description kept
//! here, `commit(focus, scale)` ends a batch. Nothing is sent anywhere unless
//! assistive technology is running: the adapter asks for the tree when one
//! connects (it watches the session bus for that; it does not poll), and
//! only from then on does a commit push an update. What the technology asks
//! of a node (focus it, press it) comes back to `listen`'s callback on the
//! JavaScript thread, through the loop's completions.
//!
//! The adapter and its thread are made by the first call, so an app that
//! describes nothing starts neither.

use crate::napi::*;
use crate::worker;
use accesskit::{
    Action, ActionHandler, ActionRequest, ActivationHandler, Affine, DeactivationHandler, Node, NodeId, Rect, Role,
    Toggled, TreeId, TreeInfo, TreeUpdate,
};
use accesskit_unix::Adapter;
use sdl3_sys::everything::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::ffi::CStr;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// The window: the root of the tree, the parent of nodes that name none.
const ROOT: u64 = 0;

// The bits of `set`'s `flags` argument.
const DISABLED: u32 = 1;
const HAS_CHECKED: u32 = 2;
const CHECKED: u32 = 4;
const HAS_SELECTED: u32 = 8;
const SELECTED: u32 = 16;
const HAS_EXPANDED: u32 = 32;
const EXPANDED: u32 = 64;
const CAN_ACTIVATE: u32 = 128;
const CAN_FOCUS: u32 = 256;

struct Semantic {
    parent: u64,
    role: Role,
    label: String,
    description: Option<String>,
    value: Option<String>,
    /// `x, y, width, height` in scene units from the window's top left.
    bounds: Option<[f64; 4]>,
    flags: u32,
    level: Option<usize>,
    min: Option<f64>,
    max: Option<f64>,
    now: Option<f64>,
}

/// What the app has described. Both threads read it: the JavaScript thread
/// on a commit, the adapter's when assistive technology connects.
struct Scene {
    nodes: BTreeMap<u64, Semantic>,
    focus: u64,
    title: String,
    /// Pixels per scene unit.
    scale: f64,
}

static SCENE: Mutex<Scene> = Mutex::new(Scene { nodes: BTreeMap::new(), focus: ROOT, title: String::new(), scale: 1.0 });
/// Whether assistive technology has asked for the tree and not left since.
static ACTIVE: AtomicBool = AtomicBool::new(false);

thread_local! {
    static ADAPTER: RefCell<Option<Adapter>> = const { RefCell::new(None) };
    static LISTENER: Cell<Option<napi_ref>> = const { Cell::new(None) };
    static WINDOW: Cell<*mut SDL_Window> = const { Cell::new(ptr::null_mut()) };
}

/// The platform's role names (`packages/platform/src/sdk/semantics.ts`).
fn role(name: &str) -> Option<Role> {
    Some(match name {
        "button" => Role::Button,
        "heading" => Role::Heading,
        "status" => Role::Status,
        "switch" => Role::Switch,
        "slider" => Role::Slider,
        "group" => Role::Group,
        "link" => Role::Link,
        "checkbox" => Role::CheckBox,
        "radio" => Role::RadioButton,
        "textbox" => Role::TextInput,
        "searchbox" => Role::SearchInput,
        "dialog" => Role::Dialog,
        "alertdialog" => Role::AlertDialog,
        "list" => Role::List,
        "listitem" => Role::ListItem,
        "menu" => Role::Menu,
        "menuitem" => Role::MenuItem,
        "tab" => Role::Tab,
        "tabpanel" => Role::TabPanel,
        "progressbar" => Role::ProgressIndicator,
        "img" => Role::Image,
        "separator" => Role::Splitter,
        "navigation" => Role::Navigation,
        "main" => Role::Main,
        "tooltip" => Role::Tooltip,
        _ => return None,
    })
}

impl Semantic {
    fn node(&self, children: Vec<NodeId>) -> Node {
        let mut node = Node::new(self.role);
        node.set_label(self.label.clone());
        if let Some(description) = &self.description {
            node.set_description(description.clone());
        }
        if let Some(value) = &self.value {
            node.set_value(value.clone());
        }
        if let Some([x, y, width, height]) = self.bounds {
            node.set_bounds(Rect { x0: x, y0: y, x1: x + width, y1: y + height });
        }
        let has = |flag| self.flags & flag != 0;
        if has(DISABLED) {
            node.set_disabled();
        }
        if has(HAS_CHECKED) {
            node.set_toggled(if has(CHECKED) { Toggled::True } else { Toggled::False });
        }
        if has(HAS_SELECTED) {
            node.set_selected(has(SELECTED));
        }
        if has(HAS_EXPANDED) {
            node.set_expanded(has(EXPANDED));
        }
        if has(CAN_ACTIVATE) {
            node.add_action(Action::Click);
        }
        if has(CAN_FOCUS) {
            node.add_action(Action::Focus);
        }
        if matches!(self.role, Role::Dialog | Role::AlertDialog) {
            node.set_modal();
        }
        if let Some(level) = self.level {
            node.set_level(level);
        }
        if let Some(min) = self.min {
            node.set_min_numeric_value(min);
        }
        if let Some(max) = self.max {
            node.set_max_numeric_value(max);
        }
        if let Some(now) = self.now {
            node.set_numeric_value(now);
        }
        node.set_children(children);
        node
    }
}

impl Scene {
    /// The whole tree: the window, then every node under its parent in the
    /// order of the ids, which is the order they were described in. A node
    /// whose parent is gone hangs from the window, so none is ever left out
    /// and none refers to a node that is not there.
    fn tree(&self) -> TreeUpdate {
        let mut children: BTreeMap<u64, Vec<NodeId>> = BTreeMap::new();
        for (&id, semantic) in &self.nodes {
            let parent = if self.nodes.contains_key(&semantic.parent) { semantic.parent } else { ROOT };
            children.entry(parent).or_default().push(NodeId(id));
        }
        let mut window = Node::new(Role::Window);
        window.set_label(self.title.clone());
        // Bounds are in scene units; this makes them pixels.
        window.set_transform(Affine::scale(self.scale));
        window.set_children(children.remove(&ROOT).unwrap_or_default());
        let mut nodes = vec![(NodeId(ROOT), window)];
        for (&id, semantic) in &self.nodes {
            nodes.push((NodeId(id), semantic.node(children.remove(&id).unwrap_or_default())));
        }
        let mut tree = TreeInfo::new(NodeId(ROOT));
        tree.toolkit_name = Some("Solid Multiplatform".into());
        tree.toolkit_version = Some(env!("CARGO_PKG_VERSION").into());
        let focus = if self.nodes.contains_key(&self.focus) { self.focus } else { ROOT };
        TreeUpdate { nodes, tree: Some(tree), tree_id: TreeId::ROOT, focus: NodeId(focus) }
    }
}

/// The adapter calls these on its own thread.
struct Handlers;

impl ActivationHandler for Handlers {
    fn request_initial_tree(&mut self) -> Option<TreeUpdate> {
        ACTIVE.store(true, Ordering::Relaxed);
        Some(SCENE.lock().unwrap().tree())
    }
}

impl DeactivationHandler for Handlers {
    fn deactivate_accessibility(&mut self) {
        ACTIVE.store(false, Ordering::Relaxed);
    }
}

impl ActionHandler for Handlers {
    fn do_action(&mut self, request: ActionRequest) {
        let action = match request.action {
            Action::Focus => "focus",
            Action::Click => "click",
            // Nothing else was offered on any node.
            _ => return,
        };
        let id = request.target_node.0;
        // To the JavaScript thread, which the completion wakes.
        worker::complete(Box::new(move |env| unsafe {
            let Some(listener) = LISTENER.get() else { return };
            crate::runtime::invoke(env, dereference(env, listener), &[string(env, action), number(env, id as f64)]);
        }));
    }
}

/// Where the window is on the screen, in pixels: its frame and its contents.
/// Under Wayland a window cannot know its position and this says the origin.
unsafe fn window_bounds(window: *mut SDL_Window) -> (Rect, Rect) {
    let (mut x, mut y, mut width, mut height) = (0, 0, 0, 0);
    SDL_GetWindowPosition(window, &mut x, &mut y);
    SDL_GetWindowSizeInPixels(window, &mut width, &mut height);
    let (mut top, mut left, mut bottom, mut right) = (0, 0, 0, 0);
    SDL_GetWindowBordersSize(window, &mut top, &mut left, &mut bottom, &mut right);
    let (x, y, width, height) = (x as f64, y as f64, width as f64, height as f64);
    let inner = Rect { x0: x, y0: y, x1: x + width, y1: y + height };
    let outer =
        Rect { x0: x - left as f64, y0: y - top as f64, x1: inner.x1 + right as f64, y1: inner.y1 + bottom as f64 };
    (outer, inner)
}

/// Runs `f` with the adapter, which the first call makes.
unsafe fn with_adapter(f: impl FnOnce(&mut Adapter)) {
    ADAPTER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let adapter = slot.get_or_insert_with(|| {
            let mut adapter = Adapter::new(Handlers, Handlers, Handlers);
            let window = WINDOW.get();
            let (outer, inner) = window_bounds(window);
            adapter.set_root_window_bounds(outer, inner);
            adapter.update_window_focus_state(SDL_GetWindowFlags(window) & SDL_WINDOW_INPUT_FOCUS != 0);
            adapter
        });
        f(adapter);
    });
}

/// The loop shows every event of the system here: where the window is and
/// whether it has the keyboard is part of what assistive technology is told.
/// Does nothing until the app has described something.
pub unsafe fn observe(event: &SDL_Event) {
    let focused = match SDL_EventType(event.r#type) {
        SDL_EVENT_WINDOW_FOCUS_GAINED => Some(true),
        SDL_EVENT_WINDOW_FOCUS_LOST => Some(false),
        SDL_EVENT_WINDOW_MOVED | SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED => None,
        _ => return,
    };
    ADAPTER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(adapter) = slot.as_mut() else { return };
        match focused {
            Some(focused) => adapter.update_window_focus_state(focused),
            None => {
                let (outer, inner) = window_bounds(WINDOW.get());
                adapter.set_root_window_bounds(outer, inner);
            }
        }
    });
}

fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}

/// `a11y.set(id, parent, role, label, description, value, x, y, width,
/// height, flags, level, min, max, now)`: describes a node, or describes it
/// anew. `parent` is 0 for the window; a string that is not one is `null`; a
/// number that is not there is `NaN`.
unsafe extern "C" fn set(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id, parent, role_name, label, description, value, x, y, width, height, flags, level, min, max, now] =
        arguments::<15>(env, info);
    let id = number_or(env, id, 0.0) as u64;
    if id == ROOT {
        return throw(env, "a11y.set: the id must be a positive integer");
    }
    let Some(role) = string_argument(env, role_name).as_deref().and_then(role) else {
        return throw(env, &format!("a11y.set: \"{}\" is not a role", to_string(env, role_name)));
    };
    let number = |value| number_or(env, value, f64::NAN);
    let bounds = [number(x), number(y), number(width), number(height)];
    let semantic = Semantic {
        parent: number_or(env, parent, 0.0) as u64,
        role,
        label: string_argument(env, label).unwrap_or_default(),
        description: string_argument(env, description),
        value: string_argument(env, value),
        bounds: bounds.iter().all(|edge| edge.is_finite()).then_some(bounds),
        flags: number_or(env, flags, 0.0) as u32,
        level: finite(number(level)).map(|level| level as usize),
        min: finite(number(min)),
        max: finite(number(max)),
        now: finite(number(now)),
    };
    SCENE.lock().unwrap().nodes.insert(id, semantic);
    undefined(env)
}

/// `a11y.remove(id)`.
unsafe extern "C" fn remove(env: napi_env, info: napi_callback_info) -> napi_value {
    let [id] = arguments::<1>(env, info);
    SCENE.lock().unwrap().nodes.remove(&(number_or(env, id, 0.0) as u64));
    undefined(env)
}

/// `a11y.commit(focus, scale)`: the description is whole again. `focus` is
/// the node that has the keyboard, 0 for none of them; `scale` the pixels of
/// a scene unit. Sends the tree if assistive technology is running.
unsafe extern "C" fn commit(env: napi_env, info: napi_callback_info) -> napi_value {
    let [focus, scale] = arguments::<2>(env, info);
    let title = SDL_GetWindowTitle(WINDOW.get());
    {
        let mut scene = SCENE.lock().unwrap();
        scene.focus = number_or(env, focus, 0.0) as u64;
        scene.scale = number_or(env, scale, 1.0);
        scene.title = if title.is_null() { String::new() } else { CStr::from_ptr(title).to_string_lossy().into_owned() };
    }
    with_adapter(|adapter| adapter.update_if_active(|| SCENE.lock().unwrap().tree()));
    undefined(env)
}

/// `a11y.listen(callback)`: `callback(action, id)` when assistive technology
/// asks for `focus` or `click` on a node. One listener; a later call
/// replaces it.
unsafe extern "C" fn listen(env: napi_env, info: napi_callback_info) -> napi_value {
    let [callback] = arguments::<1>(env, info);
    let mut kind = NAPI_UNDEFINED;
    napi_typeof(env, callback, &mut kind);
    if kind != NAPI_FUNCTION {
        return throw(env, "a11y.listen: the callback must be a function");
    }
    if let Some(old) = LISTENER.replace(Some(reference(env, callback))) {
        napi_delete_reference(env, old);
    }
    undefined(env)
}

/// `a11y.active()`: whether assistive technology has asked for the tree.
unsafe extern "C" fn active(env: napi_env, _info: napi_callback_info) -> napi_value {
    boolean(env, ACTIVE.load(Ordering::Relaxed))
}

pub unsafe fn install(env: napi_env, host: napi_value, window: *mut SDL_Window) {
    WINDOW.set(window);
    let a11y = define_object(env, host, c"a11y");
    define_function(env, a11y, c"set", set);
    define_function(env, a11y, c"remove", remove);
    define_function(env, a11y, c"commit", commit);
    define_function(env, a11y, c"listen", listen);
    define_function(env, a11y, c"active", active);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn semantic(parent: u64, role: Role, label: &str) -> Semantic {
        Semantic {
            parent,
            role,
            label: label.into(),
            description: None,
            value: None,
            bounds: Some([10.0, 20.0, 30.0, 40.0]),
            flags: 0,
            level: None,
            min: None,
            max: None,
            now: None,
        }
    }

    fn children(update: &TreeUpdate, id: u64) -> Vec<u64> {
        let node = &update.nodes.iter().find(|(node, _)| node.0 == id).unwrap().1;
        node.children().iter().map(|child| child.0).collect()
    }

    #[test]
    fn the_tree_is_whole() {
        let mut scene = Scene { nodes: BTreeMap::new(), focus: 3, title: "App".into(), scale: 2.0 };
        scene.nodes.insert(1, semantic(ROOT, Role::Group, "Group"));
        scene.nodes.insert(2, Semantic { flags: CAN_ACTIVATE | CAN_FOCUS, ..semantic(1, Role::Button, "Play") });
        scene.nodes.insert(3, Semantic { flags: HAS_CHECKED | CHECKED | DISABLED, ..semantic(1, Role::Switch, "Mute") });
        // Its parent was never described: it hangs from the window.
        scene.nodes.insert(4, semantic(9, Role::Heading, "Orphan"));
        let update = scene.tree();

        assert_eq!(update.tree.as_ref().unwrap().root, NodeId(ROOT));
        assert_eq!(update.focus, NodeId(3));
        assert_eq!(children(&update, ROOT), [1, 4]);
        assert_eq!(children(&update, 1), [2, 3]);
        // Every node is in the update once, and every child named is in it.
        let ids: Vec<u64> = update.nodes.iter().map(|(id, _)| id.0).collect();
        assert_eq!(ids, [0, 1, 2, 3, 4]);

        let node = |id: u64| &update.nodes.iter().find(|(node, _)| node.0 == id).unwrap().1;
        assert_eq!(node(0).role(), Role::Window);
        assert_eq!(node(0).label(), Some("App"));
        assert_eq!(node(0).transform(), Some(&Affine::scale(2.0)));
        assert_eq!(node(2).role(), Role::Button);
        assert_eq!(node(2).label(), Some("Play"));
        assert!(node(2).supports_action(Action::Click) && node(2).supports_action(Action::Focus));
        assert_eq!(node(2).bounds(), Some(Rect { x0: 10.0, y0: 20.0, x1: 40.0, y1: 60.0 }));
        assert!(!node(3).supports_action(Action::Click));
        assert_eq!(node(3).toggled(), Some(Toggled::True));
        assert!(node(3).is_disabled() && !node(2).is_disabled());
    }

    #[test]
    fn a_focus_that_is_gone_is_the_window() {
        let mut scene = Scene { nodes: BTreeMap::new(), focus: 7, title: String::new(), scale: 1.0 };
        scene.nodes.insert(1, semantic(ROOT, Role::Button, "Only"));
        assert_eq!(scene.tree().focus, NodeId(ROOT));
        // Removing a parent keeps its children in the tree.
        scene.nodes.insert(2, semantic(1, Role::Button, "Child"));
        scene.nodes.remove(&1);
        let update = scene.tree();
        assert_eq!(children(&update, ROOT), [2]);
    }

    #[test]
    fn every_role_of_the_platform_has_one_here() {
        for name in [
            "button", "heading", "status", "switch", "slider", "group", "link", "checkbox", "radio", "textbox",
            "searchbox", "dialog", "alertdialog", "list", "listitem", "menu", "menuitem", "tab", "tabpanel",
            "progressbar", "img", "separator", "navigation", "main", "tooltip",
        ] {
            assert!(role(name).is_some(), "{name}");
        }
        assert!(role("window").is_none());
    }
}
