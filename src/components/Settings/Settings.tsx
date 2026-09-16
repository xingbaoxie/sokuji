import React, { useState, useEffect } from 'react';
import { LayoutGrid, Sliders, Settings as SettingsIcon, Headphones, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIMode, useSetUIMode, useNavigateToSettings, useSettingsNavigationTarget, useSetProvider, useUpdateVolcengineAST2 } from '../../stores/settingsStore';
import { useIsSessionActive } from '../../stores/sessionStore';
import { useAnalytics } from '../../lib/analytics';
import SimpleSettings from './SimpleSettings/SimpleSettings';
import AdvancedSettings from './AdvancedSettings/AdvancedSettings';
import PanelBar from './shared/PanelBar';
import type { Tab } from './shared/TabBar';
import RecordingSettingsSection from '../../features/recording/components/RecordingSettingsSection';
import TestConfigSection from './TestConfigSection';
import type { TestConfigLoadResult } from '../../features/recording/services/recordingService';
import { Provider } from '../../types/Provider';
import './Settings.scss';

interface SettingsProps {
  toggleSettings?: () => void;
  /** External highlight section prop */
  highlightSection?: string | null;
}

const TABS: Tab[] = [
  { id: 'general', labelKey: 'settings.tabs.general', fallback: 'General', icon: SettingsIcon },
  { id: 'audio', labelKey: 'settings.tabs.audio', fallback: 'Audio', icon: Headphones },
  { id: 'provider', labelKey: 'settings.tabs.provider', fallback: 'Provider', icon: Cpu },
];

// Settings unmounts whenever another panel takes its place (MainLayout renders
// panels conditionally), so the active tab lives in sessionStorage like the
// rest of the panelState.* keys.
const TAB_STORAGE_KEY = 'panelState.settingsActiveTab';
const CATEGORY_STORAGE_KEY = 'panelState.settingsCategory';
type SettingsCategory = 'subtitle' | 'recording';

function readStoredCategory(): SettingsCategory {
  return sessionStorage.getItem(CATEGORY_STORAGE_KEY) === 'recording' ? 'recording' : 'subtitle';
}

function readStoredTab(): string {
  const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
  return stored && TABS.some((tab) => tab.id === stored) ? stored : 'general';
}

const NAVIGATION_TAB_MAP: Record<string, string> = {
  'user-account': 'general',
  'languages': 'general',
  'microphone': 'audio',
  'speaker': 'audio',
  'system-audio': 'audio',
  'participant': 'audio',
  // Engine chips (Task 10) deep-link here to switch to the provider tab
  // without forcing Advanced mode — see ProviderSection's openSlot handler.
  // The target IS 'provider' (not a separate 'provider-section' key): the
  // scroll/highlight lookup below builds `${target}-section` as the DOM id,
  // and ProviderSection's root carries id="provider-section" — so 'provider'
  // is the only target string that resolves to a real element.
  'provider': 'provider',
  'system-instructions': 'provider',
  'voice-settings': 'provider',
  'turn-detection': 'provider',
  'model-management': 'provider',
  'model-asr': 'provider',
  'model-translation': 'provider',
  'model-tts': 'provider',
};

