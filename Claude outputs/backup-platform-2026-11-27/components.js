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
 *   - the hero background video on index.html (see initHeroVideo)
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

    /*
     * Hero background video
     * The <video class="hero-video"> has no <source>; its file is in data-src.
     * It is only attached on larger screens, without reduced motion and
     * without data saver, so everyone else just sees the poster image.
     * While playing, the video pauses when scrolled out of view, and the nav
     * bar drops its backdrop blur while it sits over the video.
     */
    function initHeroVideo(nav) {
        var video = document.querySelector('.hero-video[data-src]');
        if (!video) return;

        var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
        var conn = navigator.connection || {};
        var staticOnly =
            mq('(prefers-reduced-motion: reduce)') ||
            mq('(max-width: 768px), (max-height: 500px)') ||   // phones, portrait or landscape
            conn.saveData === true ||
            /(^|-)2g$/.test(conn.effectiveType || '');
        if (staticOnly) return;

        var source = document.createElement('source');
        source.src = video.getAttribute('data-src');
        source.type = 'video/mp4';
        video.appendChild(source);
        video.load();

        function tryPlay() {
            var p = video.play();
            if (p && p.catch) p.catch(function () { /* autoplay blocked: poster stays */ });
        }

        var hero = video.closest('.hero') || video;
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                if (entries[0].isIntersecting) tryPlay(); else video.pause();
            }).observe(hero);
        } else {
            tryPlay();
        }

        if (nav) {
            var update = function () {
                var overVideo = !video.paused && hero.getBoundingClientRect().bottom > nav.offsetHeight;
                nav.classList.toggle('is-over-video', overVideo);
            };
            ['playing', 'pause'].forEach(function (ev) { video.addEventListener(ev, update); });
            window.addEventListener('scroll', update, { passive: true });
            window.addEventListener('resize', update);
        }
    }

    function initAll() {
        init();
        initHeroVideo(document.querySelector('.top-nav'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }
})();
