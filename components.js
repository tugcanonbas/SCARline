/*
 * SCARline site behaviour
 * ------------------------------------------------------------------
 * The navigation bar and the footer are plain HTML in every page.
 * When you add or rename a page, update the <nav class="top-nav">
 * block and the footer in each .html file, and mark the current
 * page's link with  class="active" aria-current="page".
 *
 * This script only adds behaviour to that markup:
 *   - a background on the nav bar once the page is scrolled
 *   - the open/close menu button on small screens
 *
 * Load it in the <head> of every page:
 *
 *     <script src="components.js" defer></script>
 */
(function () {
    'use strict';

    function init() {
        var nav = document.querySelector('.top-nav');
        if (!nav) return;
        var toggle = nav.querySelector('.nav-toggle');

        function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > 8); }
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        if (!toggle) return;

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
