/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'FundFlow'

interface FacilitatorContact {
  name?: string
  email: string
}

interface InvestmentCommitmentProps {
  investorName?: string
  investorEmail?: string
  startupName?: string
  startupEmail?: string
  amount?: number
  sessionName?: string
  welcomeMessage?: string
  facilitators?: FacilitatorContact[]
}

const formatAmount = (n?: number) => {
  if (typeof n !== 'number' || !isFinite(n)) return '$0'
  return `$${Math.round(n).toLocaleString('en-US')}`
}

const InvestmentCommitmentEmail = ({
  investorName = '',
  investorEmail = '',
  startupName = '',
  startupEmail = '',
  amount = 0,
  sessionName = '',
  welcomeMessage = '',
  facilitators = [],
}: InvestmentCommitmentProps) => {
  const investorDisplay = investorName || investorEmail || 'An investor'
  const startupDisplay = startupName || startupEmail || 'the startup'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{investorDisplay} committed {formatAmount(amount)} to {startupDisplay}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Commitment Recorded</Heading>
          {welcomeMessage && (
            <Text style={text}>{welcomeMessage}</Text>
          )}
          <Text style={text}>
            <strong>{investorDisplay}</strong> has pledged a soft commitment of{' '}
            <strong>{formatAmount(amount)}</strong> to invest in{' '}
            <strong>{startupDisplay}</strong>{sessionName ? <> during <em>{sessionName}</em></> : null}.
          </Text>

          <Section style={detailBox}>
            <Text style={detailRow}><strong>Startup:</strong> {startupDisplay}{startupEmail ? ` (${startupEmail})` : ''}</Text>
            <Text style={detailRow}><strong>Investor:</strong> {investorDisplay}{investorEmail ? ` (${investorEmail})` : ''}</Text>
            <Text style={detailRow}><strong>Soft Commitment:</strong> {formatAmount(amount)}</Text>
          </Section>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>Next steps</Heading>
          <Text style={text}>
            This pledge is a <strong>non-binding soft commitment</strong> of interest. To convert
            it into a real investment, <strong>{startupDisplay}</strong> is now responsible for
            following up with <strong>{investorDisplay}</strong> as soon as possible.
          </Text>
          <Text style={text}>
            The startup should send the investor a SAFE (or other appropriate investment
            document) along with clear payment instructions so the commitment can be closed.
          </Text>
          <Text style={text}>
            Both parties have been copied on this email so you can reply-all to start that
            conversation directly.
          </Text>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>Important: Do your own due diligence</Heading>
          <Section style={disclaimerBox}>
            <Text style={disclaimerText}>
              A live demo session is <strong>not a replacement for due diligence</strong>.
              Investors should perform extensive due diligence on the startup prior to
              investing any funds, and should review any investment documents (SAFE,
              subscription agreement, etc.) with qualified legal counsel before signing.
            </Text>
            <Text style={disclaimerText}>
              Startups are likewise responsible for confirming that each investor is
              properly accredited and for complying with all applicable securities laws
              in their jurisdiction.
            </Text>
            <Text style={disclaimerText}>
              {SITE_NAME} facilitates introductions and records soft commitments only —
              it does not provide investment, legal, or tax advice and is not a party
              to any resulting transaction.
            </Text>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>— Your {SITE_NAME} facilitators</Text>
          {facilitators.length > 0 && (
            <Section>
              {facilitators.map((f) => (
                <Text key={f.email} style={facilitatorRow}>
                  {f.name ? `${f.name} — ` : ''}{f.email}
                </Text>
              ))}
            </Section>
          )}
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: InvestmentCommitmentEmail,
  subject: (data: Record<string, any>) => {
    const inv = data.investorName || data.investorEmail || 'An investor'
    const su = data.startupName || data.startupEmail || 'a startup'
    return `${inv} committed to invest in ${su}`
  },
  displayName: 'Investment Commitment',
  previewData: {
    investorName: 'Jane Doe',
    investorEmail: 'jane@example.com',
    startupName: 'AlphaTech',
    startupEmail: 'founder@alphatech.com',
    amount: 25000,
    sessionName: 'Q1 Demo Day',
    welcomeMessage: 'Thank you for committing to support this startup.',
    facilitators: [{ name: 'Jane Facilitator', email: 'jane@example.com' }],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '30px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 16px' }
const h2 = { fontSize: '16px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '20px 0 10px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 14px' }
const detailBox = { backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '16px 20px', margin: '6px 0 10px', border: '1px solid #bbf7d0' }
const detailRow = { fontSize: '14px', color: '#166534', margin: '0 0 6px' }
const hr = { borderColor: '#e5e7eb', margin: '22px 0' }
const footer = { fontSize: '13px', color: '#555', margin: '0 0 6px' }
const facilitatorRow = { fontSize: '13px', color: '#666', margin: '0 0 2px' }
const disclaimerBox = { backgroundColor: '#fffbeb', borderRadius: '8px', padding: '16px 20px', margin: '6px 0 10px', border: '1px solid #fde68a' }
const disclaimerText = { fontSize: '13px', color: '#78350f', lineHeight: '1.6', margin: '0 0 10px' }
