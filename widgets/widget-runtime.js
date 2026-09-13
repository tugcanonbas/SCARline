(function initSharedSCARlineWidgetRuntime() {
  const hostMarker = "scarlineWidgetRuntime";
  const neutralTags = new Set(["SCRIPT", "STYLE", "LINK", "BASE"]);
  const bindingDefaults = new WeakMap();
  const visualDefaults = new WeakMap();
  const visualStates = new Set(["visible", "hidden", "highlighted"]);

  function currentHost() {
    const script = document.currentScript;
    return script?.closest?.("[data-scarline-widget-host]") || document.body;
  }

  function resolveRoot(host) {
    if (!host) {
      return null;
    }

    const explicitRoot = host.querySelector("[data-scarline-widget-root]");
    if (explicitRoot) {
      return explicitRoot;
    }

    for (const child of Array.from(host.children)) {
      if (!neutralTags.has(child.tagName)) {
        return child;
      }
    }

    return host.firstElementChild || host;
  }

  function formatValue(element, value) {
    if (value === undefined || value === null) {
      return null;
    }

    if (element?.dataset?.format === "number") {
      const decimals = Number(element.dataset.decimals ?? "0");
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return numeric.toFixed(decimals);
      }
    }

    return String(value);
  }

  function toggleClassTokens(element, classNames, enabled) {
    const tokens = String(classNames ?? "")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return;
    }

    if (enabled) {
      element.classList.add(...tokens);
    } else {
      element.classList.remove(...tokens);
    }
  }

  function bindsText(element) {
    const { bindText, bindClass, bindStyle, bindAttr } = element.dataset;
    return bindText === "true"
      || (bindText !== "false" && !bindClass && !bindStyle && !bindAttr);
  }

  function rememberBindingDefaults(element) {
    if (bindingDefaults.has(element)) return;
    const { bindClass, bindClassFalse, bindStyle, bindAttr } = element.dataset;
    const tokens = `${bindClass ?? ""} ${bindClassFalse ?? ""}`.split(/\s+/).filter(Boolean);
    bindingDefaults.set(element, {
      children: bindsText(element) ? Array.from(element.childNodes) : null,
      classes: new Map(tokens.map((token) => [token, element.classList.contains(token)])),
      style: bindStyle ? element.style.getPropertyValue(bindStyle) : "",
      priority: bindStyle ? element.style.getPropertyPriority(bindStyle) : "",
      attribute: bindAttr ? element.getAttribute(bindAttr) : null,
    });
  }

  function restoreBinding(element) {
    const defaults = bindingDefaults.get(element);
    if (!defaults) return;
    if (defaults.children !== null) element.replaceChildren(...defaults.children);
    for (const [token, enabled] of defaults.classes) element.classList.toggle(token, enabled);
    if (element.dataset.bindStyle) {
      element.style.setProperty(element.dataset.bindStyle, defaults.style, defaults.priority);
    }
    if (element.dataset.bindAttr) {
      if (defaults.attribute === null) element.removeAttribute(element.dataset.bindAttr);
      else element.setAttribute(element.dataset.bindAttr, defaults.attribute);
    }
  }

  function applyBinding(scope, key, value) {
    for (const element of scope.querySelectorAll("[data-bind]")) {
      if (element.dataset.bind !== key) {
        continue;
      }
      rememberBindingDefaults(element);
      if (value === undefined || value === null) {
        restoreBinding(element);
        continue;
      }

      if (element.dataset.bindClass) {
        const className = element.dataset.bindClass;
        const falseClassName = element.dataset.bindClassFalse;
        if (value) {
          toggleClassTokens(element, className, true);
          if (falseClassName) {
            toggleClassTokens(element, falseClassName, false);
          }
        } else {
          toggleClassTokens(element, className, false);
          if (falseClassName) {
            toggleClassTokens(element, falseClassName, true);
          }
        }
      }

      if (element.dataset.bindStyle) {
        const styleName = element.dataset.bindStyle;
        const unit = element.dataset.styleUnit ?? "";
        element.style.setProperty(styleName, `${value}${unit}`);
      }

      if (element.dataset.bindAttr) {
        const attrName = element.dataset.bindAttr;
        const formatted = formatValue(element, value);
        if (formatted !== null) {
          element.setAttribute(attrName, formatted);
        }
      }

      if (bindsText(element)) {
        const formatted = formatValue(element, value);
        if (formatted !== null) {
          element.textContent = formatted;
        }
      }
    }
  }

  function applyVisualState(root, nextState) {
    if (!root || !visualStates.has(nextState)) {
      return;
    }

    if (!visualDefaults.has(root)) {
      visualDefaults.set(root, {
        inert: root.inert,
        ariaHidden: root.getAttribute("aria-hidden"),
        pointerEvents: root.style.getPropertyValue("pointer-events"),
        pointerPriority: root.style.getPropertyPriority("pointer-events"),
      });
    }
    const defaults = visualDefaults.get(root);
    const hidden = nextState === "hidden";
    if (hidden && root.contains(document.activeElement)) document.activeElement?.blur?.();
    root.inert = hidden || defaults.inert;
    if (hidden) root.setAttribute("aria-hidden", "true");
    else if (defaults.ariaHidden === null) root.removeAttribute("aria-hidden");
    else root.setAttribute("aria-hidden", defaults.ariaHidden);
    root.style.setProperty("pointer-events", hidden ? "none" : defaults.pointerEvents, hidden ? "important" : defaults.pointerPriority);

    root.dataset.state = nextState;
    root.style.opacity = hidden ? "0" : "1";
    root.style.filter =
      nextState === "highlighted"
        ? "drop-shadow(0 0 24px rgba(56, 189, 248, 0.85))"
        : "none";
    root.style.transform =
      nextState === "highlighted" ? "scale(1.015)" : "scale(1)";
    root.style.transition =
      "opacity 180ms ease, filter 180ms ease, transform 180ms ease";
  }

  function applyDocumentRuntime(host, root) {
    document.documentElement.style.setProperty(
      "background",
      "transparent",
      "important",
    );
    document.documentElement.style.setProperty(
      "background-color",
      "transparent",
      "important",
    );
    document.body.style.setProperty("background", "transparent", "important");
    document.body.style.setProperty(
      "background-color",
      "transparent",
      "important",
    );

    if (host === document.body) {
      document.body.style.display = "flex";
      document.body.style.alignItems = "stretch";
      document.body.style.justifyContent = "stretch";
      document.body.style.overflow = "hidden";
    }

    if (root) {
      root.setAttribute("data-widget-root", "true");
      root.style.minWidth = "0";
      root.style.minHeight = "0";
    }
  }

  function bindActions(scope, root, SCARline) {
    for (const element of scope.querySelectorAll("[data-action]")) {
      element.addEventListener("click", () => {
        const action = element.dataset.action;
        if (!action || root?.dataset.state === "hidden" || element.closest("[inert]")
          || element.disabled || element.getAttribute("aria-disabled") === "true") {
          return;
        }

        SCARline.send(action, {
          action,
          label: element.textContent?.trim() || null,
        });
      });
    }
  }

  function bindRuntime() {
    const SCARline = window.SCARline;
    const host = currentHost();
    if (!SCARline || !host || host.dataset[hostMarker] === "ready") {
      return;
    }

    host.dataset[hostMarker] = "ready";
    const root = resolveRoot(host);
    applyDocumentRuntime(host, root);
    for (const element of host.querySelectorAll("[data-bind]")) rememberBindingDefaults(element);
    applyVisualState(root, SCARline.getState());

    const keys = [
      ...new Set(
        Array.from(host.querySelectorAll("[data-bind]"))
          .map((element) => element.dataset.bind)
          .filter(Boolean),
      ),
    ];

    for (const key of keys) {
      SCARline.onBinding(key, (value) => applyBinding(host, key, value));
      const currentValue = SCARline.getBinding(key);
      if (typeof currentValue !== "undefined") {
        applyBinding(host, key, currentValue);
      }
    }

    bindActions(host, root, SCARline);

    SCARline.onTrigger((event) => {
      const bindingValues =
        event?.bindingValues ?? event?.payload?.bindingValues ?? {};
      const action = event?.action || event?.payload?.action;
      if (action === "reset") {
        // A reset contains the complete configured values. Missing bindings
        // return to their original markup, including SVG attributes/styles.
        for (const key of keys) applyBinding(host, key, bindingValues[key]);
      } else {
        for (const [key, value] of Object.entries(bindingValues)) applyBinding(host, key, value);
      }

      const configuredState = event?.state ?? event?.payload?.state;
      if (visualStates.has(configuredState)) {
        applyVisualState(root, configuredState);
      } else if (action === "highlight") {
        applyVisualState(root, "highlighted");
      } else if (action === "hide") {
        applyVisualState(root, "hidden");
      } else if (action === "show") {
        applyVisualState(root, "visible");
      }
    });

    SCARline.onStateChange((state) => {
      applyVisualState(root, state);
    });

    SCARline.ready();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindRuntime, { once: true });
  } else {
    bindRuntime();
  }
})();
