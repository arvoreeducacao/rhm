import { next } from '@vercel/edge';

export const config = {
  matcher: ['/', '/docs/:path*', '/releases/:path*', '/directory', '/careers'],
};

export default async function middleware(request: Request) {
  const accept = request.headers.get('accept') || '';

  if (accept.includes('text/markdown') && !accept.includes('text/html')) {
    const url = new URL('/llms-full.txt', request.url);
    const res = await fetch(url);
    const body = await res.text();
    const tokenCount = body.split(/\s+/).length;

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'x-markdown-source': 'llms-full.txt',
        'x-markdown-tokens': String(tokenCount),
      },
    });
  }

  return next();
}
