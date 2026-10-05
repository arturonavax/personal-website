/**
 * Header navigation active-state resolution (SPEC-007 REQ-4).
 *
 * "Services" is a first-level item, so a /services route must never light the
 * "More" dropdown, even when other More routes would otherwise match.
 */

export const MORE_ROUTES: readonly string[] = ["/blog/"];

export interface HeaderNavState {
  isServicesActive: boolean;
  isMoreActive: boolean;
}

export function resolveHeaderNavState(pathname: string): HeaderNavState {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const isServicesActive = path.includes("/services/");
  const isMoreActive =
    MORE_ROUTES.some((route) => path.includes(route)) && !isServicesActive;
  return { isServicesActive, isMoreActive };
}