const Settings: React.FC<SettingsProps> = ({ toggleSettings, highlightSection }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const isSessionActive = useIsSessionActive();

  const uiMode = useUIMode();
  const setUIMode = useSetUIMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();
  const setProvider = useSetProvider();
  const updateVolcengineAST2 = useUpdateVolcengineAST2();

  // 'basic' maps to Simple/Quick, 'advanced' maps to Advanced.
  const isSimpleMode = uiMode === 'basic';

  const [activeTab, setActiveTab] = useState(readStoredTab);
  const [category, setCategory] = useState<SettingsCategory>(readStoredCategory);
  const [recordingConfigRevision, setRecordingConfigRevision] = useState(0);

  useEffect(() => {
    sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);
  useEffect(() => { sessionStorage.setItem(CATEGORY_STORAGE_KEY, category); }, [category]);

  // Advanced-only: switch to the target tab and scroll/highlight its section.
  // Quick mode highlights via SimpleSettings' highlightSection instead.
  useEffect(() => {
    if (isSimpleMode) return;
    if (!settingsNavigationTarget) return;
    const targetTab = NAVIGATION_TAB_MAP[settingsNavigationTarget];
    if (targetTab && targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
    // 'provider' is special (Finding 4): it's the engine chips' deep-link
    // target (see ProviderSection's openSlot), and the section this would
    // scroll/highlight is id="provider-section" — the WHOLE ProviderSection,
    // not the slot the chip actually opened. That flash now belongs to
    // EngineSurface's own expanded SlotRow (its one-shot `flashSlot` prop)
    // instead. Switch tabs only, and clear the one-shot target immediately
    // so it can't linger and hijack a later navigation that DOES want the
    // scroll/highlight.
    if (settingsNavigationTarget === 'provider') {
      navigateToSettings(null);
      return;
    }
    // Wait for the tab switch + DOM update before scrolling. Cancel the
    // pending scroll on cleanup so flipping modes mid-navigation doesn't
    // fire into an unmounted/stale DOM.
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let highlightedEl: HTMLElement | null = null;
    const scrollTimer = setTimeout(() => {
      const element = document.getElementById(`${settingsNavigationTarget}-section`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        element.classList.add('highlight');
        highlightedEl = element;
        highlightTimer = setTimeout(() => {
          element.classList.remove('highlight');
          highlightedEl = null;
          navigateToSettings(null);
        }, 3000);
      }
    }, 150);
    return () => {
      clearTimeout(scrollTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      // The DOM persists across panel hides (<Activity>), so a highlight
      // interrupted mid-animation must be removed here, not just its timer.
      highlightedEl?.classList.remove('highlight');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsNavigationTarget, navigateToSettings, isSimpleMode]);

  const handleModeToggle = () => {
    const newMode = isSimpleMode ? 'advanced' : 'basic';
    setUIMode(newMode);
    trackEvent('settings_mode_switched', {
      from_mode: uiMode,
      to_mode: newMode,
      during_session: isSessionActive,
    });
  };

  const applyTestConfig = async (result: TestConfigLoadResult) => {
    await updateVolcengineAST2(result.volcengineAST2);
    await setProvider(Provider.VOLCENGINE_AST2);
    setRecordingConfigRevision((revision) => revision + 1);
  };

  const modeToggle = (
    <div className="mode-toggle">
      <button
        className={`mode-button ${isSimpleMode ? 'active' : ''}`}
        onClick={() => !isSimpleMode && handleModeToggle()}
        title={t('settings.simpleMode', 'Quick')}
        aria-label={t('settings.simple', 'Quick')}
      >
        <LayoutGrid size={14} />
        <span>{t('settings.simple', 'Quick')}</span>
      </button>
      <button
        className={`mode-button ${!isSimpleMode ? 'active' : ''}`}
        onClick={() => isSimpleMode && handleModeToggle()}
        title={t('settings.advancedMode', 'Advanced')}
        aria-label={t('settings.advanced', 'Advanced')}
      >
        <Sliders size={14} />
        <span>{t('settings.advanced', 'Advanced')}</span>
      </button>
    </div>
  );

  return (
    <div className="settings-container">
      <PanelBar
        tabs={category === 'subtitle' && !isSimpleMode ? TABS : undefined}
        activeTab={category === 'subtitle' && !isSimpleMode ? activeTab : undefined}
        onTabChange={category === 'subtitle' && !isSimpleMode ? setActiveTab : undefined}
        actions={category === 'subtitle' ? modeToggle : undefined}
        onClose={toggleSettings ?? (() => {})}
      />

      <div className="settings-body">
        <TestConfigSection onLoaded={applyTestConfig} />
        <div className="settings-category-tabs" role="tablist" aria-label={t('settings.title', 'Settings')}>
          <button type="button" role="tab" aria-selected={category === 'subtitle'} className={category === 'subtitle' ? 'is-active' : ''} onClick={() => setCategory('subtitle')}>{t('subtitle.enterButton.label', 'Subtitles')}</button>
          <button type="button" role="tab" aria-selected={category === 'recording'} className={category === 'recording' ? 'is-active' : ''} onClick={() => setCategory('recording')}>{t('recording.title', 'Recording transcription')}</button>
        </div>
        {category === 'recording' ? <RecordingSettingsSection key={recordingConfigRevision} /> : isSimpleMode ? (
          <SimpleSettings highlightSection={highlightSection || settingsNavigationTarget} />
        ) : (
          <AdvancedSettings toggleSettings={toggleSettings} activeTab={activeTab} />
        )}
      </div>
    </div>
  );
};

export default Settings;
