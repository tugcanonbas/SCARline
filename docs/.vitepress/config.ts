import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// The Admin Panel serves this build under /docs, so every generated asset and
// link has to be prefixed with that base. `cleanUrls` stays off: explicit
// `.html` targets resolve identically under the SvelteKit dev server, the
// adapter-node static handler, and `vitepress preview`.
export default withMermaid(
  defineConfig({
    title: 'SCARline Docs',
    description:
      'Documentation for installing, operating, and extending the SCARline simulator research platform.',
    base: '/docs/',
    appearance: false,
    // `lastUpdated` shells out to git per page. The Docker build context
    // excludes `.git`, so leaving it on breaks the Admin Panel image build.
    lastUpdated: false,
    cleanUrls: false,
    ignoreDeadLinks: false,
    head: [['link', { rel: 'icon', href: '/docs/favicon.ico', sizes: 'any' }]],
    // A single dark Shiki theme. VitePress's default pairs a light and a dark
    // theme and switches between them with its `.dark` class, which
    // `appearance: false` never adds — that leaves light syntax colours on the
    // dark Admin Panel surface. `github-dark-default` over `github-dark`
    // because its comment grey clears 4.5:1 on this background; the older
    // theme's sits at 3.4:1.
    markdown: { theme: 'github-dark-default' },
    // Diagram colours track the Admin Panel palette in
    // apps/admin-panel/src/app.css: surfaces on --scarline-black, strokes on
    // --scarline-main, text on --scarline-white.
    mermaid: {
      theme: 'base',
      flowchart: { curve: 'basis' },
      sequence: { mirrorActors: false },
      themeVariables: {
        darkMode: true,
        background: '#151718',
        primaryColor: '#151718',
        primaryTextColor: '#eceff0',
        primaryBorderColor: '#1d90b9',
        secondaryColor: '#1d1f21',
        secondaryTextColor: '#eceff0',
        secondaryBorderColor: '#1d90b9',
        tertiaryColor: '#1d1f21',
        tertiaryTextColor: '#eceff0',
        tertiaryBorderColor: '#1d90b9',
        lineColor: '#1d90b9',
        textColor: '#eceff0',
        mainBkg: '#151718',
        nodeBorder: '#1d90b9',
        nodeTextColor: '#eceff0',
        clusterBkg: '#0f1113',
        clusterBorder: 'rgba(29, 143, 185, 0.425)',
        titleColor: '#eceff0',
        edgeLabelBackground: '#151718',
        actorBkg: '#151718',
        actorBorder: '#1d90b9',
        actorTextColor: '#eceff0',
        actorLineColor: 'rgba(255, 255, 255, 0.24)',
        labelBoxBkgColor: '#151718',
        labelBoxBorderColor: '#1d90b9',
        labelTextColor: '#eceff0',
        loopTextColor: '#eceff0',
        noteBkgColor: '#1d90b91a',
        noteBorderColor: '#1d90b9',
        noteTextColor: '#eceff0',
        signalColor: '#eceff0',
        signalTextColor: '#eceff0',
        sequenceNumberColor: '#080e10',
        altBackground: '#0f1113',
        transitionColor: '#1d90b9',
        transitionLabelColor: '#eceff0',
        stateBkg: '#151718',
        stateLabelColor: '#eceff0',
        compositeBackground: '#0f1113',
        compositeBorder: 'rgba(29, 143, 185, 0.425)',
        compositeTitleBackground: '#151718',
        attributeBackgroundColorOdd: '#151718',
        attributeBackgroundColorEven: '#0f1113',
        fontFamily: '"Segoe UI", ui-sans-serif, system-ui, sans-serif',
        fontSize: '14px'
      }
    },
    themeConfig: {
      search: { provider: 'local' },
      nav: [
        { text: 'Getting Started', link: '/getting-started/' },
        { text: 'CLI & Configuration', link: '/cli/' },
        { text: 'Platform', link: '/platform/' },
        { text: 'Operations', link: '/operations/' },
        { text: 'Builders', link: '/builders/' },
        { text: 'Reference', link: '/reference/' }
      ],
      sidebar: {
        '/getting-started/': [
          {
            text: 'Getting Started',
            items: [
              { text: 'Overview', link: '/getting-started/' },
              { text: 'Install And First Run', link: '/getting-started/install' },
              { text: 'Run Your First Study', link: '/getting-started/first-study' },
              { text: 'Troubleshooting', link: '/getting-started/troubleshooting' }
            ]
          }
        ],
        '/cli/': [
          {
            text: 'CLI & Configuration',
            items: [
              { text: 'Overview', link: '/cli/' },
              { text: 'Commands', link: '/cli/commands' },
              { text: 'config.yml', link: '/cli/configuration' },
              { text: 'Secrets And .env', link: '/cli/secrets' },
              { text: 'Runtime Directory', link: '/cli/runtime-directory' },
              { text: 'Docker Compose Stack', link: '/cli/compose' }
            ]
          }
        ],
        '/platform/': [
          {
            text: 'Platform',
            items: [
              { text: 'Overview', link: '/platform/' },
              { text: 'Architecture', link: '/platform/architecture' },
              { text: 'Runtime Topology', link: '/platform/runtime-topology' },
              { text: 'Study And Session Lifecycle', link: '/platform/lifecycle' },
              { text: 'Overlay And Widgets', link: '/platform/overlay-and-widgets' },
              { text: 'Simulators', link: '/platform/simulators' },
              { text: 'Sensors And IO', link: '/platform/sensors-and-io' },
              { text: 'Data And Realtime', link: '/platform/data-and-realtime' },
              { text: 'Security Model', link: '/platform/security' }
            ]
          }
        ],
        '/operations/': [
          {
            text: 'Operations',
            items: [
              { text: 'Overview', link: '/operations/' },
              { text: 'Start And Stop', link: '/operations/start-and-stop' },
              { text: 'Accounts And Access', link: '/operations/accounts-and-access' },
              { text: 'Study Setup', link: '/operations/study-setup' },
              { text: 'Study Readiness', link: '/operations/study-readiness' },
              { text: 'Running A Session', link: '/operations/running-a-session' },
              { text: 'Logs And Exports', link: '/operations/logs-and-exports' },
              { text: 'Incidents And Recovery', link: '/operations/incidents-and-recovery' }
            ]
          }
        ],
        '/builders/': [
          {
            text: 'Builders',
            items: [
              { text: 'Overview', link: '/builders/' },
              { text: 'Local Development', link: '/builders/local-development' },
              { text: 'Contracts And CoreAPI', link: '/builders/contracts-and-core-api' },
              { text: 'Building Widgets', link: '/builders/widgets' },
              { text: 'Simulator Adapters', link: '/builders/simulator-adapters' },
              { text: 'Sensor Drivers', link: '/builders/sensor-drivers' },
              { text: 'Database Changes', link: '/builders/database' },
              { text: 'Testing', link: '/builders/testing' },
              { text: 'Editing These Docs', link: '/builders/documentation' }
            ]
          }
        ],
        '/reference/': [
          {
            text: 'Reference',
            items: [
              { text: 'Overview', link: '/reference/' },
              { text: 'CoreAPI Routes', link: '/reference/core-api' },
              { text: 'Realtime Channels', link: '/reference/realtime' },
              { text: 'Messaging', link: '/reference/messaging' },
              { text: 'Contracts', link: '/reference/contracts' },
              { text: 'Database Schema', link: '/reference/database' },
              { text: 'Widgets And Layouts', link: '/reference/widgets-and-layouts' },
              { text: 'Admin Panel And RBAC', link: '/reference/admin-panel' },
              { text: 'Configuration Keys', link: '/reference/configuration' },
              { text: 'Ports And Endpoints', link: '/reference/ports' },
              { text: 'Error Codes', link: '/reference/error-codes' }
            ]
          }
        ]
      },
      footer: {
        message: 'SCARline Platform Documentation',
        copyright: 'Technische Hochschule Ingolstadt'
      }
    }
  })
);
