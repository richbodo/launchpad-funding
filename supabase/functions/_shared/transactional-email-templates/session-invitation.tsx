import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Link, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Pitch Pledge"

interface SessionInvitationProps {
  recipientName?: string
  roleName?: string
  sessionName?: string
  sessionDate?: string
  sessionTime?: string
  welcomeMessage?: string
  loginUrl?: string
  calendarUrl?: string
  contactEmail?: string
}

const SessionInvitationEmail = ({
  recipientName,
  roleName = 'participant',
  sessionName = 'Upcoming Session',
  sessionDate = '',
  sessionTime = '',
  welcomeMessage = '',
  loginUrl = '',
  calendarUrl = '',
  contactEmail = '',
}: SessionInvitationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You're invited to {sessionName} — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {recipientName ? `Hello, ${recipientName}!` : 'Hello!'}
        </Heading>

        <Text style={text}>
          You've been registered as {roleName === 'investor' ? 'an' : 'a'} <strong>{roleName}</strong> for the upcoming session:
        </Text>

        <Section style={sessionBox}>
          <Text style={sessionTitle}>{sessionName}</Text>
          {sessionDate && <Text style={sessionDetail}>📅 {sessionDate}</Text>}
          {sessionTime && <Text style={sessionDetail}>🕐 {sessionTime}</Text>}
        </Section>

        {welcomeMessage && (
          <Text style={text}>{welcomeMessage}</Text>
        )}

        {loginUrl && (
          <Section style={{ textAlign: 'center' as const, margin: '25px 0' }}>
            <Button style={button} href={loginUrl}>
              Join Session
            </Button>
          </Section>
        )}

        {calendarUrl && (
          <Section style={{ textAlign: 'center' as const, marginBottom: '25px' }}>
            <Link href={calendarUrl} style={calendarLink}>
              📅 Add to Google Calendar
            </Link>
          </Section>
        )}

        <Hr style={hr} />

        <Text style={footer}>
          {contactEmail
            ? <>Questions? Contact <Link href={`mailto:${contactEmail}`} style={linkStyle}>{contactEmail}</Link></>
            : 'Questions? Contact your session facilitator.'}
        </Text>
        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SessionInvitationEmail,
  subject: (data: Record<string, any>) => `You're invited to ${data.sessionName || 'a session'} — ${SITE_NAME}`,
  displayName: 'Session Invitation',
  previewData: {
    recipientName: 'Jane Doe',
    roleName: 'investor',
    sessionName: 'Q1 Demo Day',
    sessionDate: 'March 30, 2026',
    sessionTime: '9:00 AM — 11:00 AM ET',
    welcomeMessage: 'We look forward to seeing you at the pitch session!',
    loginUrl: 'https://pitch.globaldonut.com/login?session=abc&email=jane@example.com&role=investor',
    calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Q1+Demo+Day',
    contactEmail: 'facilitator@example.com',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '30px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1a2e', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#333', lineHeight: '1.6', margin: '0 0 16px' }
const sessionBox = { backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '16px 20px', margin: '0 0 20px', border: '1px solid #bbf7d0' }
const sessionTitle = { fontSize: '17px', fontWeight: 'bold' as const, color: '#166534', margin: '0 0 6px' }
const sessionDetail = { fontSize: '14px', color: '#15803d', margin: '0 0 4px' }
const button = { backgroundColor: '#16a34a', color: '#ffffff', padding: '12px 28px', borderRadius: '6px', fontSize: '15px', fontWeight: 'bold' as const, textDecoration: 'none', display: 'inline-block' }
const calendarLink = { fontSize: '14px', color: '#16a34a', textDecoration: 'underline' }
const hr = { borderColor: '#e5e7eb', margin: '25px 0' }
const footer = { fontSize: '12px', color: '#999', margin: '0 0 4px' }
const linkStyle = { color: '#16a34a' }
