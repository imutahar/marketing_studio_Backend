import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GENERATION_PROVIDERS, GenerationProvider } from './provider.interface';
import { Capability } from '../common/generation.types';

/** Selects which provider handles a given capability. */
@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(GENERATION_PROVIDERS)
    private readonly providers: GenerationProvider[],
    private readonly config: ConfigService,
  ) {}

  /**
   * Prefer the configured provider (GENERATION_PROVIDER, default 'mock'); fall
   * back to any provider that supports the capability.
   */
  resolve(capability: Capability): GenerationProvider {
    const preferred = this.config.get<string>('GENERATION_PROVIDER', 'mock');

    const configured = this.providers.find(
      (p) => p.name === preferred && p.supports(capability),
    );
    if (configured) return configured;

    const fallback = this.providers.find((p) => p.supports(capability));
    if (!fallback) {
      throw new ServiceUnavailableException(
        `No generation provider supports "${capability}".`,
      );
    }
    return fallback;
  }

  list(): string[] {
    return this.providers.map((p) => p.name);
  }
}
