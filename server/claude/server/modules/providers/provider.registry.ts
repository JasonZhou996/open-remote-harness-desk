import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * This build indexes and runs Claude Code only.
 *
 * `LLMProvider` still names the other harnesses on purpose: a session row
 * carries its harness in a column rather than living in a harness-specific
 * table, so adding one back is a matter of writing its adapter and adding a
 * line here — nothing else in the schema or the session pipeline changes.
 */
const providers: Partial<Record<LLMProvider, IProvider>> = {
  claude: new ClaudeProvider(),
};

/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
  listProviders(): IProvider[] {
    return Object.values(providers).filter((provider): provider is IProvider => Boolean(provider));
  },

  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = providers[key];
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};
