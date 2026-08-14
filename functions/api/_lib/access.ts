/**
 * Document ownership rules.
 *
 * Lives under an underscore-prefixed directory so Pages Functions routing
 * ignores it — files here are modules, never routes.
 *
 * The model has three deliberate states:
 *
 * 1. No authenticated identity (`requester` null): Cloudflare Access is not in
 *    front of this deployment, so there is no identity boundary to enforce.
 *    Everything is allowed — this is the local-dev and single-trust case.
 * 2. Document with no owner (`ownerEmail` null): created before Access was
 *    enabled, or through a path that carried no identity. Grandfathered as
 *    accessible to any authenticated user, because the alternative is locking
 *    every pre-existing document out of its own deployment.
 * 3. Both present: emails must match, case-insensitively.
 *
 * Read the identity ONLY from `Cf-Access-Authenticated-User-Email`. Cloudflare
 * Access injects that header after verifying the session and strips any
 * client-supplied value at the edge, so it cannot be spoofed through the
 * protected hostname. It must never be read from a query parameter or body.
 */

export function requesterEmail(request: Request): string | null {
  return request.headers.get('Cf-Access-Authenticated-User-Email')
}

export function canAccessDocument(ownerEmail: string | null | undefined, requester: string | null): boolean {
  if (!requester) return true
  if (!ownerEmail) return true
  return ownerEmail.trim().toLowerCase() === requester.trim().toLowerCase()
}
