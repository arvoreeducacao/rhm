import { next, rewrite } from '@vercel/edge';

export const config = {
  matcher: ['/', '/docs/:path*', '/releases/:path*', '/directory', '/careers'],
};

export default function middleware(request: Request) {
  const accept = request.headers.get('accept') || '';

  if (accept.includes('text/markdown') && !accept.includes('text/html')) {
    const url = new URL('/llms-full.txt', request.url);
    return rewrite(url, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    });
  }

  return next();
}
