import React from 'react';
import type { DisplayMode } from '../../stores/settingsStore';

// The conversation's two sides as speech bubbles. Upper bubble = the original
// line, lower bubble = its translation; a shown line is solid, a hidden line is
// the same outline. Tails carry who: one right tail per bubble is Me, two left
// tails per bubble is Other, and Both is Other's upper bubble over Me's lower.
// Path data is verbatim from ./side/*.svg — SideIcons.test.tsx fails if the
// two drift, so edit the file and the constant together.

interface SideIconProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

interface SideModeIconProps extends SideIconProps {
  mode?: DisplayMode;
}

const ME_SOURCE =
  'M 4 2 H 20 Q 22 2 22 4 V 5 Q 22 7 20 7 V 10 L 16 7 H 4 Q 2 7 2 5 V 4 Q 2 2 4 2 Z';
const ME_TRANSLATION =
  'M 4 14 H 20 Q 22 14 22 16 V 17 Q 22 19 20 19 V 22 L 16 19 H 4 Q 2 19 2 17 V 16 Q 2 14 4 14 Z';
const OTHER_SOURCE =
  'M 4 2 H 20 Q 22 2 22 4 V 5 Q 22 7 20 7 H 14 L 10 10 V 7 H 7 L 3 10 V 6.7 Q 2 6.3 2 5 V 4 Q 2 2 4 2 Z';
const OTHER_TRANSLATION =
  'M 4 14 H 20 Q 22 14 22 16 V 17 Q 22 19 20 19 H 14 L 10 22 V 19 H 7 L 3 22 V 18.7 Q 2 18.3 2 17 V 16 Q 2 14 4 14 Z';

// [upper line shown, lower line shown]
const SHOWN: Record<DisplayMode, [boolean, boolean]> = {
  both: [true, true],
  translation: [false, true],
  source: [true, false],
  none: [false, false],
};

const Line: React.FC<{ cls: string; d: string; shown: boolean }> = ({ cls, d, shown }) => (
  <path className={cls} d={d} fill={shown ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} />
);

const Frame: React.FC<SideIconProps & { name: string; children: React.ReactNode }> = ({
  name, size = 24, className, style, children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    data-icon={name}
    aria-hidden="true"
    className={className}
    style={style}
  >
    {children}
  </svg>
);

export const SideMeIcon: React.FC<SideModeIconProps> = ({ mode = 'both', ...rest }) => {
  const [upper, lower] = SHOWN[mode];
  return (
    <Frame name="side-me" {...rest}>
      <Line cls="line-source" d={ME_SOURCE} shown={upper} />
      <Line cls="line-translation" d={ME_TRANSLATION} shown={lower} />
    </Frame>
  );
};

export const SideOtherIcon: React.FC<SideModeIconProps> = ({ mode = 'both', ...rest }) => {
  const [upper, lower] = SHOWN[mode];
  return (
    <Frame name="side-other" {...rest}>
      <Line cls="line-source" d={OTHER_SOURCE} shown={upper} />
      <Line cls="line-translation" d={OTHER_TRANSLATION} shown={lower} />
    </Frame>
  );
};

// No mode: Both never toggles, and its paths are named for the side they
// belong to rather than for a line role.
export const SideBothIcon: React.FC<SideIconProps> = (props) => (
  <Frame name="side-both" {...props}>
    <Line cls="side-other" d={OTHER_SOURCE} shown />
    <Line cls="side-me" d={ME_TRANSLATION} shown />
  </Frame>
);
