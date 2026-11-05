/*
 * SCARline site components
 * ------------------------------------------------------------------
 * The navigation bar is defined ONCE in this file and rendered on
 * every page via a custom element:
 *
 *     <site-nav></site-nav>
 *
 * To change a link or the name, edit SITE below.
 * The current page is highlighted automatically based on the file name.
 *
 * The footer is plain HTML in each page (so it shows without
 * JavaScript); edit it in every .html file.
 *
 * Load this file in the <head> of every page (no defer), so the
 * menu renders while the page is parsed and nothing flickers:
 *
 *     <script src="components.js"></script>
 */
(function () {
    'use strict';

    var SITE = {
        name: 'SCARline',
        github: 'https://github.com/tugcanonbas/SCARline',

        // Main navigation
        nav: [
            { href: 'index.html', label: 'Overview' },
            { href: 'platform.html', label: 'Platform' },
            { href: 'how-it-works.html', label: 'How it works' },
            { href: 'team.html', label: 'Team' }
        ]
    };

    var GITHUB_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>';

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // File name of the current page, e.g. "platform.html" ("" or "/" -> index.html)
    function currentPage() {
        var file = window.location.pathname.split('/').pop();
        return file && file.indexOf('.html') !== -1 ? file : 'index.html';
    }

    /* ---------------- <site-nav> ---------------- */
    class SiteNav extends HTMLElement {
      connectedCallback() {
        if (this._rendered) return;
        this._rendered = true;
        var active = this.getAttribute('active') || currentPage();

        var links = SITE.nav.map(function (item) {
            var isActive = item.href === active;
            return '<a' + (isActive ? ' class="active" aria-current="page"' : '') +
                ' href="' + esc(item.href) + '">' + esc(item.label) + '</a>';
        }).join('');

        this.innerHTML =
            '<nav class="top-nav" aria-label="Main navigation">' +
                '<div class="nav-inner">' +
                    '<a class="nav-brand" href="index.html">' + esc(SITE.name) + '</a>' +
                    '<div class="nav-links" id="nav-links">' + links + '</div>' +
                    '<div class="nav-actions">' +
                        '<a class="nav-icon" href="' + esc(SITE.github) + '" target="_blank" rel="noopener" aria-label="' + esc(SITE.name) + ' on GitHub" title="' + esc(SITE.name) + ' on GitHub">' + GITHUB_ICON + '</a>' +
                        '<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Open menu"><span></span><span></span></button>' +
                    '</div>' +
                '</div>' +
            '</nav>';

        var nav = this.querySelector('.top-nav');
        var toggle = this.querySelector('.nav-toggle');

        function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > 8); }
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        function setOpen(open) {
            nav.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        }
        toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });
        nav.querySelectorAll('.nav-links a').forEach(function (a) {
            a.addEventListener('click', function () { setOpen(false); });
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
        });
      }
    }

    if (window.customElements && !customElements.get('site-nav')) {
        customElements.define('site-nav', SiteNav);
    }
})();
