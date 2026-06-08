import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DEFAULT_OWNER } from './owner';

/**
 * Resolves the owning tenant for the current request. The AppPasswordGuard
 * stamps `req.user = { id: DEFAULT_OWNER }` on every allowed request, so this
 * always returns a string. Falls back to DEFAULT_OWNER defensively.
 *
 * Controllers use `@CurrentUser() ownerId: string` and thread it into the
 * service layer — the single seam through which the future authenticated owner
 * will flow.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } }>();
    return req.user?.id ?? DEFAULT_OWNER;
  },
);
