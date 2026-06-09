import { ImageResponse } from 'next/og'

// Dynamic Open Graph card (spec §9) — the charcoal band, a violet "85Percent"
// lockup, and the headline, so links shared on LinkedIn / WhatsApp render rich.
export const runtime = 'edge'
export const alt = '85Percent — The Squad Cost Engine'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0B1020',
          backgroundImage:
            'radial-gradient(60% 60% at 50% 0%, rgba(109,40,217,0.45), rgba(11,16,32,0) 70%)',
          padding: '72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Lockup */}
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: 72,
              fontWeight: 700,
              backgroundImage: 'linear-gradient(135deg, #6D28D9 0%, #8B5CF6 55%, #B98AF0 100%)',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            85
          </span>
          <span style={{ fontSize: 56, fontWeight: 500, color: '#FFFFFF', marginLeft: 6 }}>
            Percent
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              fontSize: 60,
              fontWeight: 600,
              color: '#FFFFFF',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              maxWidth: 980,
            }}
          >
            The definitive financial compliance platform for elite football clubs.
          </div>
          <div style={{ fontSize: 30, color: 'rgba(255,255,255,0.6)' }}>
            The Squad Cost Engine.
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
