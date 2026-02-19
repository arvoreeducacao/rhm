import satori from 'satori';
import sharp from 'sharp';

export const sectionMap: Record<string, string> = {
  'getting-started': 'Getting Started',
  configuration: 'Getting Started',
  cli: 'Getting Started',
  repos: 'Configuration',
  tools: 'Configuration',
  environment: 'Configuration',
  services: 'Configuration',
  integrations: 'Configuration',
  workflow: 'Configuration',
  agents: 'Core Concepts',
  skills: 'Core Concepts',
  mcps: 'Core Concepts',
  hooks: 'Core Concepts',
  commands: 'Core Concepts',
  worktrees: 'Core Concepts',
  philosophy: 'About',
  'our-story': 'About',
  'best-practices': 'About',
  'product-engineer': 'About',
  roadmap: 'Project',
};

async function loadGoogleFont(font: string, weight: number): Promise<ArrayBuffer> {
  const API = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@${weight}`;
  const css = await fetch(API, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1',
    },
  }).then((r) => r.text());

  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);
  if (!resource) throw new Error(`Failed to load font: ${font} ${weight}`);
  return fetch(resource[1]).then((r) => r.arrayBuffer());
}

let fontCache: {
  interBold: ArrayBuffer;
  interRegular: ArrayBuffer;
  interMedium: ArrayBuffer;
} | null = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  const [interBold, interRegular, interMedium] = await Promise.all([
    loadGoogleFont('Inter', 800),
    loadGoogleFont('Inter', 400),
    loadGoogleFont('Inter', 500),
  ]);
  fontCache = { interBold, interRegular, interMedium };
  return fontCache;
}

interface OgImageOptions {
  title: string;
  description?: string;
  section?: string;
}

export async function generateOgImage({
  title,
  description,
  section,
}: OgImageOptions): Promise<Buffer> {
  const fonts = await loadFonts();

  const titleLength = title.length;
  const fontSize =
    titleLength <= 20 ? 68 : titleLength <= 35 ? 58 : titleLength <= 55 ? 48 : 42;

  const truncatedDesc =
    description && description.length > 120
      ? description.slice(0, 117) + '...'
      : description;

  const headerChildren: any[] = [
    {
      type: 'div',
      props: {
        style: {
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: '#10b981',
        },
      },
    },
    {
      type: 'span',
      props: {
        style: {
          fontSize: '15px',
          letterSpacing: '0.12em',
          color: '#9ca3af',
          fontWeight: 500,
        },
        children: 'REPO HUB',
      },
    },
  ];

  if (section) {
    headerChildren.push(
      {
        type: 'span',
        props: {
          style: { color: '#e5e7eb', fontSize: '15px', margin: '0 2px' },
          children: '·',
        },
      },
      {
        type: 'span',
        props: {
          style: {
            fontSize: '14px',
            letterSpacing: '0.08em',
            color: '#10b981',
            fontWeight: 500,
          },
          children: section.toUpperCase(),
        },
      },
    );
  }

  const contentChildren: any[] = [
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        },
        children: headerChildren,
      },
    },
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexGrow: 1,
          alignItems: 'center',
          paddingTop: '8px',
        },
        children: {
          type: 'div',
          props: {
            style: {
              fontSize: `${fontSize}px`,
              fontWeight: 800,
              color: '#111827',
              lineHeight: 1.2,
              letterSpacing: '-0.025em',
              maxWidth: '920px',
            },
            children: title,
          },
        },
      },
    },
  ];

  if (truncatedDesc) {
    contentChildren.push({
      type: 'div',
      props: {
        style: {
          fontSize: '22px',
          color: '#9ca3af',
          lineHeight: 1.5,
          fontWeight: 400,
          maxWidth: '800px',
          paddingBottom: '16px',
        },
        children: truncatedDesc,
      },
    });
  }

  contentChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid #f3f4f6',
        paddingTop: '22px',
      },
      children: [
        {
          type: 'span',
          props: {
            style: {
              fontSize: '15px',
              color: '#d1d5db',
              fontWeight: 400,
              letterSpacing: '0.01em',
            },
            children: 'hub.arvore.com.br',
          },
        },
        {
          type: 'span',
          props: {
            style: {
              fontSize: '13px',
              color: '#d1d5db',
              fontWeight: 400,
              letterSpacing: '0.02em',
            },
            children: 'Built by Arvore',
          },
        },
      ],
    },
  });

  const element = {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(145deg, #ffffff 0%, #fafbfc 100%)',
        position: 'relative',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              width: '100%',
              height: '6px',
              background: 'linear-gradient(90deg, #10b981 0%, #45D0C1 100%)',
              flexShrink: 0,
            },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: '-120px',
              right: '-60px',
              width: '450px',
              height: '450px',
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0) 70%)',
            },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              padding: '48px 70px 40px',
            },
            children: contentChildren,
          },
        },
      ],
    },
  };

  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: fonts.interBold, weight: 800, style: 'normal' as const },
      {
        name: 'Inter',
        data: fonts.interRegular,
        weight: 400,
        style: 'normal' as const,
      },
      {
        name: 'Inter',
        data: fonts.interMedium,
        weight: 500,
        style: 'normal' as const,
      },
    ],
  });

  return sharp(Buffer.from(svg)).png().toBuffer();
}
