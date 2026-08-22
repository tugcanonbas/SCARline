import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(defineConfig({
  title: 'SCARline Docs',
  description:
    'Product-first documentation for operating, extending, and understanding the SCARline research platform.',
  base: '/docs/',
  appearance: false,
  lastUpdated: true,
  cleanUrls: true,
  mermaid: {
    theme: 'base',
    flowchart: {
      curve: 'basis'
    },
    sequence: {
      mirrorActors: false
    },
    themeVariables: {
      primaryColor: '#ffffff',
      primaryTextColor: '#080e10',
      primaryBorderColor: '#080e10',
      lineColor: '#080e10',
      secondaryColor: '#eef1f1',
      tertiaryColor: '#f2f4f4',
      clusterBkg: '#ffffff',
      clusterBorder: '#080e10',
      actorBkg: '#ffffff',
      actorBorder: '#080e10',
      actorTextColor: '#080e10',
      labelBoxBkgColor: '#ffffff',
      labelBoxBorderColor: '#080e10',
      labelTextColor: '#080e10',
      noteBkgColor: '#eef1f1',
      noteBorderColor: '#080e10',
      noteTextColor: '#080e10',
      signalColor: '#080e10',
      signalTextColor: '#080e10',
      edgeLabelBackground: '#ffffff',
      mainBkg: '#ffffff',
      nodeBorder: '#080e10',
      nodeTextColor: '#080e10',
      fontFamily: '"IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif'
    }
  },
  themeConfig: {
    search: {
      provider: 'local'
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'Platform', link: '/platform/' },
      { text: 'Operations', link: '/operations/' },
      { text: 'Builders', link: '/builders/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Roles', link: '/roles/' }
    ],
    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Overview', link: '/getting-started/' },
            { text: 'Run Your First Study', link: '/getting-started/first-study' },
            { text: 'Run Locally', link: '/getting-started/local-development' },
            { text: 'Troubleshooting Entry Points', link: '/getting-started/troubleshooting' }
          ]
        }
      ],
      '/platform/': [
        {
          text: 'Platform',
          items: [
            { text: 'Platform Overview', link: '/platform/' },
            { text: 'Architecture', link: '/platform/architecture' },
            { text: 'Study Lifecycle', link: '/platform/study-lifecycle' },
            { text: 'Runtime Topology', link: '/platform/runtime-topology' },
            { text: 'Overlay And Widgets', link: '/platform/overlay-and-widgets' },
            { text: 'Simulator And Sensors', link: '/platform/simulator-and-sensors' },
            { text: 'Data And Realtime', link: '/platform/data-and-realtime' }
          ]
        }
      ],
      '/operations/': [
        {
          text: 'Operations',
          items: [
            { text: 'Operations Overview', link: '/operations/' },
            { text: 'Startup And Shutdown', link: '/operations/startup-and-shutdown' },
            { text: 'Onboarding And Access', link: '/operations/onboarding-and-access' },
            { text: 'Study Readiness', link: '/operations/study-readiness' },
            {
              text: 'Active Session Operations',
              link: '/operations/active-session-operations'
            },
            { text: 'Exports And Evidence', link: '/operations/exports-and-evidence' },
            { text: 'Incidents And Recovery', link: '/operations/incidents-and-recovery' }
          ]
        }
      ],
      '/builders/': [
        {
          text: 'Builders',
          items: [
            { text: 'Builder Overview', link: '/builders/' },
            { text: 'Local Development', link: '/builders/local-development' },
            {
              text: 'Extending CoreAPI And Contracts',
              link: '/builders/extending-coreapi-and-contracts'
            },
            {
              text: 'Extending Widgets And Layouts',
              link: '/builders/extending-widgets-and-layouts'
            },
            {
              text: 'Extending Simulators And Sensors',
              link: '/builders/extending-simulators-and-sensors'
            },
            { text: 'Testing And Validation', link: '/builders/testing-and-validation' },
            { text: 'Troubleshooting', link: '/builders/troubleshooting' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Reference Overview', link: '/reference/' },
            { text: 'CoreAPI', link: '/reference/core-api' },
            { text: 'Realtime And Events', link: '/reference/realtime-and-events' },
            { text: 'Contracts', link: '/reference/contracts' },
            { text: 'Widgets And Layouts', link: '/reference/widgets-and-layouts' },
            { text: 'Runtime Config', link: '/reference/runtime-config' },
            { text: 'UI And RBAC', link: '/reference/ui-and-rbac' }
          ]
        }
      ],
      '/roles/': [
        {
          text: 'Roles',
          items: [
            { text: 'Role Overview', link: '/roles/' },
            { text: 'Developers', link: '/developers/' },
            { text: 'Researchers', link: '/researchers/' },
            { text: 'Designers', link: '/designers/' },
            { text: 'Admins', link: '/admins/' }
          ]
        }
      ],
      '/developers/': [
        {
          text: 'Developers',
          items: [
            { text: 'Developer Home', link: '/developers/' }
          ]
        }
      ],
      '/researchers/': [
        {
          text: 'Researchers',
          items: [
            { text: 'Researcher Home', link: '/researchers/' }
          ]
        }
      ],
      '/designers/': [
        {
          text: 'Designers',
          items: [
            { text: 'Designer Home', link: '/designers/' }
          ]
        }
      ],
      '/admins/': [
        {
          text: 'Admins',
          items: [
            { text: 'Admin Home', link: '/admins/' }
          ]
        }
      ]
    },
    footer: {
      message: 'SCARline Product Documentation',
      copyright: 'Copyright SCARline'
    }
  },
  vite: {
    server: {
      watch: {
        usePolling: true,
        interval: 1000
      },
      host: '0.0.0.0',
      port: 4040,
      hmr: {
        clientPort: 8088
      }
    }
  }
}));
