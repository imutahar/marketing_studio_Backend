import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DEFAULT_OWNER } from './owner';

type RequestWithUser = Request & { user?: { id: string } };

/**
 * Shared-password access gate. When APP_PASSWORD is set, every request must
 * carry a matching `x-app-password` header. When it's unset the gate is
 * disabled (local/dev and pre-rollout prod keep working unchanged).
 *
 * The health check is always exempt so cloud healthchecks (Railway) still pass.
 *
 * On every allowed request (gate enabled or disabled) it also stamps
 * `req.user = { id: DEFAULT_OWNER }` so downstream `@CurrentUser()` always
 * resolves an owner. This is the seam where the future authenticated owner will
 * be set; today there's a single hard-coded owner.
 */
@Injectable()
export class AppPasswordGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const expected = this.config.get<string>('APP_PASSWORD');

    // Gate disabled when env unset.
    if (!expected) {
      this.attachOwner(req);
      return true;
    }

    // Exempt the health check (global prefix 'api' → /api/health) so cloud
    // healthchecks keep passing without the shared password.
    if (req.path?.endsWith('/health')) {
      this.attachOwner(req);
      return true;
    }

    // Express lowercases header names.
    const provided = req.headers['x-app-password'];
    if (provided === expected) {
      this.attachOwner(req);
      return true;
    }

    throw new UnauthorizedException('App password required.');
  }

  /** Stamp the single hard-coded owner on the request (user-context seam). */
  private attachOwner(req: RequestWithUser): void {
    req.user = { id: DEFAULT_OWNER };
  }
}
