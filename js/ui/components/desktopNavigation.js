import { Router } from "../navigation/router.js";
import { I18n } from "../../i18n/index.js";

const NAVIGATION_ITEMS = [
  {
    route: "home",
    labelKey: "sidebar.home",
    fallback: "Home",
    icon: "assets/icons/sidebar_home.svg"
  },
  {
    route: "search",
    labelKey: "sidebar.search",
    fallback: "Search",
    icon: "assets/icons/sidebar_search.svg"
  },
  {
    route: "library",
    labelKey: "sidebar.library",
    fallback: "Library",
    icon: "assets/icons/sidebar_library.svg"
  },
  {
    route: "settings",
    labelKey: "sidebar.settings",
    fallback: "Settings",
    icon: "assets/icons/sidebar_settings.svg"
  }
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function renderIcon(item) {
  return `<span class="desktop-navigation-icon-slot" aria-hidden="true"><span class="desktop-navigation-icon" style="mask-image:url('${item.icon}');-webkit-mask-image:url('${item.icon}')"></span></span>`;
}

function renderProfile(profile, selectedRoute) {
  const profileState = profile || {};
  const label = t("sidebar.profileFallback", "Profile");
  const name = String(profileState.activeProfileName || label).trim() || label;
  const initial = String(profileState.activeProfileInitial || name.charAt(0) || "P")
    .charAt(0)
    .toUpperCase();
  const color = String(profileState.activeProfileColorHex || "#1E88E5");
  const avatarUrl = String(profileState.activeProfileAvatarUrl || "").trim();
  const isActive = selectedRoute === "profileSelection";

  return `
    <button class="desktop-navigation-item desktop-navigation-profile${isActive ? " is-active" : ""}"
            type="button"
            data-desktop-route="profileSelection"
            aria-label="${escapeHtml(label)}"${isActive ? ' aria-current="page"' : ""}>
      <span class="desktop-navigation-avatar" style="background:${escapeHtml(color)}">
        ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" />` : escapeHtml(initial)}
      </span>
      <span class="desktop-navigation-label">${escapeHtml(label)}</span>
    </button>
  `;
}

// The rail placement keeps the navigation off screen until it is asked for,
// which needs something to ask with. It is rendered beside the bar rather than
// by each screen because the bar is already rendered by all of them, and a
// screen that forgot the button would have no way back to anywhere.
// The other two placements keep the bar on screen, so CSS hides this.
// Both marks are drawn and CSS shows whichever one is true, so the button
// never has to be rebuilt to change what it says.
export function renderNavigationRevealButton() {
  const label = t("nav_open_menu", "Open menu");
  return `
    <button class="desktop-navigation-reveal"
            type="button"
            data-desktop-navigation-reveal
            aria-label="${escapeHtml(label)}"
            aria-expanded="false">
      <svg class="desktop-navigation-reveal-open" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"></path>
      </svg>
      <svg class="desktop-navigation-reveal-close" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"></path>
      </svg>
    </button>
  `;
}

export function renderDesktopNavigation({ selectedRoute = "", profile = null } = {}) {
  const currentRoute = String(selectedRoute || "");
  return `
    <nav class="desktop-navigation" aria-label="Primary navigation">
      <div class="desktop-navigation-scroll">
        ${NAVIGATION_ITEMS.map((item) => {
          const label = t(item.labelKey, item.fallback);
          const isActive = item.route === currentRoute;
          return `
            <button class="desktop-navigation-item${isActive ? " is-active" : ""}"
                    type="button"
                    data-desktop-route="${item.route}"${isActive ? ' aria-current="page"' : ""}>
              ${renderIcon(item)}
              <span class="desktop-navigation-label">${escapeHtml(label)}</span>
            </button>
          `;
        }).join("")}
        ${renderProfile(profile, currentRoute)}
      </div>
    </nav>
    ${renderNavigationRevealButton()}
  `;
}

const NAVIGATION_OPEN_CLASS = "nav-rail-open";

function setNavigationRailOpen(open) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  root.classList.toggle(NAVIGATION_OPEN_CLASS, Boolean(open));
  const label = open ? t("nav_close_menu", "Close menu") : t("nav_open_menu", "Open menu");
  document.querySelectorAll("[data-desktop-navigation-reveal]").forEach((button) => {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-label", label);
  });
}

export function closeNavigationRail() {
  setNavigationRailOpen(false);
}

// Bound once for the page rather than per render: these screens rebuild their
// markup often, and a listener added on each of those would stack up.
let dismissBound = false;

function bindNavigationRailDismiss() {
  if (dismissBound || typeof document === "undefined") return;
  dismissBound = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!document.documentElement.classList.contains(NAVIGATION_OPEN_CLASS)) return;
      const target = event.target;
      if (typeof target?.closest !== "function") return;
      if (
        target.closest(".desktop-navigation") ||
        target.closest("[data-desktop-navigation-reveal]")
      ) {
        return;
      }
      setNavigationRailOpen(false);
    },
    true
  );
  // No Escape handler here on purpose. Escape is Back in this app: the key
  // is taken on window in the capture phase and ended with
  // stopImmediatePropagation, so nothing bound later can see it, and nothing
  // bound here ever would be. Closing the rail from Back would mean changing
  // what Back does, which is a bigger decision than this component.
  // Pressing elsewhere closes it, and so does going anywhere.
}

// --- The bottom bar, which gets out of the way while you read ---------------
//
// Labels while you arrive, icons once you are reading: scrolling down is the
// one moment the bar is certainly not what you are looking at, and scrolling
// back up is the usual way of reaching for it.
const BOTTOM_COLLAPSED_CLASS = "nav-bottom-collapsed";
const SCROLL_NOISE_PX = 6;
const NEAR_TOP_PX = 24;

// Per scroller, because a page has several: the row rails scroll sideways and
// the page scrolls down, and one shared number would read every switch
// between them as a jump.
const lastScrollTops = new WeakMap();
let bottomScrollBound = false;

function setBottomNavigationCollapsed(collapsed) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  root.classList.toggle(BOTTOM_COLLAPSED_CLASS, Boolean(collapsed));
}

function resolveScrollTarget(eventTarget) {
  if (!eventTarget || eventTarget === globalThis || eventTarget === globalThis.document) {
    return globalThis?.document?.scrollingElement || globalThis?.document?.documentElement || null;
  }
  return eventTarget;
}

function handleBottomNavigationScroll(event) {
  const root = globalThis?.document?.documentElement;
  // Only the bottom bar hides; the other two placements are not in the way.
  if (!root || root.dataset.navPlacement !== "bottom") return;
  const target = resolveScrollTarget(event?.target);
  if (!target) return;
  const top = Math.max(0, Number(target.scrollTop || 0) || 0);
  const previous = lastScrollTops.get(target);
  lastScrollTops.set(target, top);
  // A sideways rail never changes scrollTop, so it never reaches further
  // than this.
  if (previous === undefined || top === previous) return;
  if (top <= NEAR_TOP_PX) {
    setBottomNavigationCollapsed(false);
    return;
  }
  const delta = top - previous;
  if (Math.abs(delta) < SCROLL_NOISE_PX) return;
  setBottomNavigationCollapsed(delta > 0);
}

// Capture, because scroll does not bubble: this is the only way to hear every
// scroller on the page from one listener, whichever screen built it.
function bindBottomNavigationScroll() {
  if (bottomScrollBound || typeof globalThis.addEventListener !== "function") return;
  bottomScrollBound = true;
  globalThis.addEventListener("scroll", handleBottomNavigationScroll, {
    capture: true,
    passive: true
  });
}

function navigateTo(route) {
  // Going somewhere is the end of asking where to go.
  setNavigationRailOpen(false);
  if (route === "home" && Router.getCurrent() === "home") {
    Router.getCurrentScreen()?.onSidebarReselect?.();
    return;
  }
  void Router.navigate(route);
}

export function bindDesktopNavigationEvents(container) {
  bindNavigationRailDismiss();
  bindBottomNavigationScroll();
  // Every screen opens with the bar at its full size, whatever the last one
  // was left at.
  setBottomNavigationCollapsed(false);
  container?.querySelectorAll("[data-desktop-navigation-reveal]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const root = globalThis?.document?.documentElement;
      setNavigationRailOpen(!root?.classList.contains(NAVIGATION_OPEN_CLASS));
    };
  });
  container?.querySelectorAll(".desktop-navigation [data-desktop-route]").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateTo(String(button.dataset.desktopRoute || ""));
    };
  });
}
