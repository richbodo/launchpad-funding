import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Section, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'FundFlow'

interface Props {
  facilitatorName?: string
  startupName?: string
  startupEmail?: string
  sessionName?: string
  sessionTime?: string
}

/**
 * Sent when a startup clicks "Notify Facilitators" from the waiting screen
 * (the session hasn't been started yet). Lets the facilitator know a presenter
 * is already in the room and waiting for them to go live.
 */
const StartupWaitingEmail = ({
  facilitatorName,
  startupName = 'A startup',
  startupEmail = '',
  sessionName = 'your session',
  sessionTime = '',
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{startupName} is waiting in {sessionName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {facilitatorName ? `Hi ${facilitatorName},` : 'Hi,'}
        </Heading>
        <Text style={text}>
          <strong>{startupName}</strong>
          {startupEmail ? ` (${startupEmail})` : ''} is already in the session
          room for <strong>{sessionName}</strong> and is waiting for you to start the session.
        </Text>
        {sessionTime && (
          <Section style={box}>
            <Text style={boxText}>🕐 Scheduled: {sessionTime}</Text>
          </Section>
        )}
        <Text style={text}>
          When you're ready, log in and click <strong>Start Call</strong> to bring
          everyone into the live session.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: StartupWaitingEmail,
  subject: (data: Record<string, any>) =>
    `${data.startupName || 'A startup'} is waiting in ${data.sessionName || 'your session'}`,
  displayName: 'Startup Waiting Notification',
  previewData: {
    facilitatorName: 'Alex',
    startupName: 'AlphaTech',
    startupEmail: 'founder@alphatech.io',
    sessionName: 'Q1 Demo Day',
    sessionTime: 'June 23, 2026 · 9:00 AM EDT',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '30px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 16px' }
const box = { backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '14px 18px', margin: '0 0 18px', border: '1px solid #bbf7d0' }
const boxText = { fontSize: '14px', color: '#166534', margin: 0 }
const hr = { borderColor: '#e5e7eb', margin: '25px 0' }
const footer = { fontSize: '12px', color: '#999', margin: '0 0 4px' }
