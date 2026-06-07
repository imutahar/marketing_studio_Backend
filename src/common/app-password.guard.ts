import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Shared-password access gate. When APP_PASSWORD is set, every request must
 * carry a matching `x-app-password` header. When it's unset the gate is
 * disabled (local/dev and pre-rollout prod keep working unchanged).
 *
 * The health check is always exempt so cloud healthchecks (Railway) still pass.
 */
@Injectable()
export class AppPasswordGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('APP_PASSWORD');
    // Gate disabled when env unset.
    if (!expected) return true;

    const req = context.switchToHttp().getRequest<Request>();

    // Exempt the health check (global prefix 'api' → /api/health) so cloud
    // healthchecks keep passing without the shared password.
    if (req.path?.endsWith('/health')) return true;

    // Express lowercases header names.
    const provided = req.headers['x-app-password'];
    if (provided === expected) return true;

    throw new UnauthorizedException('App password required.');
  }
}
