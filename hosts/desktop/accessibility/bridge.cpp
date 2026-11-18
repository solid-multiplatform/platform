// Native callbacks may arrive on an accessibility thread. Snapshot a locked
// model there and deliver actions through a queue consumed by the JS event
// loop.
#include <accesskit.h>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#ifdef _WIN32
#define API extern "C" __declspec(dllexport)
#else
#define API extern "C" __attribute__((visibility("default")))
#endif

struct Item {
  std::string role, label, value;
  accesskit_rect rect;
  bool disabled;
  int checked;
};
struct Model {
  std::mutex mutex;
  std::map<uint32_t, Item> items;
  std::deque<std::pair<uint32_t, int>> actions;
  uint32_t focus = 1;
  std::string title;
#if defined(_WIN32)
  accesskit_windows_subclassing_adapter *adapter;
#elif defined(__APPLE__)
  accesskit_macos_subclassing_adapter *adapter;
#else
  accesskit_unix_adapter *adapter;
#endif
};
static accesskit_role role(const std::string &r) {
  if (r == "button")
    return ACCESSKIT_ROLE_BUTTON;
  if (r == "switch")
    return ACCESSKIT_ROLE_SWITCH;
  if (r == "slider")
    return ACCESSKIT_ROLE_SLIDER;
  if (r == "heading")
    return ACCESSKIT_ROLE_HEADING;
  if (r == "status")
    return ACCESSKIT_ROLE_STATUS;
  if (r == "group")
    return ACCESSKIT_ROLE_GROUP;
  return ACCESSKIT_ROLE_LABEL;
}
static accesskit_tree_update *snapshot(void *opaque) {
  auto &m = *static_cast<Model *>(opaque);
  std::lock_guard<std::mutex> lock(m.mutex);
  auto update = accesskit_tree_update_with_capacity_and_focus(
      m.items.size() + 1, m.focus);
  accesskit_tree_update_set_tree_info(update, accesskit_tree_info_new(1));
  auto root = accesskit_node_new(ACCESSKIT_ROLE_WINDOW);
  accesskit_node_set_label(root, m.title.c_str());
  for (auto &[id, item] : m.items) {
    accesskit_node_push_child(root, id);
    auto node = accesskit_node_new(role(item.role));
    accesskit_node_set_label(node, item.label.c_str());
    accesskit_node_set_bounds(node, item.rect);
    if (!item.value.empty())
      accesskit_node_set_value(node, item.value.c_str());
    if (item.checked >= 0)
      accesskit_node_set_toggled(node, item.checked ? ACCESSKIT_TOGGLED_TRUE
                                                    : ACCESSKIT_TOGGLED_FALSE);
    if (item.disabled)
      accesskit_node_set_disabled(node);
    else if (item.role == "button" || item.role == "switch" ||
             item.role == "slider") {
      accesskit_node_add_action(node, ACCESSKIT_ACTION_FOCUS);
      accesskit_node_add_action(node, ACCESSKIT_ACTION_CLICK);
    }
    accesskit_tree_update_push_node(update, id, node);
  }
  accesskit_tree_update_push_node(update, 1, root);
  return update;
}
static void action(accesskit_action_request *req, void *opaque) {
  auto &m = *static_cast<Model *>(opaque);
  {
    std::lock_guard<std::mutex> lock(m.mutex);
    if (m.items.count(req->target_node) &&
        (req->action == ACCESSKIT_ACTION_CLICK ||
         req->action == ACCESSKIT_ACTION_FOCUS))
      m.actions.emplace_back(req->target_node,
                             req->action == ACCESSKIT_ACTION_CLICK ? 1 : 2);
  }
  accesskit_action_request_free(req);
}
static void refresh(Model *m) {
#if defined(_WIN32)
  auto events = accesskit_windows_subclassing_adapter_update_if_active(
      m->adapter, snapshot, m);
  if (events)
    accesskit_windows_queued_events_raise(events);
#elif defined(__APPLE__)
  auto events = accesskit_macos_subclassing_adapter_update_if_active(
      m->adapter, snapshot, m);
  if (events)
    accesskit_macos_queued_events_raise(events);
#else
  accesskit_unix_adapter_update_if_active(m->adapter, snapshot, m);
#endif
}
API Model *smp_access_open(void *window, const char *title) {
  auto m = new Model();
  m->title = title;
#if defined(_WIN32)
  m->adapter = accesskit_windows_subclassing_adapter_new(
      static_cast<HWND>(window), snapshot, m, action, m);
#elif defined(__APPLE__)
  m->adapter = accesskit_macos_subclassing_adapter_for_window(window, snapshot,
                                                              m, action, m);
#else
  m->adapter =
      accesskit_unix_adapter_new(snapshot, m, action, m, [](void *) {}, m);
#endif
  return m;
}
API void smp_access_item(Model *m, uint32_t id, const char *role,
                         const char *label, const char *value, double x,
                         double y, double w, double h, bool disabled,
                         int checked) {
  {
    std::lock_guard<std::mutex> lock(m->mutex);
    m->items[id] = {role,     label,  value, {x, y, x + w, y + h},
                    disabled, checked};
  }
  refresh(m);
}
API void smp_access_remove(Model *m, uint32_t id) {
  {
    std::lock_guard<std::mutex> lock(m->mutex);
    m->items.erase(id);
    if (m->focus == id)
      m->focus = 1;
  }
  refresh(m);
}
API void smp_access_focus(Model *m, uint32_t id) {
  {
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->items.count(id) || id == m->focus)
      return;
    m->focus = id;
  }
  refresh(m);
}
API void smp_access_active(Model *m, bool active) {
#if defined(__APPLE__)
  accesskit_macos_subclassing_adapter_update_view_focus_state(m->adapter,
                                                              active);
#elif !defined(_WIN32)
  accesskit_unix_adapter_update_window_focus_state(m->adapter, active);
#endif
}
API void smp_access_bounds(Model *m, double x, double y, double w, double h) {
#if !defined(_WIN32) && !defined(__APPLE__)
  accesskit_rect r = {x, y, x + w, y + h};
  accesskit_unix_adapter_set_root_window_bounds(m->adapter, r, r);
#endif
}
API int smp_access_next(Model *m, uint32_t *id) {
  std::lock_guard<std::mutex> lock(m->mutex);
  if (m->actions.empty())
    return 0;
  auto event = m->actions.front();
  m->actions.pop_front();
  *id = event.first;
  return event.second;
}
API void smp_access_close(Model *m) {
#if defined(_WIN32)
  accesskit_windows_subclassing_adapter_free(m->adapter);
#elif defined(__APPLE__)
  accesskit_macos_subclassing_adapter_free(m->adapter);
#else
  accesskit_unix_adapter_free(m->adapter);
#endif
  delete m;
}
