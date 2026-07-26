'use client';

import { useEffect, useState } from 'react';

type OS = 'macos-intel' | 'macos-arm' | 'windows' | 'linux';

interface Asset {
  id: string;
  os: OS;
  label: string;
  sublabel: string;
  ext: string;
  icon: string;
  href: string;
}

const VERSION = 'v0.0.0';

const assets: Asset[] = [
  {
    id: 'macos-arm',
    os: 'macos-arm',
    label: 'macOS',
    sublabel: 'Apple Silicon',
    ext: '.dmg',
    icon: '⌥',
    href: '#',
  },
  {
    id: 'macos-intel',
    os: 'macos-intel',
    label: 'macOS',
    sublabel: 'Intel (x86_64)',
    ext: '.dmg',
    icon: '⌘',
    href: '#',
  },
  {
    id: 'windows',
    os: 'windows',
    label: 'Windows',
    sublabel: 'x64 Installer',
    ext: '.exe',
    icon: '⊞',
    href: '#',
  },
  {
    id: 'linux-appimage',
    os: 'linux',
    label: 'Linux',
    sublabel: 'AppImage',
    ext: '.AppImage',
    icon: '🐧',
    href: '#',
  },
  {
    id: 'linux-deb',
    os: 'linux',
    label: 'Linux',
    sublabel: 'Debian / Ubuntu',
    ext: '.deb',
    icon: '📦',
    href: '#',
  },
  {
    id: 'linux-pacman',
    os: 'linux',
    label: 'Linux',
    sublabel: 'Arch / pacman',
    ext: '.tar.zst',
    icon: '🏹',
    href: '#',
  },
];

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) {
    const platform =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    if (/arm/i.test(platform)) return 'macos-arm';
    return 'macos-intel';
  }
  if (/Win/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'windows';
}

export function DownloadSection() {
  const [detectedOS, setDetectedOS] = useState<OS | null>(null);

  useEffect(() => {
    setDetectedOS(detectOS());
  }, []);

  const primary = assets.find((a) => a.os === detectedOS) ?? assets[2];

  return (
    <div className="flux-downloads not-prose">
      <div className="flux-downloads__primary">
        <div className="flux-downloads__badge">Recommended for your system</div>
        <a href={primary.href} className="flux-downloads__main-btn">
          <span className="flux-downloads__main-icon">{primary.icon}</span>
          <span className="flux-downloads__main-text">
            <span className="flux-downloads__main-label">
              Download for {primary.label}
            </span>
            <span className="flux-downloads__main-sub">
              {primary.sublabel} · {primary.ext}
            </span>
          </span>
          <span className="flux-downloads__arrow">↓</span>
        </a>
        <p className="flux-downloads__version">
          {VERSION} ·{' '}
          <a href="#changelog">Release notes</a>
        </p>
      </div>

      <div className="flux-downloads__grid">
        {assets.map((a) => {
          const isActive = a.os === detectedOS;
          return (
            <a
              key={a.id}
              href={a.href}
              className={`flux-downloads__card${isActive ? ' flux-downloads__card--active' : ''}`}
            >
              <span className="flux-downloads__card-icon">{a.icon}</span>
              <span className="flux-downloads__card-info">
                <span className="flux-downloads__card-label">
                  {a.label} <span className="flux-downloads__card-ext">{a.ext}</span>
                </span>
                <span className="flux-downloads__card-sub">{a.sublabel}</span>
              </span>
              {isActive && (
                <span className="flux-downloads__card-chip">Your OS</span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
