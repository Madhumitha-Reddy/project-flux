import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center items-center text-center flex-1 gap-6 px-4">
      <div
        style={{
          fontFamily: "'Geist', sans-serif",
          fontWeight: 700,
          fontSize: 'clamp(2.5rem, 8vw, 5rem)',
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}
      >
        Flux
      </div>
      <p
        style={{
          fontFamily: "'Geist', sans-serif",
          fontSize: '1.125rem',
          color: 'var(--flux-muted, #737373)',
          maxWidth: '40ch',
          lineHeight: 1.6,
        }}
      >
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Placeholder docs site.
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <Link
          href="/docs"
          style={{
            fontFamily: "'Geist', sans-serif",
            fontWeight: 500,
            fontSize: '0.95rem',
            background: 'var(--flux-accent, #0a0a0a)',
            color: 'var(--flux-accent-fg, #ffffff)',
            padding: '0.625rem 1.5rem',
            borderRadius: '8px',
            textDecoration: 'none',
            transition: 'opacity 0.15s',
          }}
        >
          Read the docs →
        </Link>
        <Link
          href="/docs/downloads"
          style={{
            fontFamily: "'Geist', sans-serif",
            fontWeight: 500,
            fontSize: '0.95rem',
            background: 'transparent',
            color: 'var(--flux-text, #0a0a0a)',
            border: '1px solid var(--flux-border, #e5e5e5)',
            padding: '0.625rem 1.5rem',
            borderRadius: '8px',
            textDecoration: 'none',
            transition: 'border-color 0.15s',
          }}
        >
          Download
        </Link>
      </div>
    </div>
  );
}
