/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Pitch Pledge'

interface GiftPledgeProps {
  investorName?: string
  investorEmail?: string
  startupName?: string
  startupEmail?: string
  amount?: number
  sessionName?: string
  welcomeMessage?: string
}

const formatAmount = (n?: number) => {
  if (typeof n !== 'number' || !isFinite(n)) return '$0'
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/**
 * Community-supporter gift pledge confirmation.
 *
 * Sent at end-of-session to a {supporter, startup} pair for every investment
 * row whose `pledge_type === 'gift'`. The pledge is non-binding (capped at
 * $100 elsewhere) and the startup MAY offer a gift in return — they handle
 * that exchange directly; the platform does not track it.
 */
const CommitmentGiftPledgeEmail = ({
  investorName = '',
  investorEmail = '',
  startupName = '',
  startupEmail = '',
  amount = 0,
  sessionName = '',
}: GiftPledgeProps) => {
  const supporterDisplay = investorName || investorEmail || 'A community supporter'
  const startupDisplay = startupName || startupEmail || 'the startup'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{supporterDisplay} pledged {formatAmount(amount)} in support of {startupDisplay}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Gift Pledge Recorded</Heading>
          <Text style={text}>
            <strong>{supporterDisplay}</strong> has pledged a best-effort community gift of{' '}
            <strong>{formatAmount(amount)}</strong> in support of{' '}
            <strong>{startupDisplay}</strong>{sessionName ? <> during <em>{sessionName}</em></> : null}.
          </Text>

          <Section style={detailBox}>
            <Text style={detailRow}><strong>Startup:</strong> {startupDisplay}{startupEmail ? ` (${startupEmail})` : ''}</Text>
            <Text style={detailRow}><strong>Supporter:</strong> {supporterDisplay}{investorEmail ? ` (${investorEmail})` : ''}</Text>
            <Text style={detailRow}><strong>Gift Pledge:</strong> {formatAmount(amount)} (non-binding)</Text>
          </Section>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>What this means</Heading>
          <Text style={text}>
            This is a <strong>non-binding, best-effort gift pledge</strong> — not an investment
            and not a purchase of equity. No SAFE or other investment document is involved.
          </Text>
          <Text style={text}>
            <strong>{startupDisplay}</strong> may, at their sole discretion, offer a small gift
            in return as a thank-you. Any such exchange is arranged directly between the
            startup and the supporter; {SITE_NAME} does not track or mediate it.
          </Text>
          <Text style={text}>
            Both parties have been copied on this email so you can reply-all to coordinate
            payment and any thank-you gift directly.
          </Text>

          <Hr style={hr} />
          <Text style={footer}>— The {SITE_NAME} Team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CommitmentGiftPledgeEmail,
  subject: (data: Record<string, any>) => {
    const sup = data.investorName || data.investorEmail || 'A community supporter'
    const su = data.startupName || data.startupEmail || 'a startup'
    return `${sup} pledged a community gift to ${su}`
  },
  displayName: 'Community Gift Pledge',
  previewData: {
    investorName: 'Sam Supporter',
    investorEmail: 'sam@example.com',
    startupName: 'AlphaTech',
    startupEmail: 'founder@alphatech.com',
    amount: 75,
    sessionName: 'Q1 Demo Day',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '30px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 16px' }
const h2 = { fontSize: '16px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '20px 0 10px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 14px' }
const detailBox = { backgroundColor: '#fef3c7', borderRadius: '8px', padding: '16px 20px', margin: '6px 0 10px', border: '1px solid #fde68a' }
const detailRow = { fontSize: '14px', color: '#78350f', margin: '0 0 6px' }
const hr = { borderColor: '#e5e7eb', margin: '22px 0' }
const footer = { fontSize: '12px', color: '#999', margin: '0' }
