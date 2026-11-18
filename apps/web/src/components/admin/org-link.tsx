'use client';

// links, the router and the current path for staff pages, with the business in the address.
// pages write '/admin/stock/1' and get '/admin/<slug>/stock/1'. outside a business (super admin
// screens, customer pages) everything passes through unchanged.

import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, forwardRef, useContext, useMemo, type ComponentProps } from 'react';
import { adminLocation, orgPath } from '@/lib/admin-path';

export const OrgSlugCtx = createContext<string | null>(null);

export function useOrgSlug(): string | null {
  return useContext(OrgSlugCtx);
}

type LinkProps = ComponentProps<typeof NextLink>;

const OrgLink = forwardRef<HTMLAnchorElement, LinkProps>(function OrgLink({ href, ...rest }, ref) {
  const slug = useContext(OrgSlugCtx);
  const mapped = typeof href === 'string' ? orgPath(href, slug) : href;
  return <NextLink ref={ref} href={mapped} {...rest} />;
});

export default OrgLink;

// useRouter with the business put into every address
export function useOrgRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  const slug = useContext(OrgSlugCtx);
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(orgPath(href, slug), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(orgPath(href, slug), options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(orgPath(href, slug), options),
  }), [router, slug]);
}

// the current page in the short form ('/admin/stock/1'), for active tabs and route checks
export function useSectionPath(): string {
  const pathname = usePathname();
  return adminLocation(pathname).section;
}

export function useOrgHref(): (href: string) => string {
  const slug = useContext(OrgSlugCtx);
  return (href: string) => orgPath(href, slug);
}
