import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getLanguageOption } from '../../../utils/languages';
import ToggleSwitch from '../../../components/Settings/shared/ToggleSwitch';
import { recordingService, type AliyunCloudProfileStatus, type RecordingConnectionCatalogItem, type RecordingProviderCatalog, type RecordingProviderStatus, type RecordingProfileStatus } from '../services/recordingService';
import { defaultRecordingJobConfig, type RecordingJobConfig, type RecordingProviderId, type RecordingSpeechEngineId } from '../types/recording';
import './RecordingSettingsSection.scss';

const LANGUAGES = ['zh', 'en', 'ja'];
const PROFILE_IDS = ['speech.private-moss', 'speech.private-funasr', 'translation.private', 'summary.private'];
const CLOUD_PROFILE_IDS = ['speech.aliyun', 'translation.aliyun', 'summary.aliyun'];
const PROVIDERS: RecordingProviderId[] = ['private-runtime', 'aliyun-cloud'];
const SELECT_CLASS_NAME = 'select-dropdown recording-settings__select';
type PrivateDraft = { runtimeBaseUrl: string; token: string };
type CloudDraft = Record<string, string>;

const RecordingSettingsSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<RecordingJobConfig>(defaultRecordingJobConfig());
  const [catalog, setCatalog] = useState<RecordingProviderCatalog | null>(null);
  const [privateProfiles, setPrivateProfiles] = useState<Record<string, RecordingProfileStatus>>({});
  const [cloudProfiles, setCloudProfiles] = useState<Record<string, AliyunCloudProfileStatus>>({});
  const [privateDrafts, setPrivateDrafts] = useState<Record<string, PrivateDraft>>({});
  const [cloudDrafts, setCloudDrafts] = useState<Record<string, CloudDraft>>({});
  const [statuses, setStatuses] = useState<Record<string, RecordingProviderStatus>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [savingProfile, setSavingProfile] = useState<string | null>(null);
  const privateDraftsRef = useRef<Record<string, PrivateDraft>>({});
  const privateSaveQueues = useRef<Record<string, Promise<void>>>({});
  const cloudSaveQueues = useRef<Record<string, Promise<void>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [statusRevision, setStatusRevision] = useState(0);
  const isZh = i18n.language.startsWith('zh'); const isJa = i18n.language.startsWith('ja');
  const label = (providerId: RecordingProviderId) => t(`recording.provider.${providerId === 'private-runtime' ? 'private' : 'aliyun'}`);
  const statusKey = (stage: string, profile: string) => `${stage}:${profile}`;
  const stateText = (status?: RecordingProviderStatus) => {
    if (!status || status.state === 'unconfigured') return t('recording.runtimeState.unconfigured');
    if (status.state === 'ready') return status.engineId
      ? t('recording.runtimeConnected', { model: status.modelId || engineLabel(status.engineId) })
      : t('recording.serviceReady', { model: status.modelId || '', revision: status.profileRevision || '' });
    if (status.state === 'disabled') return status.engineId ? t('recording.runtimeState.disabled', { engine: engineLabel(status.engineId) }) : t('recording.modelUnavailable');
    if (status.detail === 'worker-unreachable') return t('recording.runtimeState.workerUnavailable', { engine: status.engineId ? engineLabel(status.engineId) : '' });
    return t('recording.runtimeState.unavailable', { detail: status.detail || '' });
  };
  const profileLabel = (profileId: string) => t(`recording.connection.${profileId.replace(/[.-]/g, '_')}`);
  const engineLabel = (engineId: RecordingSpeechEngineId) => t(`recording.engine.${engineId.replace('-', '_')}`);

  const refresh = async () => {
    const [saved, nextCatalog, privateEntries, cloudEntries] = await Promise.all([
      recordingService.processingSettings(), recordingService.providerCatalog(),
      Promise.all(PROFILE_IDS.map(async (id) => [id, await recordingService.profileStatus(id)] as const)),
      Promise.all(CLOUD_PROFILE_IDS.map(async (id) => [id, await recordingService.aliyunProfileStatus(id)] as const)),
    ]);
    const privateStatus = Object.fromEntries(privateEntries); const cloudStatus = Object.fromEntries(cloudEntries);
    setConfig(saved); setCatalog(nextCatalog); setPrivateProfiles(privateStatus); setCloudProfiles(cloudStatus);
    setPrivateDrafts((current) => {
      const next = Object.fromEntries(PROFILE_IDS.map((id) => [id, { runtimeBaseUrl: current[id]?.runtimeBaseUrl ?? privateStatus[id].runtimeBaseUrl ?? '', token: current[id]?.token ?? privateStatus[id].secret ?? '' }]));
      privateDraftsRef.current = next;
      return next;
    });
    setCloudDrafts((current) => Object.fromEntries(CLOUD_PROFILE_IDS.map((id) => {
      const status = cloudStatus[id];
      return [id, { ...current[id], workspaceId: current[id]?.workspaceId ?? status.workspaceId ?? '', apiBaseUrl: current[id]?.apiBaseUrl ?? status.apiBaseUrl ?? '', modelId: current[id]?.modelId ?? status.modelId ?? '', ossBucket: current[id]?.ossBucket ?? status.ossBucket ?? '', ossEndpoint: current[id]?.ossEndpoint ?? status.ossEndpoint ?? '', objectPrefix: current[id]?.objectPrefix ?? status.objectPrefix ?? 'sokuji-recordings', dashscopeApiKey: current[id]?.dashscopeApiKey ?? status.dashscopeApiKey ?? '', ossAccessKeyId: current[id]?.ossAccessKeyId ?? status.ossAccessKeyId ?? '', ossAccessKeySecret: current[id]?.ossAccessKeySecret ?? status.ossAccessKeySecret ?? '' }];
    })));
  };
  useEffect(() => { void refresh().catch((error) => setNotice(error instanceof Error ? error.message : t('recording.settingsSaveFailed'))); }, []);
  useEffect(() => {
    const selections: Array<['speech' | 'translation' | 'summary', RecordingJobConfig['speech'] | RecordingJobConfig['translation'] | RecordingJobConfig['summary']]> = [['speech', config.speech]];
    if (config.translation.enabled) selections.push(['translation', config.translation]);
    if (config.summary.enabled) selections.push(['summary', config.summary]);
    void Promise.all(selections.map(async ([stage, selection]) => [statusKey(stage, selection.connectionProfileId), await recordingService.providerStatus(stage, selection)] as const)).then((entries) => setStatuses((old) => ({ ...old, ...Object.fromEntries(entries) }))).catch(() => undefined);
  }, [config.speech.providerId, config.speech.connectionProfileId, config.speech.engineId, config.translation.enabled, config.translation.providerId, config.translation.connectionProfileId, config.summary.enabled, config.summary.providerId, config.summary.connectionProfileId, statusRevision]);
  const persist = async (next: RecordingJobConfig) => { setConfig(next); setNotice(null); try { setConfig(await recordingService.saveProcessingSettings(next)); } catch (error) { setNotice(error instanceof Error ? error.message : t('recording.settingsSaveFailed')); } };
  const update = (patch: Partial<RecordingJobConfig>) => void persist({ ...config, ...patch });
  const savePrivate = (profileId: string, draft: PrivateDraft) => {
    setNotice(null);
    setSavingProfile(profileId);
    const previous = privateSaveQueues.current[profileId] || Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const saved = await recordingService.saveProfileCredential(profileId, draft.token.trim(), draft.runtimeBaseUrl.trim());
      setPrivateProfiles((current) => ({ ...current, [profileId]: saved }));
    });
    privateSaveQueues.current[profileId] = queued;
    void queued.catch((error) => {
      if (privateSaveQueues.current[profileId] === queued) setNotice(error instanceof Error ? error.message : t('recording.settingsSaveFailed'));
    }).finally(() => {
      if (privateSaveQueues.current[profileId] === queued) setSavingProfile((current) => current === profileId ? null : current);
    });
  };
  const setPrivateDraft = (profileId: string, patch: Partial<PrivateDraft>) => {
    const next = { ...(privateDraftsRef.current[profileId] || { runtimeBaseUrl: '', token: '' }), ...patch };
    privateDraftsRef.current = { ...privateDraftsRef.current, [profileId]: next };
    setPrivateDrafts((current) => ({ ...current, [profileId]: next }));
    savePrivate(profileId, next);
  };
  const saveCloudPatch = (profileId: string, patch: CloudDraft) => {
    setNotice(null);
    setSavingProfile(profileId);
    const previous = cloudSaveQueues.current[profileId] || Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const saved = await recordingService.saveAliyunProfile(profileId, patch);
      setCloudProfiles((current) => ({ ...current, [profileId]: saved }));
      setStatusRevision((value) => value + 1);
    });
    cloudSaveQueues.current[profileId] = queued;
    void queued.catch((error) => setNotice(error instanceof Error ? error.message : t('recording.settingsSaveFailed'))).finally(() => {
      if (cloudSaveQueues.current[profileId] === queued) setSavingProfile((current) => current === profileId ? null : current);
    });
  };
  const SecretInput = ({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (next: string) => void; placeholder?: string }) => { const visible = Boolean(visibleSecrets[id]); return <span className="recording-settings__secret-input"><input type={visible ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} /><button type="button" aria-label={t('recording.toggleSecret')} aria-pressed={visible} onClick={() => setVisibleSecrets((old) => ({ ...old, [id]: !old[id] }))}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>; };
  const PrivateCard = ({ profileId }: { profileId: string }) => { const draft = privateDrafts[profileId] || { runtimeBaseUrl: '', token: '' }; const current = statuses[statusKey(profileId.startsWith('speech') ? 'speech' : profileId.startsWith('translation') ? 'translation' : 'summary', profileId)]; return <section className="recording-settings__service-card" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setStatusRevision((value) => value + 1); }}><div className="recording-settings__card-heading"><div><h3>{profileLabel(profileId)}</h3><p className={`recording-settings__state is-${current?.state || 'unconfigured'}`}>{stateText(current)}</p></div>{savingProfile === profileId && <LoaderCircle className="recording-spinner" size={16} />}</div><div className="recording-settings__form-grid"><label>Runtime URL<input type="url" value={draft.runtimeBaseUrl} placeholder="http://192.168.50.186:8080" onChange={(event) => setPrivateDraft(profileId, { runtimeBaseUrl: event.target.value })} /></label><label>{t('recording.runtimeToken')}<SecretInput id={`${profileId}:token`} value={draft.token} placeholder={privateProfiles[profileId]?.credentialConfigured ? t('recording.tokenSaved') : ''} onChange={(token) => setPrivateDraft(profileId, { token })} /></label></div></section>; };
  const CloudCard = ({ profileId, speech = false }: { profileId: string; speech?: boolean }) => {
    const draft = cloudDrafts[profileId] || {};
    const endpoint = draft.apiBaseUrl || '';
    const stage = profileId.startsWith('speech') ? 'speech' : profileId.startsWith('translation') ? 'translation' : 'summary';
    const modelId = stage === 'speech' ? 'qwen-audio-3.0-asr-flash-filetrans' : stage === 'translation' ? 'qwen-mt-plus' : 'qwen3.8-max';
    const setDraft = (key: string, value: string) => {
      setCloudDrafts((old) => ({ ...old, [profileId]: { ...(old[profileId] || {}), [key]: value } }));
      saveCloudPatch(profileId, { [key]: value });
      if (key === 'modelId' && config[stage].providerId === 'aliyun-cloud') {
        const next = stage === 'speech'
          ? { ...config, speech: { ...config.speech, modelId: value } }
          : { ...config, [stage]: { ...config[stage], modelId: value } };
        void persist(next);
      }
    };
    const modelServiceLabel = isZh ? '百炼模型服务' : isJa ? 'Bailian モデルサービス' : 'Bailian model service';
    const storageLabel = isZh ? 'OSS 对象存储' : isJa ? 'OSS オブジェクトストレージ' : 'OSS object storage';
    return <section className="recording-settings__service-card">
      <div className="recording-settings__card-heading"><h3>{profileLabel(profileId)}</h3>{savingProfile === profileId && <LoaderCircle className="recording-spinner" size={16} />}</div>
      <section className="recording-settings__cloud-group" aria-label={modelServiceLabel}>
        <h4>{modelServiceLabel}</h4>
        <div className="recording-settings__form-grid">
          <label>Workspace ID<input autoComplete="off" value={draft.workspaceId || ''} onChange={(event) => setDraft('workspaceId', event.target.value)} /></label>
          <label>API Endpoint<input type="url" autoComplete="off" value={endpoint} placeholder="https://{workspaceId}.cn-beijing.maas.aliyuncs.com" onChange={(event) => setDraft('apiBaseUrl', event.target.value)} /></label>
          <label>DashScope API Key<SecretInput id={`${profileId}:dashscopeApiKey`} value={draft.dashscopeApiKey || ''} placeholder={cloudProfiles[profileId]?.configured ? t('recording.tokenSaved') : ''} onChange={(value) => setDraft('dashscopeApiKey', value)} /></label>
          <label>{t('recording.model')}<input autoComplete="off" value={draft.modelId || modelId} onChange={(event) => setDraft('modelId', event.target.value)} /></label>
        </div>
      </section>
      {speech && <section className="recording-settings__cloud-group" aria-label={storageLabel}>
        <h4>{storageLabel}</h4>
        <div className="recording-settings__form-grid">
          <label>OSS Bucket<input autoComplete="off" value={draft.ossBucket || ''} onChange={(event) => setDraft('ossBucket', event.target.value)} /></label>
          <label>OSS Endpoint<input autoComplete="off" value={draft.ossEndpoint || ''} onChange={(event) => setDraft('ossEndpoint', event.target.value)} /></label>
          <label>OSS AccessKey ID<SecretInput id={`${profileId}:ossAccessKeyId`} value={draft.ossAccessKeyId || ''} onChange={(value) => setDraft('ossAccessKeyId', value)} /></label>
          <label>OSS AccessKey Secret<SecretInput id={`${profileId}:ossAccessKeySecret`} value={draft.ossAccessKeySecret || ''} onChange={(value) => setDraft('ossAccessKeySecret', value)} /></label>
          <label>OSS Prefix<input autoComplete="off" value={draft.objectPrefix || ''} onChange={(event) => setDraft('objectPrefix', event.target.value)} /></label>
        </div>
      </section>}
    </section>;
  };
  const connections = (stage: string, providerId: RecordingProviderId) => (catalog?.connections || []).filter((item: RecordingConnectionCatalogItem) => item.stage === stage && item.providerId === providerId);
  const speechStatus = statuses[statusKey('speech', config.speech.connectionProfileId)];
  const textStatus = (stage: 'translation' | 'summary') => statuses[statusKey(stage, config[stage].connectionProfileId)];
  const selectProvider = (stage: 'speech' | 'translation' | 'summary', providerId: RecordingProviderId) => {
    if (stage === 'speech') { const option = providerId === 'aliyun-cloud' ? { connectionProfileId: 'speech.aliyun', engineId: 'aliyun-filetrans' as const, modelId: 'qwen-audio-3.0-asr-flash-filetrans' } : { connectionProfileId: 'speech.private-moss', engineId: 'moss' as const, modelId: '' }; return update({ speech: { providerId, ...option } }); }
    const fixed = providerId === 'aliyun-cloud' ? (stage === 'translation' ? 'qwen-mt-plus' : 'qwen3.8-max') : '';
    return update({ [stage]: { ...config[stage], providerId, connectionProfileId: `${stage}.${providerId === 'private-runtime' ? 'private' : 'aliyun'}`, modelId: fixed } } as Partial<RecordingJobConfig>);
  };

  return <div className="recording-settings" aria-label={t('recording.title')}>
    <section className="settings-section"><h2>{t('recording.transcriptionService')}</h2><label>{t('recording.providerLabel')}<select className={SELECT_CLASS_NAME} value={config.speech.providerId} onChange={(event) => selectProvider('speech', event.target.value as RecordingProviderId)}>{PROVIDERS.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>
      {config.speech.providerId === 'private-runtime' && <label>{t('recording.connectionLabel')}<select className={SELECT_CLASS_NAME} value={config.speech.connectionProfileId} onChange={(event) => { const profile = event.target.value; const engineId: RecordingSpeechEngineId = profile === 'speech.private-funasr' ? 'funasr-meeting' : 'moss'; void update({ speech: { ...config.speech, connectionProfileId: profile, engineId, modelId: '' } }); }}>{connections('speech', 'private-runtime').map((item) => <option key={item.id} value={item.id}>{profileLabel(item.id)}</option>)}</select></label>}
      {config.speech.providerId === 'private-runtime' ? <PrivateCard profileId={config.speech.connectionProfileId} /> : <CloudCard profileId="speech.aliyun" speech />}
    </section>
    <section className="settings-section"><h2>{t('recording.languagesAndOutput')}</h2><div className="recording-settings__form-grid"><label>{t('recording.sourceMode')}<select className={SELECT_CLASS_NAME} value={config.sourceLanguageMode} onChange={(event) => update({ sourceLanguageMode: event.target.value as RecordingJobConfig['sourceLanguageMode'], ...(event.target.value === 'fixed' ? { sourceLanguage: config.sourceLanguage || 'zh' } : {}) })}><option value="auto">{t('recording.sourceModeOptions.auto')}</option><option value="mixed">{t('recording.sourceModeOptions.mixed')}</option><option value="fixed">{t('recording.sourceModeOptions.fixed')}</option></select></label>{config.sourceLanguageMode === 'fixed' && <label>{t('recording.sourceLanguage')}<select className={SELECT_CLASS_NAME} value={config.sourceLanguage || 'zh'} onChange={(event) => update({ sourceLanguage: event.target.value })}>{LANGUAGES.map((language) => <option value={language} key={language}>{getLanguageOption(language).name}</option>)}</select></label>}<label>{t('recording.hotwords')}<input defaultValue={(config.hotwords || []).join(', ')} onBlur={(event) => update({ hotwords: event.target.value.split(',').map((word) => word.trim()).filter(Boolean) })} /></label></div></section>
    <section className="settings-section"><h2>{t('recording.generateTranslation')}</h2><ToggleSwitch checked={config.translation.enabled} onChange={() => update({ translation: { ...config.translation, enabled: !config.translation.enabled } })} label={config.translation.enabled ? t('common.on') : t('common.off')} />{config.translation.enabled && <><div className="recording-settings__form-grid"><label>{t('recording.targetLanguage')}<select className={SELECT_CLASS_NAME} value={config.targetLanguage} onChange={(event) => update({ targetLanguage: event.target.value })}>{LANGUAGES.map((language) => <option value={language} key={language}>{getLanguageOption(language).name}</option>)}</select></label><label>{t('recording.providerLabel')}<select className={SELECT_CLASS_NAME} value={config.translation.providerId} onChange={(event) => selectProvider('translation', event.target.value as RecordingProviderId)}>{PROVIDERS.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>{config.translation.providerId === 'private-runtime' && <label>{t('recording.model')}<select className={SELECT_CLASS_NAME} value={config.translation.modelId} disabled={!textStatus('translation')?.models?.length} onChange={(event) => update({ translation: { ...config.translation, modelId: event.target.value } })}><option value="">{textStatus('translation')?.state === 'disabled' ? t('recording.modelUnavailable') : t('recording.chooseModel')}</option>{(textStatus('translation')?.models || []).map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>}</div>{config.translation.providerId === 'private-runtime' ? <PrivateCard profileId="translation.private" /> : <CloudCard profileId="translation.aliyun" />}</>}</section>
    <section className="settings-section"><h2>{t('recording.generateSummary')}</h2><ToggleSwitch checked={config.summary.enabled} onChange={() => update({ summary: { ...config.summary, enabled: !config.summary.enabled, inputMode: !config.summary.enabled && !config.translation.enabled ? 'source' : config.summary.inputMode } })} label={config.summary.enabled ? t('common.on') : t('common.off')} />{config.summary.enabled && <><div className="recording-settings__form-grid"><label>{t('recording.providerLabel')}<select className={SELECT_CLASS_NAME} value={config.summary.providerId} onChange={(event) => selectProvider('summary', event.target.value as RecordingProviderId)}>{PROVIDERS.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>{config.summary.providerId === 'private-runtime' && <label>{t('recording.model')}<select className={SELECT_CLASS_NAME} value={config.summary.modelId} disabled={!textStatus('summary')?.models?.length} onChange={(event) => update({ summary: { ...config.summary, modelId: event.target.value } })}><option value="">{textStatus('summary')?.state === 'disabled' ? t('recording.modelUnavailable') : t('recording.chooseModel')}</option>{(textStatus('summary')?.models || []).map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>}<label>{t('recording.summaryInput')}<select className={SELECT_CLASS_NAME} value={config.summary.inputMode} onChange={(event) => update({ summary: { ...config.summary, inputMode: event.target.value as RecordingJobConfig['summary']['inputMode'] } })}><option value="source">{t('recording.summarySource')}</option>{config.translation.enabled && <><option value="translated">{t('recording.summaryTranslated')}</option><option value="bilingual">{t('recording.summaryBilingual')}</option></>}</select></label></div>{config.summary.providerId === 'private-runtime' ? <PrivateCard profileId="summary.private" /> : <CloudCard profileId="summary.aliyun" />}</>}</section>
    {notice && <p className="recording-settings__notice" role="status">{notice}</p>}
  </div>;
};

export default RecordingSettingsSection;
