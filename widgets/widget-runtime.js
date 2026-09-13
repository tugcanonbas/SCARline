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
      label: element.getAttribute("aria-label"),
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
    if (element.dataset.bindLabelTrue) {
      if (defaults.label === null) element.removeAttribute("aria-label");
      else element.setAttribute("aria-label", defaults.label);
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

      if (element.dataset.bindLabelTrue) {
        element.setAttribute("aria-label", value ? element.dataset.bindLabelTrue : element.dataset.bindLabelFalse);
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
    const elements = Array.from(scope.querySelectorAll("[data-action]"));
    if (elements.length === 0) return;
    let request = null;
    let savedDisabled = null;
    let timeout = null;
    let feedback = null;

    const showFeedback = (message, retryable = false) => {
      if (!feedback) {
        feedback = document.createElement("div");
        feedback.dataset.interactionFeedback = "true";
        feedback.setAttribute("role", "status");
        feedback.setAttribute("aria-live", "polite");
        feedback.style.cssText = "position:absolute;inset-inline:4px;bottom:4px;z-index:100;padding:5px 7px;border-radius:6px;background:#111827;color:#fff;font:11px/1.3 system-ui;text-align:center;box-shadow:0 1px 5px #0006";
        (root || scope).append(feedback);
      }
      feedback.hidden = false;
      feedback.replaceChildren(document.createTextNode(message));
      if (retryable) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry";
        retry.style.cssText = "display:block;margin:4px auto 0;padding:3px 8px;border:1px solid currentColor;border-radius:4px;font:inherit";
        retry.addEventListener("click", () => { if (request) dispatch(request); });
        feedback.append(retry);
      }
    };
    const release = () => {
      if (savedDisabled) for (const [element, disabled] of savedDisabled) element.disabled = disabled;
      savedDisabled = null;
      root?.removeAttribute("aria-busy");
    };
    const finish = (result) => {
      if (!request || result.requestId !== request.requestId) return;
      if (result.status === "pending") return;
      clearTimeout(timeout);
      root?.removeAttribute("aria-busy");
      if (result.status === "failed") showFeedback(result.message || "The action could not be completed.", result.retryable === true);
      else if (feedback) feedback.hidden = true;
      if (!result.retryable) {
        release();
        request = null;
      }
    };
    const dispatch = (next) => {
      request = next;
      clearTimeout(timeout);
      if (!savedDisabled) savedDisabled = elements.map((element) => [element, element.disabled]);
      for (const element of elements) element.disabled = true;
      root?.setAttribute("aria-busy", "true");
      if (feedback) feedback.hidden = true;
      timeout = setTimeout(() => finish({ requestId: next.requestId, status: "failed", retryable: true,
        message: "Could not confirm the action." }), 12_000);
      SCARline.send(next.action, next.payload);
    };
    SCARline.onTrigger((event) => { if (event?.interaction) finish(event.interaction); });

    for (const element of elements) {
      element.addEventListener("click", () => {
        const action = element.dataset.action;
        if (request || !action || root?.dataset.state === "hidden" || element.closest("[inert]")
          || element.disabled || element.getAttribute("aria-disabled") === "true") {
          return;
        }
        // Static editor thumbnails and older hosts do not acknowledge actions.
        // Keep their existing event behaviour without leaving controls pending.
        if (SCARline.getMetadata().interactionResults !== true) {
          SCARline.send(action, { action, label: element.textContent?.trim() || null });
          return;
        }
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
        const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        dispatch({ requestId, action, payload: {
          requestId, action, label: element.getAttribute("aria-label") || element.textContent?.trim() || null,
        } });
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
