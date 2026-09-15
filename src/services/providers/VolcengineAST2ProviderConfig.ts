import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions, ParticipantSessionResult, PrepareOutcome, PreparePorts, type CredentialField } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, VolcengineAST2SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';
import i18n from '../../locales';

// Volcengine AST 2.0 Settings
export interface VolcengineAST2Settings {
  /** API Key created in the current Volcengine Speech console. */
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  /** Library ID for Volcengine self-learning platform Hot Words. Empty = disabled. */
  hotWordTableId: string;
  /** Library ID for Volcengine self-learning platform Replacement. Empty = disabled. */
  replacementTableId: string;
  /** Library ID for Volcengine self-learning platform Glossary. Empty = disabled. */
  glossaryTableId: string;
}

export const defaultVolcengineAST2Settings: VolcengineAST2Settings = {
  apiKey: '',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto',
  hotWordTableId: '',
  replacementTableId: '',
  glossaryTableId: '',
};

export class VolcengineAST2ProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'volcengineAST2';
  readonly supportsWebRTC = false;
  readonly credentialFields: readonly CredentialField[] = [
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
  ];

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const s = slice as VolcengineAST2Settings;
    if (!s?.apiKey?.trim()) {
      return { ok: false, missing: 'API Key is required for Doubao AST 2.0' };
    }
    return { ok: true, primary: s.apiKey.trim() };
  }

  peekPrimaryCredential(slice: unknown): string {
    return String((slice as VolcengineAST2Settings)?.apiKey ?? '');
  }

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new VolcengineAST2Client(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return VolcengineAST2Client.validateApiKeyAndFetchModels(creds.primary);
  }

  /**
   * AST 2.0 accepts `zhen`/`zhen` for its special Chinese↔English mode, but
   * rejects every ordinary same-language direction (for example zh→zh). A
   * persisted setting can predate the UI reconciliation, so block it here as
   * well, before the socket and audio capture are started.
   */
  async prepareToStart(slice: unknown, _ports: PreparePorts): Promise<PrepareOutcome> {
    const { sourceLanguage, targetLanguage } = slice as Partial<VolcengineAST2Settings>;
    if (sourceLanguage === targetLanguage && sourceLanguage !== 'zhen') {
      const language = String(i18n.language ?? 'en');
      const message = language.startsWith('zh')
        ? '豆包同声传译 2.0 不支持相同的源语言和目标语言，请选择不同的语言。'
        : language.startsWith('ja')
          ? '豆包同時通訳 2.0 では、入力言語と出力言語に異なる言語を選択してください。'
          : 'Doubao Simultaneous Translation 2.0 requires different source and target languages.';
      return { ok: false, message };
    }
    return { ok: true };
  }

  // The kizuna doubao twin inherits this builder (reads its own slice).
  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as VolcengineAST2Settings;
    const hotWordTableId = settings.hotWordTableId?.trim() || undefined;
    const replacementTableId = settings.replacementTableId?.trim() || undefined;
    const glossaryTableId = settings.glossaryTableId?.trim() || undefined;

    return {
      provider: 'volcengine_ast2',
      model: 'ast-v2-s2s',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      turnDetectionMode: settings.turnDetectionMode,
      hotWordTableId,
      replacementTableId,
      glossaryTableId,
    } as VolcengineAST2SessionConfig;
  }

  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const result = super.buildParticipantSessionConfig(slice, swappedInstructions, shell);
    // Volcengine providers carry language direction in explicit config fields
    // (not system instructions), so we must swap sourceLanguage/targetLanguage
    // for the participant session to reverse the translation direction.
    const ast2 = result.config as VolcengineAST2SessionConfig;
    [ast2.sourceLanguage, ast2.targetLanguage] = [ast2.targetLanguage, ast2.sourceLanguage];
    return result;
  }

  // AST 2.0 supported languages (s2s mode)
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Français', value: 'fr', englishName: 'French' },
  ];

  // Bidirectional language pair
  private static readonly BIDIRECTIONAL_LANGUAGES: LanguageOption[] = [
    ...VolcengineAST2ProviderConfig.LANGUAGES,
    { name: '中英双语 (zh↔en)', value: 'zhen', englishName: 'Chinese-English Bidirectional' },
  ];

  // No voice selection - server auto-clones speaker voice in s2s mode
  private static readonly VOICES: VoiceOption[] = [];

  private static readonly MODELS: ModelOption[] = [
    { id: 'ast-v2-s2s', type: 'realtime' }
  ];

  // resolveSourceLanguages/resolveTargetLanguages use the BaseProviderDescriptor
  // defaults, which read getConfig().languages — equal to BIDIRECTIONAL_LANGUAGES
  // for both, matching this class's former static behavior.

  getConfig(): ProviderConfig {
    return {
      id: 'volcengine_ast2',
      displayName: 'Doubao AST 2.0',

      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your Volcengine API Key',

      languages: VolcengineAST2ProviderConfig.BIDIRECTIONAL_LANGUAGES,
      voices: VolcengineAST2ProviderConfig.VOICES,
      models: VolcengineAST2ProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: true,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional',

        turnDetection: {
          modes: ['Auto', 'Push-to-Talk'],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },

        pushGatedModes: ['Push-to-Talk', 'Push-to-Translate'],
        // 500 ms silence tail for the server VAD; AST2 creates the response
        // server-side, so the client never calls createResponse on release.
        pttFinalization: { silenceTailFrames: 5, response: 'server-decides' },
      },
    };
  }
}
