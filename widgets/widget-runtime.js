(function initSharedSCARlineWidgetRuntime() {
  const hostMarker = "scarlineWidgetRuntime";
  const neutralTags = new Set(["SCRIPT", "STYLE", "LINK", "BASE"]);

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

  function applyBinding(scope, key, value) {
    for (const element of scope.querySelectorAll("[data-bind]")) {
      if (element.dataset.bind !== key) {
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

      if (element.dataset.bindText !== "false") {
        const formatted = formatValue(element, value);
        if (formatted !== null) {
          element.textContent = formatted;
        }
      }
    }
  }

  function applyVisualState(root, nextState) {
    if (!root) {
      return;
    }

    root.dataset.state = nextState;
    root.style.opacity = nextState === "hidden" ? "0" : "1";
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

  function bindActions(scope, SCARline) {
    for (const element of scope.querySelectorAll("[data-action]")) {
      element.addEventListener("click", () => {
        const action = element.dataset.action;
        if (!action) {
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

    bindActions(host, SCARline);

    SCARline.onTrigger((event) => {
      const bindingValues =
        event?.bindingValues ?? event?.payload?.bindingValues ?? {};
      for (const [key, value] of Object.entries(bindingValues)) {
        applyBinding(host, key, value);
      }

      const action = event?.action || event?.payload?.action;
      if (action === "highlight") {
        applyVisualState(root, "highlighted");
      } else if (action === "hide") {
        applyVisualState(root, "hidden");
      } else if (action === "show" || action === "reset") {
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
