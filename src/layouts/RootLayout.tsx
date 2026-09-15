/**
 * Root layout component that wraps the entire application
 * and provides routing functionality for Chrome extensions
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAnalytics } from '../lib/analytics';
import { collectDeviceProfile } from '../utils/deviceProfile';

export function RootLayout() {
  const { trackEvent } = useAnalytics();

  React.useEffect(() => {
    let startupCancelled = false;

    // Track app startup - version, platform, environment are automatically
    // included via Super Properties. The device profile is not: it needs an
    // async GPU probe, so the event goes out once that resolves. A launch is
    // not a latency measurement, so waiting costs nothing, and the event is
    // never dropped on the profile's account -- collectDeviceProfile() bounds
    // itself and resolves empty rather than hanging, and a rejection here still
    // reports the launch.
    collectDeviceProfile()
      .catch(() => ({}))
      .then(profile => {
        if (startupCancelled) return;
        // $set mirrors the profile onto the person, so "what is this reporter
        // running" is one person lookup rather than a hunt for their last
        // app_startup event.
        trackEvent('app_startup', { ...profile, $set: profile });
      });

    // Track side panel auto-opened via extension icon click on supported sites
    const urlParams = new URLSearchParams(window.location.search);
    const trigger = urlParams.get('trigger');
    if (trigger === 'action_click') {
      trackEvent('extension_side_panel_opened', {
        trigger: 'action',
        site: urlParams.get('site') || undefined,
      });
    }

    // Track app shutdown on beforeunload
    const handleBeforeUnload = () => {
      const sessionStart = sessionStorage.getItem('session_start');
      const sessionDuration = sessionStart
        ? Date.now() - parseInt(sessionStart, 10)
        : 0;

      trackEvent('app_shutdown', {
        session_duration: sessionDuration
      });
    };

    // Store session start time
    if (!sessionStorage.getItem('session_start')) {
      sessionStorage.setItem('session_start', Date.now().toString());
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      startupCancelled = true;
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [trackEvent]);

  return <Outlet />;
}