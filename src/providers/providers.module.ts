import { Module } from '@nestjs/common';
import { MockProvider } from './mock/mock.provider';
import { ByteplusProvider } from './byteplus/byteplus.provider';
import { ProviderRegistry } from './provider.registry';
import { GENERATION_PROVIDERS } from './provider.interface';

@Module({
  providers: [
    MockProvider,
    ByteplusProvider,
    {
      // Register all providers behind the DI token the registry consumes.
      provide: GENERATION_PROVIDERS,
      useFactory: (mock: MockProvider, byteplus: ByteplusProvider) => [
        mock,
        byteplus,
      ],
      inject: [MockProvider, ByteplusProvider],
    },
    ProviderRegistry,
  ],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
